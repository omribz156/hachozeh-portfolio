import { describe, expect, it, vi } from "vitest";

import {
  parseWatchdogOptions,
  runWatchdogTick,
  summarizeWatchdogReceiptLines,
  type WatchdogOptions
} from "../../src/scripts/platform-watchdog";

function slashPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function makeOptions(overrides: Partial<WatchdogOptions> = {}): WatchdogOptions {
  return {
    runId: "test-watchdog",
    execute: false,
    loop: false,
    iterations: 1,
    intervalMs: 1000,
    prewarmTrendingReads: false,
    prewarmTrendingLimit: 6,
    prewarmHistoryRange: "1D",
    prewarmTimeoutMs: 100,
    failureThreshold: 2,
    restartCooldownMs: 60_000,
    restartWindowMs: 10 * 60_000,
    maxRestartsPerWindow: 3,
    staleChunkLogPath: "/tmp/navi-watchdog-web.err.log",
    receiptPath: "/tmp/navi-watchdog-test.jsonl",
    targets: [
      {
        name: "backend",
        url: "http://backend.test/ready",
        tmuxSession: "codex-navi-back",
        restartCommand: "npm --prefix systems/back run dev",
        timeoutMs: 50
      }
    ],
    ...overrides
  };
}

describe("platform watchdog", () => {
  it("defaults to one dry-run tick unless loop is requested", () => {
    const options = parseWatchdogOptions([]);

    expect(options.execute).toBe(false);
    expect(options.loop).toBe(false);
    expect(options.iterations).toBe(1);
    expect(options.prewarmTrendingReads).toBe(false);
    expect(parseWatchdogOptions(["--prewarm-trending-reads"]).prewarmTrendingReads).toBe(true);
    expect(slashPath(options.receiptPath)).toContain("workspace/runtime/watchdog/");
    expect(options.maxRestartsPerWindow).toBe(3);
    expect(options.targets.map((target) => target.name)).toEqual([
      "backend",
      "frontend_portfolio",
      "frontend_settings",
      "frontend_breaking",
      "frontend_topic"
    ]);
    expect(options.targets.find((target) => target.name === "frontend_portfolio")).toMatchObject({
      url: "http://127.0.0.1:6969/portfolio",
      tmuxSession: "codex-web",
      restartCommand: "npm --prefix systems/web run dev"
    });
  });

  it("maps production systemd units onto watchdog targets when configured", () => {
    const previousBackUnit = process.env.WATCHDOG_BACK_SYSTEMD_UNIT;
    const previousFrontUnit = process.env.WATCHDOG_FRONT_SYSTEMD_UNIT;
    process.env.WATCHDOG_BACK_SYSTEMD_UNIT = "hachozeh-backend.service";
    process.env.WATCHDOG_FRONT_SYSTEMD_UNIT = "hachozeh-web.service";

    try {
      const options = parseWatchdogOptions([]);

      expect(options.targets.find((target) => target.name === "backend")).toMatchObject({
        systemdUnit: "hachozeh-backend.service"
      });
      expect(options.targets.find((target) => target.name === "frontend_portfolio")).toMatchObject({
        systemdUnit: "hachozeh-web.service"
      });
    } finally {
      if (previousBackUnit === undefined) {
        delete process.env.WATCHDOG_BACK_SYSTEMD_UNIT;
      } else {
        process.env.WATCHDOG_BACK_SYSTEMD_UNIT = previousBackUnit;
      }

      if (previousFrontUnit === undefined) {
        delete process.env.WATCHDOG_FRONT_SYSTEMD_UNIT;
      } else {
        process.env.WATCHDOG_FRONT_SYSTEMD_UNIT = previousFrontUnit;
      }
    }
  });

  it("prewarms top trending backend reads when enabled and backend is healthy", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);

      if (target.endsWith("/ready")) {
        return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
      }

      if (target.includes("/api/discovery/feed")) {
        return new Response(
          JSON.stringify({
            items: [
              { marketKey: "market-a", marketStatus: "open" },
              { marketKey: "closed-market", marketStatus: "resolved" },
              { marketKey: "market-b", marketStatus: "open" }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    const appendReceipt = vi.fn();

    await runWatchdogTick(
      makeOptions({
        prewarmTrendingReads: true,
        prewarmTrendingLimit: 2,
        prewarmHistoryRange: "1D"
      }),
      undefined,
      { fetchImpl, appendReceipt }
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://backend.test/api/discovery/feed?feed=trending", expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/market-detail/markets/market-a",
      expect.anything()
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/markets/market-a/history?range=1D",
      expect.anything()
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/market-detail/markets/market-b",
      expect.anything()
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/markets/market-b/history?range=1D",
      expect.anything()
    );
    expect(appendReceipt).toHaveBeenCalledWith(expect.objectContaining({
      prewarm: expect.objectContaining({
        enabled: true,
        attempted: 2,
        warmed: 2,
        selectedMarkets: ["market-a", "market-b"],
        failures: []
      })
    }));
  });

  it("marks restart as would_restart after threshold in dry-run mode", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 503 })) as unknown as typeof fetch;
    const restartTarget = vi.fn();
    const readRuntimeSnapshot = vi.fn(async () => ({
      tmuxSession: "codex-navi-back",
      tmuxPresent: true,
      paneCommand: "node",
      paneTail: "Waiting for graceful termination..."
    }));
    const appendReceipt = vi.fn();
    const state = {
      failures: new Map<string, number>(),
      restartHistory: new Map<string, number[]>(),
      cooldownUntil: new Map<string, number>()
    };

    await runWatchdogTick(makeOptions(), state, { fetchImpl, restartTarget, readRuntimeSnapshot, appendReceipt });
    const receipts = await runWatchdogTick(makeOptions(), state, {
      fetchImpl,
      restartTarget,
      readRuntimeSnapshot,
      appendReceipt
    });

    expect(receipts[0]).toMatchObject({
      name: "backend",
      ok: false,
      status: 503,
      failures: 2,
      action: "would_restart",
      failureKind: "backend_not_ready",
      runtime: {
        tmuxSession: "codex-navi-back",
        paneCommand: "node"
      }
    });
    expect(restartTarget).not.toHaveBeenCalled();
    expect(readRuntimeSnapshot).toHaveBeenCalledTimes(2);
    expect(appendReceipt).toHaveBeenCalledTimes(2);
  });

  it("executes scoped restart after threshold when execute is enabled", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 503 })) as unknown as typeof fetch;
    const restartTarget = vi.fn(async () => undefined);
    const appendReceipt = vi.fn();
    const state = {
      failures: new Map<string, number>(),
      restartHistory: new Map<string, number[]>(),
      cooldownUntil: new Map<string, number>()
    };
    const options = makeOptions({ execute: true, failureThreshold: 1 });

    const receipts = await runWatchdogTick(options, state, { fetchImpl, restartTarget, appendReceipt });

    expect(receipts[0]).toMatchObject({
      name: "backend",
      action: "restarted"
    });
    expect(restartTarget).toHaveBeenCalledWith(options.targets[0]);
    expect(state.failures.get("backend")).toBe(0);
  });

  it("classifies stale Astro chunks as an immediate frontend failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 500 })) as unknown as typeof fetch;
    const restartTarget = vi.fn();
    const appendReceipt = vi.fn();
    const readRuntimeSnapshot = vi.fn(async () => ({ tmuxSession: "codex-web", tmuxPresent: false }));
    const options = makeOptions({
      targets: [
        {
          name: "frontend_portfolio",
          url: "http://front.test/portfolio",
          tmuxSession: "codex-web",
          restartCommand: "npm --prefix systems/web run dev",
          timeoutMs: 50
        }
      ],
      failureThreshold: 3,
      staleChunkLogPath: "/tmp/navi-watchdog-stale-test.log"
    });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        options.staleChunkLogPath,
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/developer/Projects/navi/systems/web/dist/server/chunks/portfolio_dead.mjs'"
      )
    );

    const receipts = await runWatchdogTick(options, undefined, {
      fetchImpl,
      restartTarget,
      appendReceipt,
      readRuntimeSnapshot
    });

    expect(receipts[0]).toMatchObject({
      failureKind: "frontend_stale_chunks",
      failures: 3,
      action: "would_restart"
    });
  });

  it("blocks execute restart loops after the configured window limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 503 })) as unknown as typeof fetch;
    const restartTarget = vi.fn(async () => undefined);
    const appendReceipt = vi.fn();
    const state = {
      failures: new Map<string, number>(),
      restartHistory: new Map<string, number[]>(),
      cooldownUntil: new Map<string, number>()
    };
    const options = makeOptions({
      execute: true,
      failureThreshold: 1,
      maxRestartsPerWindow: 1,
      restartCooldownMs: 30_000
    });

    const first = await runWatchdogTick(options, state, { fetchImpl, restartTarget, appendReceipt });
    const second = await runWatchdogTick(options, state, { fetchImpl, restartTarget, appendReceipt });

    expect(first[0].action).toBe("restarted");
    expect(second[0]).toMatchObject({
      action: "restart_blocked",
      actionError: "max_restarts_per_window"
    });
    expect(restartTarget).toHaveBeenCalledTimes(1);
  });

  it("summarizes watchdog JSONL receipts", () => {
    const summary = summarizeWatchdogReceiptLines([
      JSON.stringify({
        event: "platform_watchdog_tick",
        at: "2026-05-28T10:00:00.000Z",
        targets: [
          { name: "backend", ok: true, action: "none" },
          { name: "frontend", ok: true, action: "none" }
        ]
      }),
      JSON.stringify({
        event: "platform_watchdog_tick",
        at: "2026-05-28T10:00:30.000Z",
        targets: [
          { name: "backend", ok: false, action: "would_restart" },
          { name: "frontend", ok: true, action: "none" }
        ]
      }),
      JSON.stringify({
        event: "platform_watchdog_tick",
        at: "2026-05-28T10:01:00.000Z",
        targets: [
          { name: "backend", ok: true, action: "none" },
          { name: "frontend", ok: true, action: "none" }
        ]
      })
    ].join("\n"));

    expect(summary.verdict).toBe("watch");
    expect(summary.ticks).toBe(3);
    expect(summary.targets.find((target) => target.name === "backend")).toMatchObject({
      checks: 3,
      ok: 2,
      failed: 1,
      passRate: 0.6667,
      longestOutageTicks: 1,
      longestOutageMs: 30000,
      actions: {
        none: 2,
        would_restart: 1
      }
    });
  });
});

describe("platform watchdog alerting", () => {
  function freshState() {
    return {
      failures: new Map<string, number>(),
      restartHistory: new Map<string, number[]>(),
      cooldownUntil: new Map<string, number>()
    };
  }

  it("pages exactly once when a target crosses the failure threshold", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 503 })) as unknown as typeof fetch;
    const restartTarget = vi.fn();
    const readRuntimeSnapshot = vi.fn(async () => ({ tmuxSession: "s", tmuxPresent: false }));
    const appendReceipt = vi.fn();
    const sendAlert = vi.fn(async () => {});
    const state = freshState();
    const options = makeOptions({ failureThreshold: 2 });
    const deps = { fetchImpl, restartTarget, readRuntimeSnapshot, appendReceipt, sendAlert };

    const first = await runWatchdogTick(options, state, deps);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(first[0].alerted).toBeUndefined();

    const second = await runWatchdogTick(options, state, deps);
    const downAlerts = sendAlert.mock.calls.filter(([m]) => String(m).includes("down"));
    expect(downAlerts.length).toBeGreaterThanOrEqual(1);
    expect(second[0].alerted).toBe("down");
    expect(String(sendAlert.mock.calls[0][0])).toContain("🔴 watchdog: backend down");

    const callsAfterBreach = sendAlert.mock.calls.length;
    await runWatchdogTick(options, state, deps);
    expect(sendAlert.mock.calls.length).toBe(callsAfterBreach);
  });

  it("pages recovery once and re-arms for the next outage", async () => {
    let healthy = false;
    const fetchImpl = vi.fn(async () =>
      healthy ? new Response("{}", { status: 200 }) : new Response("dead", { status: 503 })
    ) as unknown as typeof fetch;
    const restartTarget = vi.fn();
    const readRuntimeSnapshot = vi.fn(async () => ({ tmuxSession: "s", tmuxPresent: false }));
    const appendReceipt = vi.fn();
    const sendAlert = vi.fn(async () => {});
    const state = freshState();
    const options = makeOptions({ failureThreshold: 1 });
    const deps = { fetchImpl, restartTarget, readRuntimeSnapshot, appendReceipt, sendAlert };

    await runWatchdogTick(options, state, deps);
    healthy = true;
    const recovered = await runWatchdogTick(options, state, deps);
    expect(recovered[0].alerted).toBe("recovered");
    const recoveredMessages = sendAlert.mock.calls.filter(([m]) => String(m).includes("🟢"));
    expect(recoveredMessages.length).toBe(1); // makeOptions has a single backend target

    healthy = false;
    const downAgain = await runWatchdogTick(options, state, deps);
    expect(downAgain[0].alerted).toBe("down"); // gate re-armed after recovery
  });

  it("retries an outage alert when delivery fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("dead", { status: 503 })) as unknown as typeof fetch;
    const sendAlert = vi.fn(async () => false);
    const state = freshState();
    const options = makeOptions({ failureThreshold: 1 });
    const deps = {
      fetchImpl,
      restartTarget: vi.fn(),
      readRuntimeSnapshot: vi.fn(async () => ({ tmuxSession: "s", tmuxPresent: false })),
      appendReceipt: vi.fn(),
      sendAlert
    };

    const first = await runWatchdogTick(options, state, deps);
    const second = await runWatchdogTick(options, state, deps);

    expect(first[0].alerted).toBeUndefined();
    expect(second[0].alerted).toBeUndefined();
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });
});
