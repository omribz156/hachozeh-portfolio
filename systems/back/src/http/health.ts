import type { AppEnv } from "../config/env";
import type { Pool } from "pg";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { checkDatabaseReadiness } from "../db/readiness";
import { readMarketDetailPassiveRecordCacheStats } from "../db/read-models/market-detail-passive";
import { readMarketApiReadCacheStats } from "../markets/market-api/cache";
import { PLATFORM_TREASURY_LOW_WATERMARK } from "../economy/economy-config";
import {
  buildEconomyTelemetryWindow,
  readEconomyTelemetry
} from "../economy/economy-telemetry-service";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import type { MarketStreamBus } from "./market-stream-bus";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";
import type { DiscoveryStreamLimiter } from "./discovery-stream-limiter";
import type { StreamConnectionLimiter } from "./stream-connection-limiter";
import { readRequestMetricsSnapshot } from "./request-metrics";

function bytesToMiB(value: number): number {
  return Number((value / 1024 / 1024).toFixed(2));
}

type DiagnosticVerdict = "ok" | "watch" | "bad";

function readThreshold(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringEnv(names: string[], fallback: string | null = null): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

function readPositiveNumberEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const value = process.env[name];
    if (!value || !value.trim()) {
      continue;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function readPositiveMoneyEnv(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (!value || !value.trim()) {
      continue;
    }

    try {
      const parsed = toDecimal(value);
      if (parsed.gt(0)) {
        return parsed.toFixed(6);
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

function inferRepoRoot(): string {
  if (process.env.NAVI_REPO_ROOT) {
    return resolve(process.env.NAVI_REPO_ROOT);
  }

  if (process.env.INIT_CWD && existsSync(resolve(process.env.INIT_CWD, "systems/back/package.json"))) {
    return resolve(process.env.INIT_CWD);
  }

  if (existsSync(resolve(process.cwd(), "systems/back/package.json"))) {
    return process.cwd();
  }

  if (existsSync(resolve(process.cwd(), "../../systems/back/package.json"))) {
    return resolve(process.cwd(), "../..");
  }

  return process.cwd();
}

function resolveRuntimePath(path: string): string {
  return isAbsolute(path) ? path : resolve(inferRepoRoot(), path);
}

function buildDiagnosticHealth(memory: NodeJS.MemoryUsage): {
  verdict: DiagnosticVerdict;
  warnings: string[];
  thresholds: Record<string, number>;
} {
  const rssMiB = bytesToMiB(memory.rss);
  const heapUsedMiB = bytesToMiB(memory.heapUsed);
  const thresholds = {
    rssWatchMiB: readThreshold("BACKEND_RSS_WATCH_MIB", 512),
    rssBadMiB: readThreshold("BACKEND_RSS_BAD_MIB", 1024),
    heapUsedWatchMiB: readThreshold("BACKEND_HEAP_USED_WATCH_MIB", 256),
    heapUsedBadMiB: readThreshold("BACKEND_HEAP_USED_BAD_MIB", 512)
  };
  const warnings: string[] = [];
  let verdict: DiagnosticVerdict = "ok";

  if (rssMiB >= thresholds.rssBadMiB) {
    verdict = "bad";
    warnings.push(`rss_bad:${rssMiB}MiB`);
  } else if (rssMiB >= thresholds.rssWatchMiB) {
    verdict = "watch";
    warnings.push(`rss_watch:${rssMiB}MiB`);
  }

  if (heapUsedMiB >= thresholds.heapUsedBadMiB) {
    verdict = "bad";
    warnings.push(`heap_used_bad:${heapUsedMiB}MiB`);
  } else if (heapUsedMiB >= thresholds.heapUsedWatchMiB && verdict !== "bad") {
    verdict = "watch";
    warnings.push(`heap_used_watch:${heapUsedMiB}MiB`);
  }

  return {
    verdict,
    warnings,
    thresholds
  };
}

export function buildLivenessPayload(env: AppEnv) {
  return {
    service: env.serviceName,
    status: "ok",
    environment: env.nodeEnv,
    uptimeMs: Math.round(process.uptime() * 1000),
    now: new Date().toISOString()
  };
}

export async function buildReadinessPayload(env: AppEnv) {
  const database = await checkDatabaseReadiness(env.db);

  return {
    service: env.serviceName,
    status: database.ok ? "ready" : "not_ready",
    now: new Date().toISOString(),
    dependencies: {
      postgres: database
    }
  };
}

async function readLatestLifecycleHeartbeatSnapshot(dbPool?: Pool): Promise<Record<string, unknown> | null> {
  if (!dbPool) {
    return null;
  }

  try {
    const result = await dbPool.query<{
      id: string;
      generated_at: Date;
      summary_snapshot: Record<string, unknown> | null;
    }>(
      `
        select id, generated_at, summary_snapshot
        from oracle_runtime_snapshots
        where runtime_type = 'lifecycle-heartbeat'
        order by generated_at desc, created_at desc
        limit 1
      `
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      snapshotId: row.id,
      generatedAt: row.generated_at.toISOString(),
      summary: row.summary_snapshot ?? {}
    };
  } catch {
    return null;
  }
}

async function readLatestHorizonSchedulerSnapshot(dbPool?: Pool): Promise<Record<string, unknown> | null> {
  if (!dbPool) {
    return null;
  }

  try {
    const result = await dbPool.query<{
      id: string;
      generated_at: Date;
      summary_snapshot: Record<string, unknown> | null;
    }>(
      `
        select id, generated_at, summary_snapshot
        from oracle_runtime_snapshots
        where runtime_type = 'horizon-scheduler'
        order by generated_at desc, created_at desc
        limit 1
      `
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      snapshotId: row.id,
      generatedAt: row.generated_at.toISOString(),
      summary: row.summary_snapshot ?? {}
    };
  } catch {
    return null;
  }
}

async function readMigrationSnapshot(dbPool?: Pool): Promise<Record<string, unknown>> {
  if (!dbPool) {
    return {
      status: "unavailable",
      latest: null,
      count: null
    };
  }

  try {
    const result = await dbPool.query<{
      latest: string | null;
      count: number | string;
    }>(
      `
        select max(name) as latest, count(*)::int as count
        from schema_migrations
      `
    );
    const row = result.rows[0];

    return {
      status: "ok",
      latest: row?.latest ?? null,
      count: typeof row?.count === "number" ? row.count : Number(row?.count ?? 0)
    };
  } catch {
    return {
      status: "unavailable",
      latest: null,
      count: null
    };
  }
}

async function readEconomySnapshot(dbPool?: Pool): Promise<Record<string, unknown>> {
  if (!dbPool) {
    return {
      status: "unavailable",
      platformTreasury: null,
      mintSource: null,
      faucetTables: null,
      flow: null
    };
  }

  try {
    const [accountsResult, tablesResult] = await Promise.all([
      dbPool.query<{
        type: string;
        id: string;
        status: string;
        balance_cached: string;
      }>(
        `
          select type, id, status, balance_cached::text as balance_cached
          from accounts
          where type in ('platform_treasury', 'mint_source')
          order by type
        `
      ),
      dbPool.query<{
        user_faucet_state_exists: boolean;
        faucet_claims_exists: boolean;
      }>(
        `
          select
            to_regclass('public.user_faucet_state') is not null as user_faucet_state_exists,
            to_regclass('public.faucet_claims') is not null as faucet_claims_exists
        `
      )
    ]);
    const platformTreasury = accountsResult.rows.find((row) => row.type === "platform_treasury") ?? null;
    const mintSource = accountsResult.rows.find((row) => row.type === "mint_source") ?? null;
    const platformBalance = platformTreasury ? toDecimal(platformTreasury.balance_cached) : null;
    const lowWatermark = toDecimal(PLATFORM_TREASURY_LOW_WATERMARK);
    const platformVerdict = !platformTreasury
      ? "missing"
      : platformBalance && platformBalance.lt(0)
        ? "bad"
        : platformBalance && platformBalance.lt(lowWatermark)
          ? "watch"
          : "ok";
    let flow: Record<string, unknown>;

    try {
      const telemetry = await readEconomyTelemetry(
        dbPool,
        buildEconomyTelemetryWindow(1)
      );
      const faucetOutflow24h = telemetry.faucetFlow.reduce(
        (sum, row) => sum.plus(row.rewardTotal),
        toDecimal(0)
      );
      const faucetOutflowWatch = toDecimal(
        readPositiveMoneyEnv(["ECONOMY_FAUCET_OUTFLOW_24H_WATCH"], "1000000.000000")
      );
      const flowStatus = faucetOutflow24h.gt(faucetOutflowWatch) ? "watch" : "ok";

      flow = {
        status: flowStatus,
        from: telemetry.from,
        to: telemetry.to,
        netGrantFlowPerActiveUser: telemetry.netGrantFlowPerActiveUser,
        faucetOutflow24h: quantizeMoney(faucetOutflow24h),
        faucetOutflow24hWatch: quantizeMoney(faucetOutflowWatch),
        activeUsers: telemetry.activeUsers
      };
    } catch (error) {
      flow = {
        status: "unavailable",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      status:
        platformVerdict === "bad" || platformVerdict === "missing"
          ? "bad"
          : platformVerdict === "watch"
            ? "watch"
            : "ok",
      platformTreasury: platformTreasury
        ? {
            accountId: platformTreasury.id,
            accountStatus: platformTreasury.status,
            balance: platformTreasury.balance_cached,
            lowWatermark: PLATFORM_TREASURY_LOW_WATERMARK,
            verdict: platformVerdict
          }
        : {
            accountId: null,
            accountStatus: "missing",
            balance: null,
            lowWatermark: PLATFORM_TREASURY_LOW_WATERMARK,
            verdict: "missing"
          },
      mintSource: mintSource
        ? {
            accountId: mintSource.id,
            accountStatus: mintSource.status,
            balance: mintSource.balance_cached
          }
        : null,
      faucetTables: {
        userFaucetState: Boolean(tablesResult.rows[0]?.user_faucet_state_exists),
        faucetClaims: Boolean(tablesResult.rows[0]?.faucet_claims_exists)
      },
      flow
    };
  } catch (error) {
    return {
      status: "unavailable",
      platformTreasury: null,
      mintSource: null,
      faucetTables: null,
      flow: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readBackupSnapshot(): Promise<Record<string, unknown>> {
  const backupDir = resolveRuntimePath(
    readStringEnv(["NAVI_BACKUP_DIR", "BACKUP_DIR"], "workspace/backups") ?? "workspace/backups"
  );
  const watchAgeMs = readPositiveNumberEnv(
    ["NAVI_BACKUP_WATCH_AGE_MS", "BACKUP_WATCH_AGE_MS"],
    25 * 60 * 60 * 1000
  );

  try {
    const names = await readdir(backupDir);
    const candidates = await Promise.all(
      names
        .filter((name) => name.endsWith(".dump"))
        .map(async (name) => {
          const path = resolve(backupDir, name);
          const stats = await stat(path);
          return {
            name,
            mtimeMs: stats.mtimeMs
          };
        })
    );
    const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

    if (!latest) {
      return {
        status: "missing",
        source: "local-dir",
        latestName: null,
        latestCreatedAt: null,
        ageMs: null,
        watchAgeMs
      };
    }

    const ageMs = Math.max(0, Date.now() - latest.mtimeMs);

    return {
      status: ageMs >= watchAgeMs ? "watch" : "ok",
      source: "local-dir",
      latestName: latest.name,
      latestCreatedAt: new Date(latest.mtimeMs).toISOString(),
      ageMs,
      watchAgeMs
    };
  } catch (error) {
    return {
      status: "unavailable",
      source: "local-dir",
      latestName: null,
      latestCreatedAt: null,
      ageMs: null,
      watchAgeMs,
      errorCode: typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown"
    };
  }
}

function buildRuntimeIdentity(env: AppEnv): Record<string, unknown> {
  return {
    service: env.serviceName,
    environment: env.nodeEnv,
    commitSha: readStringEnv([
      "NAVI_COMMIT_SHA",
      "RUNTIME_COMMIT_SHA",
      "GIT_COMMIT_SHA",
      "COMMIT_SHA",
      "RENDER_GIT_COMMIT",
      "VERCEL_GIT_COMMIT_SHA",
      "CF_PAGES_COMMIT_SHA"
    ]),
    buildTimestamp: readStringEnv([
      "NAVI_BUILD_TIMESTAMP",
      "RUNTIME_BUILD_TIMESTAMP",
      "BUILD_TIMESTAMP",
      "SOURCE_DATE_EPOCH"
    ]),
    releaseId: readStringEnv([
      "NAVI_RELEASE_ID",
      "RUNTIME_RELEASE_ID",
      "RELEASE_ID",
      "RENDER_GIT_COMMIT",
      "VERCEL_GIT_COMMIT_SHA",
      "CF_PAGES_COMMIT_SHA"
    ])
  };
}

export async function buildDiagnosticsPayload(
  env: AppEnv,
  options?: {
    dbPool?: Pool;
    marketStreamBus?: MarketStreamBus;
    portfolioStreamBus?: PortfolioStreamBus;
    discoveryStreamLimiter?: DiscoveryStreamLimiter;
    streamConnectionLimiter?: StreamConnectionLimiter;
  }
) {
  const memory = process.memoryUsage();
  const latestLifecycleHeartbeat = await readLatestLifecycleHeartbeatSnapshot(options?.dbPool);
  const latestHorizonScheduler = await readLatestHorizonSchedulerSnapshot(options?.dbPool);
  const migration = await readMigrationSnapshot(options?.dbPool);
  const economy = await readEconomySnapshot(options?.dbPool);
  const backup = await readBackupSnapshot();
  const poolStats = options?.dbPool
    ? {
        totalCount: options.dbPool.totalCount ?? null,
        idleCount: options.dbPool.idleCount ?? null,
        waitingCount: options.dbPool.waitingCount ?? null
      }
    : null;

  // SSE connection-cap saturation, so a monitor on /health can alert BEFORE the buses start
  // returning 429s. The market + portfolio buses are the dominant connection consumers (a
  // market page + the always-on portfolio shell stream); each reports its total cap so the
  // ratio is computable here. Tune caps via the *_STREAM_MAX_TOTAL_CONNECTIONS env vars.
  const SATURATION_WARN_RATIO = 0.8;
  const marketStreamStats = options?.marketStreamBus?.getStats() ?? {
    markets: 0,
    connections: 0,
    maxConnections: 0
  };
  const portfolioStreamStats = options?.portfolioStreamBus?.getStats() ?? {
    actors: 0,
    connections: 0,
    maxConnections: 0
  };
  const saturationOf = (stats: { connections: number; maxConnections: number }) => {
    const ratio = stats.maxConnections > 0 ? stats.connections / stats.maxConnections : 0;
    return { ratio: Math.round(ratio * 100) / 100, warn: ratio >= SATURATION_WARN_RATIO };
  };
  const marketSaturation = saturationOf(marketStreamStats);
  const portfolioSaturation = saturationOf(portfolioStreamStats);

  return {
    service: env.serviceName,
    status: "ok",
    health: buildDiagnosticHealth(memory),
    environment: env.nodeEnv,
    uptimeMs: Math.round(process.uptime() * 1000),
    now: new Date().toISOString(),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      rssMiB: bytesToMiB(memory.rss),
      heapUsedMiB: bytesToMiB(memory.heapUsed),
      heapTotalMiB: bytesToMiB(memory.heapTotal),
      externalMiB: bytesToMiB(memory.external),
      arrayBuffersMiB: bytesToMiB(memory.arrayBuffers)
    },
    caches: {
      marketApi: readMarketApiReadCacheStats(),
      marketDetailPassive: readMarketDetailPassiveRecordCacheStats()
    },
    requests: readRequestMetricsSnapshot(),
    database: {
      pool: poolStats
    },
    streams: {
      market: marketStreamStats,
      portfolio: portfolioStreamStats,
      discovery: options?.discoveryStreamLimiter?.getStats() ?? {
        feeds: 0,
        connections: 0
      },
      clients: options?.streamConnectionLimiter?.getStats() ?? {
        clients: 0,
        connections: 0
      },
      saturation: {
        thresholdRatio: SATURATION_WARN_RATIO,
        warn: marketSaturation.warn || portfolioSaturation.warn,
        market: marketSaturation,
        portfolio: portfolioSaturation
      }
    },
    runtime: {
      identity: buildRuntimeIdentity(env),
      migration,
      economy,
      backup,
      latestHorizonScheduler,
      latestLifecycleHeartbeat
    }
  };
}
