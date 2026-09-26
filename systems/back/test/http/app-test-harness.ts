import { expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";

import type { AppEnv } from "../../src/config/env";
import { createAppServer } from "../../src/http/app";
import type { RateLimiter } from "../../src/http/rate-limit";
import { createLogger } from "../../src/shared/logger";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "error",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    sessionAbsoluteTtlHours: 24 * 90,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111"
  },
  mail: {
    resendApiKey: "",
    from: "Hachozeh <noreply@email.hachozeh.com>"
  },
  actorMode: {
    demoEnabled: true,
    demoActorId: "seed_user_1"
  },
  trading: {
    requireSession: false
  },
  publicBaseUrl: "http://127.0.0.1:6969/trending",
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500
  }
};

const servers: Array<ReturnType<typeof createAppServer>> = [];

type AppTestEnvOverrides = Omit<Partial<AppEnv>, "auth" | "mail" | "actorMode" | "trading" | "db"> & {
  auth?: Partial<AppEnv["auth"]>;
  mail?: Partial<AppEnv["mail"]>;
  googleAuth?: Partial<NonNullable<AppEnv["googleAuth"]>>;
  actorMode?: Partial<AppEnv["actorMode"]>;
  trading?: Partial<AppEnv["trading"]>;
  db?: Partial<AppEnv["db"]>;
};

export async function startServer(overrides?: {
  env?: AppTestEnvOverrides;
  queryImpl?: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  rateLimiter?: RateLimiter;
}) {
  const env: AppEnv = {
    ...BASE_ENV,
    ...overrides?.env,
    auth: {
      ...BASE_ENV.auth,
      ...overrides?.env?.auth
    },
    mail: {
      ...BASE_ENV.mail,
      ...overrides?.env?.mail
    },
    googleAuth: {
      ...BASE_ENV.googleAuth,
      ...overrides?.env?.googleAuth
    } as NonNullable<AppEnv["googleAuth"]>,
    actorMode: {
      ...BASE_ENV.actorMode,
      ...overrides?.env?.actorMode
    },
    trading: {
      ...BASE_ENV.trading,
      ...overrides?.env?.trading
    },
    publicBaseUrl: overrides?.env?.publicBaseUrl ?? BASE_ENV.publicBaseUrl,
    db: {
      ...BASE_ENV.db,
      ...overrides?.env?.db
    }
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (overrides?.queryImpl) {
      return overrides.queryImpl(sql, values);
    }

    throw new Error("Unexpected db query in app test.");
  });
  const dbPool = {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool;
  const server = createAppServer({
    env,
    logger: createLogger("error"),
    dbPool,
    rateLimiter: overrides?.rateLimiter
  });

  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

export async function closeAppTestServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );
}

export function createPortfolioQueryImpl(limit: number) {
  return async (sql: string, values?: unknown[]) => {
    expect(values?.[0]).toBe("seed_user_1");

    if (sql.includes("select balance_cached")) {
      return {
        rows: [{ balance_cached: "9900.000000" }]
      };
    }

    if (sql.includes("realized_pnl_total")) {
      return {
        rows: [{ realized_pnl_total: "0.354946" }]
      };
    }

    if (sql.includes("realized_pnl_before")) {
      return {
        rows: [{ realized_pnl_before: "0.000000" }]
      };
    }

    if (sql.includes("select created_at") && sql.includes("from accounts")) {
      return {
        rows: [{ created_at: new Date("2026-04-07T09:58:00.000Z") }]
      };
    }

    if (sql.includes("as start_price")) {
      return {
        rows: [
          {
            shares: "341.138215",
            current_price: "0.31919492",
            start_price: "0.31919492"
          }
        ]
      };
    }

    // Slim positions read used by composePortfolioMarkSeries to
    // build share tracks (the V2 historical-share replay path). The
    // full snapshot positions read below (`from positions p`) stays
    // unchanged for the rest of the portfolio surface.
    if (sql.includes("shares::text as shares") && sql.includes("from positions") && !sql.includes("from positions p")) {
      return {
        rows: [
          {
            market_id: "market_seed_next_prime_minister",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            shares: "341.138215"
          }
        ]
      };
    }

    // Share-delta read used by composePortfolioMarkSeries to replay
    // trade + realization events across the chart window. Empty in
    // the harness is fine — the route still composes a series from
    // the current shares anchor.
    if (sql.includes("share_delta")) {
      return { rows: [] };
    }

    if (sql.includes("from positions p")) {
      return {
        rows: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'",
            outcome_count: 4,
            complement_outcome_id: null,
            complement_outcome_label: null,
            shares: "341.138215",
            cost_basis: "97.152119",
            realized_pnl: "0.354946",
            current_price: "0.31919492"
          }
        ]
      };
    }

    if (sql.includes("from contract_positions cp")) {
      return {
        rows: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            contract_side: "yes",
            outcome_count: 4,
            shares: "341.138215",
            cost_basis: "97.152119",
            realized_pnl: "0.354946",
            current_price: "0.31919492"
          }
        ]
      };
    }

    if (sql.includes("count(*)::int as trade_count")) {
      return {
        rows: [
          {
            trade_count: 2,
            buy_trade_count: 1,
            sell_trade_count: 1
          }
        ]
      };
    }

    if (sql.includes("count(*)::int as realization_count")) {
      return {
        rows: [{ realization_count: 1 }]
      };
    }

    if (sql.includes("from trades t")) {
      expect(values?.[1]).toBe(limit);

      return {
        rows: [
          {
            trade_id: "trade_2",
            created_at: new Date("2026-04-07T10:00:00.000Z"),
            side: "sell",
            contract_side: "yes",
            requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            cash_amount: "18.000000",
            share_amount: "20.000000",
            avg_price: "0.90000000",
            price_before: "0.88000000",
            price_after: "0.87000000",
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'"
          },
          {
            trade_id: "trade_1",
            created_at: new Date("2026-04-07T09:59:00.000Z"),
            side: "buy",
            contract_side: "yes",
            requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            cash_amount: "20.000000",
            share_amount: "23.809524",
            avg_price: "0.84000000",
            price_before: "0.82000000",
            price_after: "0.88000000",
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'"
          }
        ]
      };
    }

    if (sql.includes("from realization_events re")) {
      // Realization rows are read at two different limits now: the recent-activity
      // feed uses `limit`, the performance SERIES uses a large cap (it needs the
      // full realization history). So we don't assert the limit here.
      return {
        rows: [
          {
            realization_id: "realization_1",
            created_at: new Date("2026-04-07T10:01:00.000Z"),
            type: "sell",
            shares_closed: "20.000000",
            proceeds: "18.000000",
            removed_cost_basis: "16.800000",
            realized_pnl: "1.200000",
            trade_id: "trade_2",
            resolution_id: null,
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'"
          }
        ]
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected db query in app test: ${sql}`);
  };
}
