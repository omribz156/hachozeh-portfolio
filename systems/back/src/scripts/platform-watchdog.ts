import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  inferRepoRoot,
  readEnvValue,
  readNonNegativeNumberArg,
  readOptionalPositiveIntegerArg,
  readStringArg
} from "./script-args";

const execFileAsync = promisify(execFile);

export type WatchdogTarget = {
  name: "backend" | "frontend" | string;
  url: string;
  tmuxSession: string;
  restartCommand: string;
  // launchd agent label — set after the tmux→launchd cutover so the watchdog
  // restarts the real supervised process. When present, restartLaunchdTarget
  // is used; the tmux fields remain for the boot-platform --dev path.
  launchdLabel?: string;
  // systemd service unit — set on Linux/VPS deploys so execute mode can ask
  // the real process manager to restart unhealthy-but-alive services.
  systemdUnit?: string;
  timeoutMs: number;
};

export type WatchdogOptions = {
  runId: string;
  execute: boolean;
  loop: boolean;
  iterations: number | null;
  intervalMs: number;
  prewarmTrendingReads: boolean;
  prewarmTrendingLimit: number;
  prewarmHistoryRange: string;
  prewarmTimeoutMs: number;
  failureThreshold: number;
  restartCooldownMs: number;
  restartWindowMs: number;
  maxRestartsPerWindow: number;
  staleChunkLogPath: string;
  receiptPath: string;
  targets: WatchdogTarget[];
};

type WatchdogState = {
  failures: Map<string, number>;
  restartHistory: Map<string, number[]>;
  cooldownUntil: Map<string, number>;
  // Targets we already paged a human about. Exactly two alerts per outage:
  // one on first threshold breach, one on recovery. Optional + lazily
  // initialized so pre-existing state objects keep working.
  alertedTargets?: Set<string>;
};

type ProbeResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  error: string | null;
};

type TargetReceipt = ProbeResult & {
  failures: number;
  action: "none" | "would_restart" | "restarted" | "restart_failed" | "restart_blocked";
  failureKind?: string;
  runtime?: TargetRuntimeSnapshot;
  cooldownUntil?: string;
  actionError?: string;
  alerted?: "down" | "recovered";
};

type PrewarmReceipt = {
  enabled: boolean;
  attempted: number;
  warmed: number;
  historyRange: string;
  elapsedMs: number;
  selectedMarkets: string[];
  skippedReason?: string;
  failures: Array<{
    marketKey: string;
    target: "market_detail" | "history";
    status: number | null;
    error: string | null;
  }>;
};

type TargetRuntimeSnapshot = {
  tmuxSession: string;
  tmuxPresent: boolean;
  systemdUnit?: string;
  systemdActive?: boolean;
  systemdStatus?: string;
  paneCommand?: string;
  paneTail?: string;
  error?: string;
};

type TargetSummary = {
  name: string;
  checks: number;
  ok: number;
  failed: number;
  passRate: number;
  longestOutageTicks: number;
  longestOutageMs: number;
  actions: Record<string, number>;
};

type WatchdogSummary = {
  event: "platform_watchdog_summary";
  ticks: number;
  startedAt: string | null;
  endedAt: string | null;
  verdict: "ok" | "watch" | "bad";
  targets: TargetSummary[];
};

type WatchdogDeps = {
  fetchImpl?: typeof fetch;
  restartTarget?: (target: WatchdogTarget) => Promise<void>;
  readRuntimeSnapshot?: (target: WatchdogTarget) => Promise<TargetRuntimeSnapshot>;
  appendReceipt?: (line: Record<string, unknown>) => Promise<void>;
  sendAlert?: (message: string) => Promise<boolean | void>;
};

const repoRoot = inferRepoRoot("WATCHDOG_REPO_ROOT");

// Page a human via the Telegram seam. The script self-loads the private-ops
// env, so this works from launchd without env plumbing. Delivery failures do
// not stop the watchdog; they leave the alert eligible for the next tick.
async function sendPlatformAlert(message: string): Promise<boolean> {
  try {
    const result = await execFileAsync(
      resolve(repoRoot, "workspace/scripts/platform-alert.sh"),
      ["--require-delivery", "send", message],
      { timeout: 15_000 }
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) {
      console.log(`[watchdog] platform alert result: ${output}`);
    }
    return true;
  } catch (error) {
    console.error(
      `[watchdog] platform alert failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

function resolveReceiptPath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

export function parseWatchdogOptions(args = process.argv.slice(2)): WatchdogOptions {
  const execute = args.includes("--execute");
  const loop = args.includes("--loop");
  const iterations = readOptionalPositiveIntegerArg(args, "iterations") ?? (loop ? null : 1);
  const intervalMs = readNonNegativeNumberArg(args, "interval-ms", 15_000);
  const prewarmArg = args.includes("--prewarm-trending-reads");
  const noPrewarmArg = args.includes("--no-prewarm-trending-reads");
  const prewarmEnv = readEnvValue("WATCHDOG_PREWARM_TRENDING_READS", "");
  const prewarmTrendingReads = noPrewarmArg
    ? false
    : prewarmArg || prewarmEnv === "true" || prewarmEnv === "1";
  const prewarmHistoryRange = readStringArg(
    args,
    "prewarm-history-range",
    readEnvValue("WATCHDOG_PREWARM_HISTORY_RANGE", "1D")
  ).toUpperCase();
  const failureThreshold = readNonNegativeNumberArg(args, "failure-threshold", 3);
  const restartCooldownMs = readNonNegativeNumberArg(args, "restart-cooldown-ms", 60_000);
  const restartWindowMs = readNonNegativeNumberArg(args, "restart-window-ms", 10 * 60_000);
  const maxRestartsPerWindow = readNonNegativeNumberArg(args, "max-restarts-per-window", 3);
  const receiptPath = resolveReceiptPath(
    readStringArg(
      args,
      "receipt-path",
      readEnvValue("WATCHDOG_RECEIPT_PATH", `workspace/runtime/watchdog/platform-${Date.now().toString(36)}.jsonl`)
    )
  );
  const frontendBaseUrl = readStringArg(
    args,
    "frontend-base-url",
    readEnvValue("WATCHDOG_FRONTEND_BASE_URL", "http://127.0.0.1:6969")
  ).replace(/\/$/, "");
  const frontendLaunchdLabel = readEnvValue("WATCHDOG_FRONT_LAUNCHD_LABEL", "com.hachozeh.web");
  const frontendSystemdUnit = readEnvValue("WATCHDOG_FRONT_SYSTEMD_UNIT", "");
  const frontendTimeoutMs = readNonNegativeNumberArg(args, "frontend-timeout-ms", 2_000);
  const frontendRestartCommand = readEnvValue("WATCHDOG_FRONT_RESTART_COMMAND", "npm --prefix systems/web run dev");
  const frontendTmuxSession = readEnvValue("WATCHDOG_FRONT_TMUX_SESSION", "codex-web");

  return {
    runId: readStringArg(args, "run-id", readEnvValue("WATCHDOG_RUN_ID", `watchdog-${randomUUID()}`)),
    execute,
    loop,
    iterations,
    intervalMs,
    prewarmTrendingReads,
    prewarmTrendingLimit: readNonNegativeNumberArg(args, "prewarm-trending-limit", 6),
    prewarmHistoryRange,
    prewarmTimeoutMs: readNonNegativeNumberArg(args, "prewarm-timeout-ms", 2_000),
    failureThreshold,
    restartCooldownMs,
    restartWindowMs,
    maxRestartsPerWindow,
    staleChunkLogPath: resolveReceiptPath(
      readStringArg(
        args,
        "stale-chunk-log-path",
        readEnvValue("WATCHDOG_STALE_CHUNK_LOG_PATH", "workspace/runtime/web.err.log")
      )
    ),
    receiptPath,
    targets: [
      {
        name: "backend",
        url: readStringArg(args, "backend-url", readEnvValue("BACKEND_READY_URL", "http://127.0.0.1:3001/health/ready")),
        tmuxSession: readEnvValue("WATCHDOG_BACK_TMUX_SESSION", "codex-navi-back"),
        restartCommand: readEnvValue("WATCHDOG_BACK_RESTART_COMMAND", "npm --prefix systems/back run dev"),
        launchdLabel: readEnvValue("WATCHDOG_BACK_LAUNCHD_LABEL", "com.hachozeh.backend"),
        systemdUnit: readEnvValue("WATCHDOG_BACK_SYSTEMD_UNIT", ""),
        timeoutMs: readNonNegativeNumberArg(args, "backend-timeout-ms", 2_000)
      },
      {
        name: "frontend_portfolio",
        url: readStringArg(
          args,
          "frontend-url",
          readEnvValue("FRONTEND_READY_URL", `${frontendBaseUrl}/portfolio`)
        ),
        tmuxSession: frontendTmuxSession,
        restartCommand: frontendRestartCommand,
        launchdLabel: frontendLaunchdLabel,
        systemdUnit: frontendSystemdUnit,
        timeoutMs: frontendTimeoutMs
      },
      {
        name: "frontend_settings",
        url: `${frontendBaseUrl}/settings`,
        tmuxSession: frontendTmuxSession,
        restartCommand: frontendRestartCommand,
        launchdLabel: frontendLaunchdLabel,
        systemdUnit: frontendSystemdUnit,
        timeoutMs: frontendTimeoutMs
      },
      {
        name: "frontend_breaking",
        url: `${frontendBaseUrl}/breaking-markets`,
        tmuxSession: frontendTmuxSession,
        restartCommand: frontendRestartCommand,
        launchdLabel: frontendLaunchdLabel,
        systemdUnit: frontendSystemdUnit,
        timeoutMs: frontendTimeoutMs
      },
      {
        name: "frontend_topic",
        url: `${frontendBaseUrl}/topics/economy`,
        tmuxSession: frontendTmuxSession,
        restartCommand: frontendRestartCommand,
        launchdLabel: frontendLaunchdLabel,
        systemdUnit: frontendSystemdUnit,
        timeoutMs: frontendTimeoutMs
      }
    ]
  };
}

async function hasRecentStaleChunkError(path: string): Promise<boolean> {
  try {
    const text = await readFile(path, "utf8");
    const tail = text.slice(-80_000);
    return (
      tail.includes("ERR_MODULE_NOT_FOUND") &&
      tail.includes("/systems/web/dist/server/chunks/")
    );
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{
  ok: boolean;
  status: number | null;
  payload: unknown;
  error: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal
    });
    const text = await response.text();
    let payload: unknown = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text.slice(0, 200);
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readBackendOrigin(targets: WatchdogTarget[]): string | null {
  const backendTarget = targets.find((target) => target.name === "backend") ?? targets[0];
  if (!backendTarget) {
    return null;
  }

  try {
    return new URL(backendTarget.url).origin;
  } catch {
    return null;
  }
}

function readTrendingMarketKeys(payload: unknown, limit: number): string[] {
  if (!payload || typeof payload !== "object" || !("items" in payload)) {
    return [];
  }

  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }

  const selected = new Set<string>();

  for (const item of items) {
    if (selected.size >= limit) {
      break;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as { marketKey?: unknown; marketStatus?: unknown };
    if (record.marketStatus !== "open" || typeof record.marketKey !== "string") {
      continue;
    }

    selected.add(record.marketKey);
  }

  return [...selected];
}

async function prewarmTrendingReads(
  options: WatchdogOptions,
  targetReceipts: TargetReceipt[],
  fetchImpl: typeof fetch
): Promise<PrewarmReceipt> {
  const startedAt = performance.now();
  const backendReceipt = targetReceipts.find((receipt) => receipt.name === "backend");
  const backendOrigin = readBackendOrigin(options.targets);
  const baseReceipt = {
    enabled: options.prewarmTrendingReads,
    attempted: 0,
    warmed: 0,
    historyRange: options.prewarmHistoryRange,
    elapsedMs: 0,
    selectedMarkets: [],
    failures: []
  } satisfies PrewarmReceipt;

  if (!options.prewarmTrendingReads) {
    return {
      ...baseReceipt,
      skippedReason: "disabled"
    };
  }

  if (!backendOrigin) {
    return {
      ...baseReceipt,
      elapsedMs: Math.round(performance.now() - startedAt),
      skippedReason: "backend_origin_unavailable"
    };
  }

  if (!backendReceipt?.ok) {
    return {
      ...baseReceipt,
      elapsedMs: Math.round(performance.now() - startedAt),
      skippedReason: "backend_not_ok"
    };
  }

  const feed = await fetchWithTimeout(
    `${backendOrigin}/api/discovery/feed?feed=trending`,
    options.prewarmTimeoutMs,
    fetchImpl
  );

  if (!feed.ok) {
    return {
      ...baseReceipt,
      elapsedMs: Math.round(performance.now() - startedAt),
      skippedReason: feed.error ?? `feed_http_${feed.status ?? "none"}`
    };
  }

  const selectedMarkets = readTrendingMarketKeys(feed.payload, options.prewarmTrendingLimit);
  let warmed = 0;
  const failures: PrewarmReceipt["failures"] = [];

  for (const marketKey of selectedMarkets) {
    const encodedMarketKey = encodeURIComponent(marketKey);
    const [detail, history] = await Promise.all([
      fetchWithTimeout(
        `${backendOrigin}/api/market-detail/markets/${encodedMarketKey}`,
        options.prewarmTimeoutMs,
        fetchImpl
      ),
      fetchWithTimeout(
        `${backendOrigin}/api/markets/${encodedMarketKey}/history?range=${encodeURIComponent(options.prewarmHistoryRange)}`,
        options.prewarmTimeoutMs,
        fetchImpl
      )
    ]);

    if (!detail.ok) {
      failures.push({
        marketKey,
        target: "market_detail",
        status: detail.status,
        error: detail.error
      });
    }

    if (!history.ok) {
      failures.push({
        marketKey,
        target: "history",
        status: history.status,
        error: history.error
      });
    }

    if (detail.ok && history.ok) {
      warmed += 1;
    }
  }

  return {
    enabled: true,
    attempted: selectedMarkets.length,
    warmed,
    historyRange: options.prewarmHistoryRange,
    elapsedMs: Math.round(performance.now() - startedAt),
    selectedMarkets,
    failures
  };
}

async function appendJsonl(path: string, line: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(line)}\n`);
}

async function probeTarget(target: WatchdogTarget, fetchImpl: typeof fetch): Promise<ProbeResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), target.timeoutMs);

  try {
    const response = await fetchImpl(target.url, {
      method: "GET",
      signal: controller.signal
    });

    return {
      name: target.name,
      url: target.url,
      ok: response.ok,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: null
    };
  } catch (error) {
    return {
      name: target.name,
      url: target.url,
      ok: false,
      status: null,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyProbeFailure(target: WatchdogTarget, probe: ProbeResult): string | undefined {
  if (probe.ok) {
    return undefined;
  }

  if (target.name === "backend") {
    if (probe.status === null) {
      return "backend_down";
    }

    if (probe.status === 503) {
      return "backend_not_ready";
    }

    return `backend_http_${probe.status}`;
  }

  if (target.name === "frontend" || target.name.startsWith("frontend_")) {
    return probe.status === null ? "frontend_down" : `frontend_http_${probe.status}`;
  }

  return probe.status === null ? "target_down" : `target_http_${probe.status}`;
}

async function restartTmuxTarget(target: WatchdogTarget): Promise<void> {
  await execFileAsync("tmux", ["has-session", "-t", target.tmuxSession]);
  await execFileAsync("tmux", [
    "respawn-pane",
    "-k",
    "-t",
    target.tmuxSession,
    `cd ${repoRoot} && ${target.restartCommand}`
  ]);
}

// Restart the supervised process-manager unit. systemd is the production/VPS
// path, launchd is the local Mac proof path, and tmux remains the dev fallback.
// Process managers already restart hard crashes; this recovers an unhealthy
// process that still owns its port.
async function restartManagedTarget(target: WatchdogTarget): Promise<void> {
  if (target.systemdUnit) {
    await execFileAsync("systemctl", ["restart", target.systemdUnit]);
    return;
  }

  if (!target.launchdLabel) {
    await restartTmuxTarget(target);
    return;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  await execFileAsync("launchctl", [
    "kickstart",
    "-k",
    `gui/${uid}/${target.launchdLabel}`
  ]);
}

async function readManagedRuntimeSnapshot(target: WatchdogTarget): Promise<TargetRuntimeSnapshot> {
  if (target.systemdUnit) {
    const activeResult = await execFileAsync("systemctl", ["is-active", target.systemdUnit])
      .then((result) => result.stdout.trim())
      .catch((error) => {
        const stderr = error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "").trim()
          : "";
        return stderr || (error instanceof Error ? error.message : String(error));
      });
    const statusResult = await execFileAsync("systemctl", ["status", target.systemdUnit, "--no-pager", "-n", "20"])
      .then((result) => result.stdout.trim().slice(-2_000))
      .catch((error) => {
        const stdout = error && typeof error === "object" && "stdout" in error
          ? String((error as { stdout?: unknown }).stdout ?? "").trim()
          : "";
        return stdout.slice(-2_000);
      });

    return {
      tmuxSession: target.tmuxSession,
      tmuxPresent: false,
      systemdUnit: target.systemdUnit,
      systemdActive: activeResult === "active",
      ...(statusResult ? { systemdStatus: statusResult } : {}),
      ...(activeResult && activeResult !== "active" ? { error: activeResult } : {})
    };
  }

  try {
    await execFileAsync("tmux", ["has-session", "-t", target.tmuxSession]);
  } catch (error) {
    return {
      tmuxSession: target.tmuxSession,
      tmuxPresent: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const paneCommand = await execFileAsync("tmux", [
    "display-message",
    "-p",
    "-t",
    target.tmuxSession,
    "#{pane_current_command}"
  ])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const paneTail = await execFileAsync("tmux", ["capture-pane", "-p", "-t", target.tmuxSession, "-S", "-20"])
    .then((result) => result.stdout.trim().slice(-2_000))
    .catch(() => "");

  return {
    tmuxSession: target.tmuxSession,
    tmuxPresent: true,
    ...(paneCommand ? { paneCommand } : {}),
    ...(paneTail ? { paneTail } : {})
  };
}

export async function runWatchdogTick(
  options: WatchdogOptions,
  state: WatchdogState = {
    failures: new Map(),
    restartHistory: new Map(),
    cooldownUntil: new Map(),
    alertedTargets: new Set()
  },
  deps: WatchdogDeps = {}
): Promise<TargetReceipt[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const restartTarget = deps.restartTarget ?? restartManagedTarget;
  const sendAlert = deps.sendAlert ?? sendPlatformAlert;
  const alertedTargets = (state.alertedTargets ??= new Set());
  const readRuntimeSnapshot = deps.readRuntimeSnapshot ?? readManagedRuntimeSnapshot;
  const receipts: TargetReceipt[] = [];
  const staleChunkErrorSeen = await hasRecentStaleChunkError(options.staleChunkLogPath);

  for (const target of options.targets) {
    const probe = await probeTarget(target, fetchImpl);
    let failures = probe.ok ? 0 : (state.failures.get(target.name) ?? 0) + 1;
    state.failures.set(target.name, failures);

    const receipt: TargetReceipt = {
      ...probe,
      failures,
      action: "none"
    };

    if (!probe.ok) {
      receipt.failureKind = classifyProbeFailure(target, probe);
      if (
        staleChunkErrorSeen &&
        (target.name === "frontend" || target.name.startsWith("frontend_"))
      ) {
        receipt.failureKind = "frontend_stale_chunks";
        failures = Math.max(failures, options.failureThreshold);
        state.failures.set(target.name, failures);
        receipt.failures = failures;
      }
      receipt.runtime = await readRuntimeSnapshot(target);
    }

    if (!probe.ok && failures >= options.failureThreshold) {
      if (!options.execute) {
        receipt.action = "would_restart";
      } else {
        const nowMs = Date.now();
        const cooldownUntil = state.cooldownUntil.get(target.name) ?? 0;
        const restartHistory = (state.restartHistory.get(target.name) ?? [])
          .filter((restartedAtMs) => nowMs - restartedAtMs <= options.restartWindowMs);

        if (cooldownUntil > nowMs) {
          receipt.action = "restart_blocked";
          receipt.cooldownUntil = new Date(cooldownUntil).toISOString();
        } else if (restartHistory.length >= options.maxRestartsPerWindow) {
          const nextAllowedAt = nowMs + options.restartCooldownMs;
          state.cooldownUntil.set(target.name, nextAllowedAt);
          state.restartHistory.set(target.name, restartHistory);
          receipt.action = "restart_blocked";
          receipt.cooldownUntil = new Date(nextAllowedAt).toISOString();
          receipt.actionError = "max_restarts_per_window";
        } else {
          try {
            await restartTarget(target);
            restartHistory.push(nowMs);
            state.restartHistory.set(target.name, restartHistory);
            receipt.action = "restarted";
            state.failures.set(target.name, 0);
          } catch (error) {
            receipt.action = "restart_failed";
            receipt.actionError = error instanceof Error ? error.message : String(error);
          }
        }
      }
    }

    // Two alerts per outage: page on the tick that crosses the threshold
    // (with whatever action was taken), page again on recovery. The
    // alertedTargets gate keeps a long outage from spamming every tick.
    if (!probe.ok && failures >= options.failureThreshold && !alertedTargets.has(target.name)) {
      const detail = receipt.actionError ? ` (${receipt.actionError})` : "";
      const sent = await sendAlert(
        `🔴 watchdog: ${target.name} down — ${receipt.failureKind ?? "probe_failed"} after ${failures} checks; action: ${receipt.action}${detail}`
      );
      if (sent !== false) {
        alertedTargets.add(target.name);
        receipt.alerted = "down";
      }
    } else if (probe.ok && alertedTargets.has(target.name)) {
      const sent = await sendAlert(`🟢 watchdog: ${target.name} recovered`);
      if (sent !== false) {
        alertedTargets.delete(target.name);
        receipt.alerted = "recovered";
      }
    }

    receipts.push(receipt);
  }

  const prewarm = await prewarmTrendingReads(options, receipts, fetchImpl);

  await (deps.appendReceipt ?? ((line) => appendJsonl(options.receiptPath, line)))({
    event: "platform_watchdog_tick",
    runId: options.runId,
    at: new Date().toISOString(),
    execute: options.execute,
    failureThreshold: options.failureThreshold,
    targets: receipts,
    prewarm
  });

  return receipts;
}

function readActionCount(actions: Record<string, number>, action: string): number {
  return actions[action] ?? 0;
}

export function summarizeWatchdogReceiptLines(text: string): WatchdogSummary {
  type MutableTargetSummary = TargetSummary & {
    currentOutageTicks: number;
    currentOutageStartedAtMs: number | null;
  };

  const targets = new Map<string, MutableTargetSummary>();
  let ticks = 0;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let lastAtMs: number | null = null;

  function readTarget(name: string): MutableTargetSummary {
    const existing = targets.get(name);
    if (existing) {
      return existing;
    }

    const next: MutableTargetSummary = {
      name,
      checks: 0,
      ok: 0,
      failed: 0,
      passRate: 0,
      longestOutageTicks: 0,
      longestOutageMs: 0,
      actions: {},
      currentOutageTicks: 0,
      currentOutageStartedAtMs: null
    };
    targets.set(name, next);
    return next;
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const receipt = JSON.parse(line) as {
      event?: unknown;
      at?: unknown;
      targets?: unknown;
    };

    if (receipt.event !== "platform_watchdog_tick" || !Array.isArray(receipt.targets)) {
      continue;
    }

    ticks += 1;
    const at = typeof receipt.at === "string" ? receipt.at : null;
    const atMs = at ? Date.parse(at) : Number.NaN;
    if (at && !startedAt) {
      startedAt = at;
    }
    if (at) {
      endedAt = at;
    }
    if (Number.isFinite(atMs)) {
      lastAtMs = atMs;
    }

    for (const rawTarget of receipt.targets) {
      if (!rawTarget || typeof rawTarget !== "object") {
        continue;
      }

      const target = rawTarget as { name?: unknown; ok?: unknown; action?: unknown };
      if (typeof target.name !== "string") {
        continue;
      }

      const summary = readTarget(target.name);
      summary.checks += 1;
      const action = typeof target.action === "string" ? target.action : "unknown";
      summary.actions[action] = (summary.actions[action] ?? 0) + 1;

      if (target.ok === true) {
        summary.ok += 1;
        if (summary.currentOutageTicks > 0) {
          summary.longestOutageTicks = Math.max(summary.longestOutageTicks, summary.currentOutageTicks);
          if (summary.currentOutageStartedAtMs !== null && Number.isFinite(atMs)) {
            summary.longestOutageMs = Math.max(summary.longestOutageMs, atMs - summary.currentOutageStartedAtMs);
          }
        }
        summary.currentOutageTicks = 0;
        summary.currentOutageStartedAtMs = null;
      } else {
        summary.failed += 1;
        summary.currentOutageTicks += 1;
        if (summary.currentOutageStartedAtMs === null && Number.isFinite(atMs)) {
          summary.currentOutageStartedAtMs = atMs;
        }
      }
    }
  }

  const finalTargets = [...targets.values()].map((summary) => {
    if (summary.currentOutageTicks > 0) {
      summary.longestOutageTicks = Math.max(summary.longestOutageTicks, summary.currentOutageTicks);
      if (summary.currentOutageStartedAtMs !== null && lastAtMs !== null) {
        summary.longestOutageMs = Math.max(summary.longestOutageMs, lastAtMs - summary.currentOutageStartedAtMs);
      }
    }

    return {
      name: summary.name,
      checks: summary.checks,
      ok: summary.ok,
      failed: summary.failed,
      passRate: summary.checks > 0 ? Number((summary.ok / summary.checks).toFixed(4)) : 0,
      longestOutageTicks: summary.longestOutageTicks,
      longestOutageMs: summary.longestOutageMs,
      actions: summary.actions
    };
  });

  const hasRestartFailure = finalTargets.some((target) => readActionCount(target.actions, "restart_failed") > 0);
  const hasFailure = finalTargets.some((target) => target.failed > 0);
  const hasRestart = finalTargets.some((target) => readActionCount(target.actions, "restarted") > 0);
  const hasBlocked = finalTargets.some((target) => readActionCount(target.actions, "restart_blocked") > 0);
  const verdict = hasRestartFailure ? "bad" : hasFailure || hasRestart || hasBlocked ? "watch" : "ok";

  return {
    event: "platform_watchdog_summary",
    ticks,
    startedAt,
    endedAt,
    verdict,
    targets: finalTargets
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function run(): Promise<void> {
  const options = parseWatchdogOptions();

  if (process.argv.includes("--summary")) {
    const text = await readFile(options.receiptPath, "utf8");
    const summary = summarizeWatchdogReceiptLines(text);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.verdict === "bad") {
      process.exitCode = 1;
    }
    return;
  }

  const state: WatchdogState = {
    failures: new Map(),
    restartHistory: new Map(),
    cooldownUntil: new Map(),
    alertedTargets: new Set()
  };
  let tick = 0;

  while (options.loop || tick === 0) {
    tick += 1;
    const receipts = await runWatchdogTick(options, state);
    console.log(JSON.stringify({
      event: "platform_watchdog_tick",
      runId: options.runId,
      tick,
      execute: options.execute,
      receiptPath: options.receiptPath,
      targets: receipts
    }));

    if (!options.loop || (options.iterations && tick >= options.iterations)) {
      break;
    }

    await sleep(options.intervalMs);
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
