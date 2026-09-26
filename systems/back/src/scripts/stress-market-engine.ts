import { randomUUID } from "node:crypto";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";

type StressUser = {
  index: number;
  cookie: string;
  userId: string;
  clientKey: string;
};

type StressResult = {
  ok: boolean;
  status: number;
  kind: string;
  elapsedMs: number;
  payload: unknown;
};

type PositionRow = {
  user_id: string;
  outcome_id: string;
  shares: string;
  contract_side: "yes" | "no";
};

const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const runId = process.env.STRESS_RUN_ID ?? Date.now().toString(36);
const marketId = process.env.STRESS_MARKET_ID ?? `stress-engine-${runId}`;
const userCount = Number.parseInt(process.env.STRESS_USERS ?? "8", 10);
const buyCount = Number.parseInt(process.env.STRESS_BUYS ?? "160", 10);
const quoteCount = Number.parseInt(process.env.STRESS_QUOTES ?? "80", 10);
const readCount = Number.parseInt(process.env.STRESS_READS ?? "80", 10);
const concurrency = Number.parseInt(process.env.STRESS_CONCURRENCY ?? "24", 10);
const userCreateConcurrency = Number.parseInt(
  process.env.STRESS_USER_CONCURRENCY ?? "50",
  10
);
const outcomeIds = ["alpha", "bravo", "charlie", "delta"].map(
  (suffix) => `${marketId}-${suffix}`
);

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function cents(value: number): string {
  return value.toFixed(2);
}

function readCookiePair(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error("Expected Set-Cookie header.");
  }

  return setCookie.split(";")[0] ?? "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function postJson(
  path: string,
  body: unknown,
  cookie?: string,
  clientKey?: string
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(clientKey ? { "x-forwarded-for": clientKey } : {})
    },
    body: JSON.stringify(body)
  });
}

async function timed<T>(kind: string, run: () => Promise<T>): Promise<StressResult> {
  const startedAt = performance.now();

  try {
    const response = await run() as Response;
    const payload = await readJson(response);

    return {
      ok: response.ok,
      status: response.status,
      kind,
      elapsedMs: Math.round(performance.now() - startedAt),
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      kind,
      elapsedMs: Math.round(performance.now() - startedAt),
      payload: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
      }
    })
  );

  return results;
}

async function createStressMarket(): Promise<void> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    await withTransaction(pool, async (client) => {
      const treasuryAccountId = `account_${marketId}_treasury`;

      await client.query(
        `
          insert into accounts (id, type, owner_id, status, balance_cached)
          values ($1, 'market_treasury', $2, 'active', '1000.000000')
          on conflict (id) do nothing
        `,
        [treasuryAccountId, marketId]
      );

      await client.query(
        `
          insert into markets (
            id,
            status,
            title,
            description,
            category_key,
            open_at,
            close_at,
            published_at,
            resolution_source,
            resolution_rules,
            liquidity_b,
            market_treasury_account_id,
            created_by
          )
          values (
            $1,
            'open',
            'Stress engine market',
            'Synthetic market for concurrent backend stress testing.',
            'stress',
            now() - interval '1 minute',
            now() + interval '7 days',
            now(),
            'Synthetic stress runner',
            'Exactly one synthetic outcome wins.',
            '1000.00000000',
            $2,
            'system_stress'
          )
          on conflict (id) do nothing
        `,
        [marketId, treasuryAccountId]
      );

      for (const [index, outcomeId] of outcomeIds.entries()) {
        await client.query(
          `
            insert into market_outcomes (
              id,
              market_id,
              label,
              short_label,
              sort_order
            )
            values ($1, $2, $3, $3, $4)
            on conflict (id) do nothing
          `,
          [outcomeId, marketId, `Stress ${index + 1}`, index]
        );

        await client.query(
          `
            insert into market_outcome_state (
              market_id,
              outcome_id,
              q_shares,
              last_price
            )
            values ($1, $2, '0.000000', '0.25000000')
            on conflict (market_id, outcome_id) do nothing
          `,
          [marketId, outcomeId]
        );
      }

      await client.query(
        `
          insert into market_pricing_state (
            market_id,
            version,
            liquidity_b
          )
          values ($1, 0, '1000.00000000')
          on conflict (market_id) do nothing
        `,
        [marketId]
      );
    });
  } finally {
    await pool.end();
  }
}

async function createStressUser(index: number): Promise<StressUser> {
  const clientKey = `10.90.0.${(index % 240) + 1}`;
  const identifier = `stress+${runId}-${index}@navi.local`;
  const startResponse = await postJson("/api/auth/start", {
    identifier,
    purpose: "login"
  }, undefined, clientKey);
  const startPayload = await readJson(startResponse) as {
    challengeId?: string;
    devCode?: string;
  };

  expect(
    startResponse.ok,
    `Auth start failed for user ${index}: ${startResponse.status} ${JSON.stringify(startPayload)}`
  );
  expect(Boolean(startPayload.challengeId), `Auth start missing challenge for user ${index}`);
  expect(Boolean(startPayload.devCode), `Auth start missing dev code for user ${index}`);

  const verifyResponse = await postJson("/api/auth/verify", {
    challengeId: startPayload.challengeId,
    code: startPayload.devCode
  }, undefined, clientKey);
  const verifyPayload = await readJson(verifyResponse) as {
    actor?: {
      userId?: string;
    };
  };

  expect(
    verifyResponse.ok,
    `Auth verify failed for user ${index}: ${verifyResponse.status} ${JSON.stringify(verifyPayload)}`
  );

  return {
    index,
    cookie: readCookiePair(verifyResponse.headers.get("set-cookie")),
    userId: verifyPayload.actor?.userId ?? "",
    clientKey
  };
}

function buildBuyBody(index: number): Record<string, string> {
  return {
    side: "buy",
    outcomeKey: outcomeIds[index % outcomeIds.length]!,
    contractSide: index % 5 === 0 ? "no" : "yes",
    cashAmount: cents(1 + (index % 29) * 0.37),
    idempotencyKey: `stress:${runId}:buy:${index}:${randomUUID()}`
  };
}

function buildQuoteBody(index: number): Record<string, string> {
  return {
    side: "buy",
    outcomeKey: outcomeIds[(index * 3) % outcomeIds.length]!,
    contractSide: index % 4 === 0 ? "no" : "yes",
    cashAmount: cents(1 + (index % 17) * 0.53)
  };
}

async function readSellCandidates(): Promise<PositionRow[]> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const result = await pool.query<PositionRow>(
      `
        select
          user_id,
          requested_outcome_id as outcome_id,
          shares::text as shares,
          contract_side,
          updated_at
        from contract_positions
        where market_id = $1
          and shares >= 1
        order by updated_at desc, contract_side desc
        limit 128
      `,
      [marketId]
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

function buildSellBody(row: PositionRow, index: number): Record<string, string> {
  const shares = Math.max(0.1, Math.min(1, Number(row.shares) / 4));

  return {
    side: "sell",
    outcomeKey: row.outcome_id,
    contractSide: row.contract_side,
    shareAmount: shares.toFixed(6),
    idempotencyKey: `stress:${runId}:sell:${row.contract_side}:${index}:${randomUUID()}`
  };
}

async function auditStressMarket() {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const result = await pool.query(
      `
        with trade_stats as (
          select
            count(*)::int as trade_count,
            count(distinct market_state_version)::int as version_count,
            coalesce(min(market_state_version), 0)::int as min_version,
            coalesce(max(market_state_version), 0)::int as max_version,
            coalesce(sum(case when side = 'buy' then cash_amount else -cash_amount end), 0)::text as net_cash,
            coalesce(sum(cash_amount), 0)::text as gross_volume,
            count(*) filter (where side = 'buy' and contract_side = 'yes')::int as buy_yes_count,
            count(*) filter (where side = 'buy' and contract_side = 'no')::int as buy_no_count,
            count(*) filter (where side = 'sell' and contract_side = 'yes')::int as sell_yes_count,
            count(*) filter (where side = 'sell' and contract_side = 'no')::int as sell_no_count
          from trades
          where market_id = $1
        ),
        price_stats as (
          select
            coalesce(sum(last_price), 0)::text as price_sum,
            count(*)::int as outcome_count
          from market_outcome_state
          where market_id = $1
        ),
        ledger_stats as (
          select
            count(*)::int as ledger_tx_count,
            count(*) filter (where total <> 0)::int as unbalanced_ledger_tx_count
          from (
            select lt.id, coalesce(sum(le.amount), 0)::numeric as total
            from ledger_transactions lt
            left join ledger_entries le
              on le.transaction_id = lt.id
            where lt.market_id = $1
            group by lt.id
          ) tx
        ),
        position_stats as (
          select
            count(*)::int as position_count,
            count(*) filter (where shares < 0 or cost_basis < 0)::int as invalid_position_count
          from positions
          where market_id = $1
        )
        select
          ts.*,
          ps.price_sum,
          ps.outcome_count,
          ls.ledger_tx_count,
          ls.unbalanced_ledger_tx_count,
          pos.position_count,
          pos.invalid_position_count,
          mps.version::int as market_version,
          a.balance_cached::text as treasury_balance
        from trade_stats ts
        cross join price_stats ps
        cross join ledger_stats ls
        cross join position_stats pos
        join market_pricing_state mps
          on mps.market_id = $1
        join markets m
          on m.id = $1
        join accounts a
          on a.id = m.market_treasury_account_id
      `,
      [marketId]
    );
    const row = result.rows[0] as Record<string, string | number>;
    const tradeCount = Number(row.trade_count);
    const marketVersion = Number(row.market_version);
    const versionCount = Number(row.version_count);
    const maxVersion = Number(row.max_version);
    const priceSum = Number(row.price_sum);
    const expectedTreasury = 1000 + Number(row.net_cash);
    const actualTreasury = Number(row.treasury_balance);

    expect(marketVersion === tradeCount, "market version should match trade count");
    expect(versionCount === tradeCount, "trade versions should be unique");
    expect(maxVersion === tradeCount, "max trade version should match trade count");
    expect(Math.abs(priceSum - 1) <= 0.00000005, "prices should sum to 1 within dust");
    expect(Number(row.unbalanced_ledger_tx_count) === 0, "ledger txs should balance");
    expect(Number(row.invalid_position_count) === 0, "positions should stay non-negative");
    expect(Number(row.buy_yes_count) > 0, "stress should include yes buys");
    expect(Number(row.buy_no_count) > 0, "stress should include no buys");
    expect(Number(row.sell_yes_count) > 0, "stress should include yes sells");
    expect(Number(row.sell_no_count) > 0, "stress should include no sells");
    expect(
      Math.abs(actualTreasury - expectedTreasury) <= 0.000001,
      "treasury should equal seed plus net trade cash"
    );

    return row;
  } finally {
    await pool.end();
  }
}

function summarize(results: StressResult[]) {
  const failed = results.filter((result) => !result.ok);
  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  const byKind = Array.from(
    results.reduce((groups, result) => {
      const group = groups.get(result.kind) ?? [];
      group.push(result);
      groups.set(result.kind, group);
      return groups;
    }, new Map<string, StressResult[]>())
  ).map(([kind, kindResults]) => {
    const kindLatencies = kindResults
      .map((result) => result.elapsedMs)
      .sort((left, right) => left - right);
    const kindFailures = kindResults.filter((result) => !result.ok);
    const p50Index = Math.max(0, Math.ceil(kindLatencies.length * 0.5) - 1);
    const kindP95Index = Math.max(0, Math.ceil(kindLatencies.length * 0.95) - 1);

    return {
      kind,
      total: kindResults.length,
      ok: kindResults.length - kindFailures.length,
      failed: kindFailures.length,
      p50Ms: kindLatencies[p50Index] ?? 0,
      p95Ms: kindLatencies[kindP95Index] ?? 0,
      maxMs: kindLatencies.at(-1) ?? 0
    };
  });

  return {
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.length,
    p95Ms: latencies[p95Index] ?? 0,
    byKind,
    failures: failed.slice(0, 8).map((result) => ({
      kind: result.kind,
      status: result.status,
      payload: result.payload
    }))
  };
}

async function run(): Promise<void> {
  const health = await fetch(`${baseUrl}/health/ready`);
  expect(health.ok, `Backend ready check failed with ${health.status}`);

  await createStressMarket();

  const users = await mapConcurrent(
    Array.from({ length: userCount }, (_, index) => index),
    userCreateConcurrency,
    (index) => createStressUser(index)
  );

  const invalidQuote = await postJson(
    `/api/markets/${marketId}/quote`,
    {
      side: "buy",
      outcomeKey: outcomeIds[0],
      contractSide: "yes",
      cashAmount: "1.001"
    },
    users[0]!.cookie,
    users[0]!.clientKey
  );
  const invalidTrade = await postJson(
    `/api/markets/${marketId}/trades`,
    {
      side: "buy",
      outcomeKey: outcomeIds[0],
      contractSide: "yes",
      cashAmount: "1.001",
      idempotencyKey: `stress:${runId}:invalid:${randomUUID()}`
    },
    users[0]!.cookie,
    users[0]!.clientKey
  );

  expect(invalidQuote.status === 400, "invalid quote cash scale should return 400");
  expect(invalidTrade.status === 400, "invalid trade cash scale should return 400");

  const quoteJobs = Array.from({ length: quoteCount }, (_, index) => index);
  const buyJobs = Array.from({ length: buyCount }, (_, index) => index);

  const quoteResults = await mapConcurrent(quoteJobs, concurrency, async (index) => {
    const user = users[index % users.length]!;
    return timed("quote", () =>
      postJson(
        `/api/markets/${marketId}/quote`,
        buildQuoteBody(index),
        user.cookie,
        user.clientKey
      )
    );
  });

  const buyResults = await mapConcurrent(buyJobs, concurrency, async (index) => {
    const user = users[index % users.length]!;
    return timed("buy", () =>
      postJson(
        `/api/markets/${marketId}/trades`,
        buildBuyBody(index),
        user.cookie,
        user.clientKey
      )
    );
  });

  const sellCandidates = await readSellCandidates();
  const sellResults = await mapConcurrent(sellCandidates, concurrency, async (row, index) => {
    const user = users.find((candidate) => candidate.userId === row.user_id);
    expect(Boolean(user), `Missing session for position user ${row.user_id}`);

    return timed("sell", () =>
      postJson(
        `/api/markets/${marketId}/trades`,
        buildSellBody(row, index),
        user!.cookie,
        user!.clientKey
      )
    );
  });

  const readJobs = Array.from({ length: readCount }, (_, index) => index);
  const readResults = await mapConcurrent(readJobs, concurrency, async (index) => {
    const user = users[index % users.length]!;
    const path =
      index % 3 === 0
        ? `/api/market-detail/markets/${marketId}`
        : index % 3 === 1
          ? "/api/portfolio/snapshot"
          : "/api/discovery/feed";

    return timed(`read:${path}`, () =>
      fetch(`${baseUrl}${path}`, {
        headers: {
          cookie: user.cookie,
          "x-forwarded-for": user.clientKey
        }
      })
    );
  });

  const allResults = [...quoteResults, ...buyResults, ...sellResults, ...readResults];
  const summary = summarize(allResults);

  expect(summary.failed === 0, `Stress requests failed: ${JSON.stringify(summary.failures)}`);

  const audit = await auditStressMarket();

  console.log(JSON.stringify({
    marketId,
    runId,
    users: users.length,
    userCreateConcurrency,
    requestSummary: summary,
    invalidPrecision: {
      quoteStatus: invalidQuote.status,
      tradeStatus: invalidTrade.status
    },
    audit
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
