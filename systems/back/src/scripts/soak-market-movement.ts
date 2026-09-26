import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import { hashLedgerTransaction } from "../auth/session/hashing";
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

type SoakUser = {
  index: number;
  cookie: string;
  userId: string;
  clientKey: string;
};

type Outcome = {
  outcomeKey: string;
  outcomeId: string;
  label: string;
  lastPrice: string;
};

type MarketSnapshot = {
  marketStatus: string;
  closeAt: string;
  outcomes: Outcome[];
};

type ContractSide = "yes" | "no";

type PositionRow = {
  user_id: string;
  requested_outcome_id: string;
  requested_outcome_key: string;
  contract_side: ContractSide;
  shares: string;
};

const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const marketId = process.env.SOAK_MARKET_ID ?? "stress-contract-position-root-2";
const runId = process.env.SOAK_RUN_ID ?? `soak-${Date.now().toString(36)}`;
const durationMinutes = readNumber("SOAK_DURATION_MINUTES", 120);
const intervalMs = readNumber("SOAK_INTERVAL_MS", 15_000);
const userCount = readNumber("SOAK_USERS", 48);
const tradesPerTick = readNumber("SOAK_TRADES_PER_TICK", 3);
const minCash = readNumber("SOAK_MIN_CASH", 12);
const maxCash = readNumber("SOAK_MAX_CASH", 90);
const phaseTicks = readNumber("SOAK_PHASE_TICKS", 12);
const randomMode = readBoolean("SOAK_RANDOM", false);
const randomSeed = process.env.SOAK_RANDOM_SEED ?? runId;
const sellProbability = readNumber("SOAK_SELL_PROBABILITY", 0.25);
const userGrantAmount = readNumber("SOAK_USER_GRANT", 0);
const abortConsecutiveBackendDownTicks = readNumber("SOAK_ABORT_CONSECUTIVE_BACKEND_DOWN_TICKS", 6);
const diagnosticsEveryTicks = readNumber("SOAK_DIAGNOSTICS_EVERY_TICKS", 1);
const stopOnMarketClosed = readBoolean("SOAK_STOP_ON_MARKET_CLOSED", true);
const repoRoot = resolve(process.cwd(), "../..");
const logPath = process.env.SOAK_LOG_PATH
  ? resolve(process.env.SOAK_LOG_PATH)
  : resolve(repoRoot, `workspace/test/market-soak-${runId}.jsonl`);
const rng = createSeededRandom(randomSeed);

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function createSeededRandom(seed: string): () => number {
  let state = 0x811c9dc5;

  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function money(value: number): string {
  return value.toFixed(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function readCookiePair(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error("Expected Set-Cookie header.");
  }

  return setCookie.split(";")[0] ?? "";
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

async function getJson(path: string, cookie?: string, clientKey?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(clientKey ? { "x-forwarded-for": clientKey } : {})
    }
  });
}

async function timed<T>(kind: string, run: () => Promise<T>): Promise<{
  kind: string;
  ok: boolean;
  status: number;
  elapsedMs: number;
  payload: unknown;
}> {
  const startedAt = performance.now();

  try {
    const response = await run() as Response;
    const payload = await readJson(response);

    return {
      kind,
      ok: response.ok,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      payload
    };
  } catch (error) {
    return {
      kind,
      ok: false,
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      payload: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

function compactDiagnostics(result: Awaited<ReturnType<typeof timed<Response>>>) {
  const payload = result.payload as {
    now?: string;
    memory?: Record<string, unknown>;
    caches?: Record<string, unknown>;
    streams?: Record<string, unknown>;
    error?: unknown;
  };

  return {
    ok: result.ok,
    status: result.status,
    elapsedMs: result.elapsedMs,
    now: payload?.now ?? null,
    memory: payload?.memory ?? null,
    caches: payload?.caches ?? null,
    streams: payload?.streams ?? null,
    error: payload?.error
  };
}

function payloadErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

async function appendReceipt(line: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(line)}\n`);
}

async function createSoakUser(index: number): Promise<SoakUser> {
  const identifier = `soak+${runId}-${index}@navi.local`;
  const clientKey = `10.91.${Math.floor(index / 240)}.${(index % 240) + 1}`;
  const startResponse = await postJson(
    "/api/auth/start",
    { identifier, purpose: "login" },
    undefined,
    clientKey
  );
  const startPayload = await readJson(startResponse) as {
    challengeId?: string;
    devCode?: string;
  };

  expect(
    startResponse.ok,
    `Auth start failed for ${identifier}: ${startResponse.status} ${JSON.stringify(startPayload)}`
  );
  expect(Boolean(startPayload.challengeId), `Missing challenge for ${identifier}`);
  expect(Boolean(startPayload.devCode), `Missing dev code for ${identifier}`);

  const verifyResponse = await postJson(
    "/api/auth/verify",
    { challengeId: startPayload.challengeId, code: startPayload.devCode },
    undefined,
    clientKey
  );
  const verifyPayload = await readJson(verifyResponse) as {
    actor?: { userId?: string };
  };

  expect(
    verifyResponse.ok,
    `Auth verify failed for ${identifier}: ${verifyResponse.status} ${JSON.stringify(verifyPayload)}`
  );

  return {
    index,
    cookie: readCookiePair(verifyResponse.headers.get("set-cookie")),
    userId: verifyPayload.actor?.userId ?? "",
    clientKey
  };
}

async function grantSoakCash(users: SoakUser[]): Promise<void> {
  if (userGrantAmount <= 0) {
    return;
  }

  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  const amount = userGrantAmount.toFixed(6);

  try {
    for (const user of users) {
      await pool.query("begin");

      try {
        await pool.query("select pg_advisory_xact_lock(hashtext('navi_ledger_sequence'))");

        const platform = await pool.query<{ id: string; balance_cached: string }>(
          `
            select id, balance_cached
            from accounts
            where type = 'platform_treasury'
              and status = 'active'
            limit 1
            for update
          `
        );
        const cashAccount = await pool.query<{ id: string; balance_cached: string }>(
          `
            select id, balance_cached
            from accounts
            where owner_id = $1
              and type = 'user_cash'
              and status = 'active'
            limit 1
            for update
          `,
          [user.userId]
        );
        const head = await pool.query<{
          sequence_number: string;
          transaction_hash: string;
        }>(
          `
            select sequence_number, transaction_hash
            from ledger_transactions
            order by sequence_number desc
            limit 1
            for update
          `
        );

        const platformAccount = platform.rows[0];
        const userCashAccount = cashAccount.rows[0];
        if (!platformAccount) throw new Error("Platform treasury account is unavailable.");
        if (!userCashAccount) throw new Error(`User cash account missing for ${user.userId}.`);

        const platformBalance = new Decimal(platformAccount.balance_cached);
        const grantAmount = new Decimal(amount);
        if (platformBalance.lessThan(grantAmount)) {
          throw new Error(
            `Platform treasury cannot fund soak grant ${amount}; current balance is ${platformAccount.balance_cached}.`
          );
        }

        const nextSequenceNumber = Number(head.rows[0]?.sequence_number ?? "0") + 1;
        const previousTransactionHash = head.rows[0]?.transaction_hash ?? "GENESIS";
        const ledgerTransactionId = `ledger_tx_soak_grant_${randomUUID()}`;
        const referenceId = `soak_grant:${runId}:${user.userId}`;
        const transactionHash = hashLedgerTransaction({
          sequenceNumber: nextSequenceNumber,
          previousTransactionHash,
          type: "grant",
          referenceType: "grant",
          referenceId,
          createdBy: "soak_market_movement",
          triggeredBy: "system",
          triggeredById: user.userId,
          entries: [
            {
              accountId: platformAccount.id,
              amount: `-${amount}`,
              entryRole: "debit_platform_treasury"
            },
            {
              accountId: userCashAccount.id,
              amount,
              entryRole: "credit_user_cash"
            }
          ]
        });

        await pool.query(
          `
            insert into ledger_transactions (
              id,
              sequence_number,
              type,
              reference_type,
              reference_id,
              idempotency_key,
              created_by,
              posted_at,
              triggered_by,
              triggered_by_id,
              previous_transaction_hash,
              transaction_hash
            )
            values ($1, $2, 'grant', 'grant', $3, $3, 'soak_market_movement', now(), 'system', $4, $5, $6)
          `,
          [
            ledgerTransactionId,
            nextSequenceNumber,
            referenceId,
            user.userId,
            previousTransactionHash,
            transactionHash
          ]
        );
        await pool.query(
          `
            insert into ledger_entries (id, transaction_id, account_id, amount, entry_role, memo)
            values
              ($1, $3, $4, $5, 'debit_platform_treasury', 'local long-soak behavior grant'),
              ($2, $3, $6, $7, 'credit_user_cash', 'local long-soak behavior grant')
          `,
          [
            `ledger_entry_${ledgerTransactionId}_platform`,
            `ledger_entry_${ledgerTransactionId}_user`,
            ledgerTransactionId,
            platformAccount.id,
            `-${amount}`,
            userCashAccount.id,
            amount
          ]
        );
        await pool.query(
          `
            update accounts
            set balance_cached = $2,
                updated_at = now()
            where id = $1
          `,
          [
            platformAccount.id,
            platformBalance.minus(grantAmount).toFixed(6)
          ]
        );
        await pool.query(
          `
            update accounts
            set balance_cached = $2,
                updated_at = now()
            where id = $1
          `,
          [
            userCashAccount.id,
            new Decimal(userCashAccount.balance_cached).plus(amount).toFixed(6)
          ]
        );

        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

async function readMarketSnapshot(): Promise<MarketSnapshot> {
  const response = await getJson(`/api/markets/${marketId}`);
  const payload = await readJson(response) as {
    market?: { marketStatus?: string; closeAt?: string; outcomes?: Outcome[] };
  };

  expect(response.ok, `Market read failed: ${response.status} ${JSON.stringify(payload)}`);

  const outcomes = payload.market?.outcomes ?? [];
  expect(outcomes.length >= 2, "Soak market must expose at least 2 outcomes.");

  return {
    marketStatus: payload.market?.marketStatus ?? "unknown",
    closeAt: payload.market?.closeAt ?? "",
    outcomes
  };
}

function isMarketClosed(snapshot: MarketSnapshot): boolean {
  if (snapshot.marketStatus !== "open") {
    return true;
  }

  const closeAtMs = Date.parse(snapshot.closeAt);
  return Number.isFinite(closeAtMs) && closeAtMs <= Date.now();
}

async function readSellCandidates(users: SoakUser[]): Promise<PositionRow[]> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  const userIds = users.map((user) => user.userId).filter(Boolean);

  try {
    const result = await pool.query<PositionRow>(
      `
        select
          user_id,
          requested_outcome_id,
          requested_outcome_key,
          contract_side,
          shares::text as shares
        from contract_positions
        where market_id = $1
          and user_id = any($2::text[])
          and shares >= 5
        order by last_trade_at desc nulls last, updated_at desc
        limit 256
      `,
      [marketId, userIds]
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

function cashForTick(tick: number, tradeIndex: number): string {
  if (randomMode) {
    const min = Math.max(0.01, minCash);
    const max = Math.max(min, maxCash);
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const amount = Math.exp(logMin + (logMax - logMin) * rng());

    return money(Math.min(max, Math.max(min, amount)));
  }

  const wave = (Math.sin((tick + tradeIndex) / 4) + 1) / 2;
  const jitter = ((tick * 17 + tradeIndex * 31) % 11) / 10;
  const amount = minCash + (maxCash - minCash) * Math.min(1, wave * 0.85 + jitter * 0.15);

  return money(amount);
}

function buyBody(
  tick: number,
  tradeIndex: number,
  outcomes: Outcome[]
): Record<string, string> {
  if (randomMode) {
    const outcome = outcomes[Math.floor(rng() * outcomes.length) % outcomes.length]!;
    const contractSide: ContractSide = rng() < 0.5 ? "yes" : "no";

    return {
      side: "buy",
      outcomeKey: outcome.outcomeKey,
      contractSide,
      cashAmount: cashForTick(tick, tradeIndex),
      idempotencyKey: `soak:${runId}:buy:${tick}:${tradeIndex}:${randomUUID()}`
    };
  }

  const targetIndex = Math.floor(tick / phaseTicks) % outcomes.length;
  const previousIndex = (targetIndex + outcomes.length - 1) % outcomes.length;
  const mode = (tick + tradeIndex) % 10;
  const outcome =
    mode <= 5
      ? outcomes[targetIndex]!
      : mode <= 7
        ? outcomes[previousIndex]!
        : outcomes[(tick + tradeIndex * 2) % outcomes.length]!;
  const contractSide: ContractSide = mode === 6 || mode === 8 ? "no" : "yes";

  return {
    side: "buy",
    outcomeKey: outcome.outcomeKey,
    contractSide,
    cashAmount: cashForTick(tick, tradeIndex),
    idempotencyKey: `soak:${runId}:buy:${tick}:${tradeIndex}:${randomUUID()}`
  };
}

function sellBody(row: PositionRow, tick: number, tradeIndex: number): Record<string, string> {
  const shares = Math.max(1, Math.min(35, Number(row.shares) * 0.12));

  return {
    side: "sell",
    outcomeKey: row.requested_outcome_key || row.requested_outcome_id,
    contractSide: row.contract_side,
    shareAmount: shares.toFixed(6),
    idempotencyKey: `soak:${runId}:sell:${tick}:${tradeIndex}:${randomUUID()}`
  };
}

async function runTrade(
  tick: number,
  tradeIndex: number,
  users: SoakUser[],
  outcomes: Outcome[],
  sellCandidates: PositionRow[]
) {
  const user = users[(tick * tradesPerTick + tradeIndex) % users.length]!;
  const shouldSell = sellCandidates.length > 0
    && (randomMode ? rng() < sellProbability : (tick + tradeIndex) % 4 === 0);
  const sellCandidate = sellCandidates[(tick + tradeIndex * 7) % sellCandidates.length];
  const sellUser = sellCandidate
    ? users.find((candidate) => candidate.userId === sellCandidate.user_id)
    : undefined;
  const actor = shouldSell && sellCandidate && sellUser ? sellUser : user;
  const body = shouldSell && sellCandidate && sellUser
    ? sellBody(sellCandidate, tick, tradeIndex)
    : buyBody(tick, tradeIndex, outcomes);

  const quoteBody = { ...body };
  delete quoteBody.idempotencyKey;

  const quote = await timed("quote", () =>
    postJson(`/api/markets/${marketId}/quote`, quoteBody, actor.cookie, actor.clientKey)
  );
  const trade = await timed("trade", () =>
    postJson(`/api/markets/${marketId}/trades`, body, actor.cookie, actor.clientKey)
  );

  return {
    actor: actor.userId,
    body,
    quote: { ok: quote.ok, status: quote.status, elapsedMs: quote.elapsedMs, payload: quote.payload },
    trade: { ok: trade.ok, status: trade.status, elapsedMs: trade.elapsedMs, payload: trade.payload }
  };
}

function isResourceSkip(trade: Awaited<ReturnType<typeof runTrade>>): boolean {
  return trade.trade.status === 409 && payloadErrorCode(trade.trade.payload) === "insufficient_cash";
}

function isMarketNotOpen(trade: Awaited<ReturnType<typeof runTrade>>): boolean {
  return (
    (trade.quote.status === 409 && payloadErrorCode(trade.quote.payload) === "market_not_open") ||
    (trade.trade.status === 409 && payloadErrorCode(trade.trade.payload) === "market_not_open")
  );
}

async function readTickState(user: SoakUser, shouldReadDiagnostics: boolean) {
  const diagnosticsPromise = shouldReadDiagnostics
    ? timed("read:diagnostics", () => getJson("/health/diagnostics"))
    : Promise.resolve(null);
  const [market, history1h, history1d, recentTrades, diagnostics] = await Promise.all([
    timed("read:market", () => getJson(`/api/markets/${marketId}`, user.cookie, user.clientKey)),
    timed("read:history:1H", () =>
      getJson(`/api/markets/${marketId}/history?range=1H&limit=1000`, user.cookie, user.clientKey)
    ),
    timed("read:history:1D", () =>
      getJson(`/api/markets/${marketId}/history?range=1D&limit=1000`, user.cookie, user.clientKey)
    ),
    timed("read:trades", () =>
      getJson(`/api/markets/${marketId}/trades?limit=6`, user.cookie, user.clientKey)
    ),
    diagnosticsPromise
  ]);

  const historyPayload = history1h.payload as {
    points?: Array<{ at?: string; values?: Record<string, number> }>;
    sampleQuality?: string;
  };
  const lastPoint = historyPayload.points?.at(-1);

  return {
    reads: [
      { kind: market.kind, ok: market.ok, status: market.status, elapsedMs: market.elapsedMs },
      { kind: history1h.kind, ok: history1h.ok, status: history1h.status, elapsedMs: history1h.elapsedMs },
      { kind: history1d.kind, ok: history1d.ok, status: history1d.status, elapsedMs: history1d.elapsedMs },
      { kind: recentTrades.kind, ok: recentTrades.ok, status: recentTrades.status, elapsedMs: recentTrades.elapsedMs },
      ...(diagnostics
        ? [{ kind: diagnostics.kind, ok: diagnostics.ok, status: diagnostics.status, elapsedMs: diagnostics.elapsedMs }]
        : [])
    ],
    diagnostics: diagnostics ? compactDiagnostics(diagnostics) : null,
    history: {
      points1h: historyPayload.points?.length ?? 0,
      quality1h: historyPayload.sampleQuality ?? "unknown",
      lastAt: lastPoint?.at ?? null,
      values: lastPoint?.values ?? null
    }
  };
}

async function run(): Promise<void> {
  const ready = await fetch(`${baseUrl}/health/ready`);
  expect(ready.ok, `Backend ready failed with ${ready.status}`);

  const initialMarketSnapshot = await readMarketSnapshot();
  const outcomes = initialMarketSnapshot.outcomes;
  const maxTicks = Math.max(1, Math.ceil((durationMinutes * 60_000) / intervalMs));

  await appendReceipt({
    event: "start",
    at: new Date().toISOString(),
    runId,
    marketId,
    baseUrl,
    durationMinutes,
    intervalMs,
    userCount,
    tradesPerTick,
    minCash,
    maxCash,
    phaseTicks,
    randomMode,
    randomSeed,
    sellProbability,
    userGrantAmount,
    diagnosticsEveryTicks,
    stopOnMarketClosed,
    initialMarketStatus: initialMarketSnapshot.marketStatus,
    initialCloseAt: initialMarketSnapshot.closeAt,
    outcomes: outcomes.map((outcome) => ({
      key: outcome.outcomeKey,
      label: outcome.label,
      lastPrice: outcome.lastPrice
    }))
  });

  console.log(JSON.stringify({ event: "start", runId, marketId, logPath, maxTicks }));

  if (stopOnMarketClosed && isMarketClosed(initialMarketSnapshot)) {
    await appendReceipt({
      event: "finish",
      at: new Date().toISOString(),
      runId,
      marketId,
      reason: "market_closed",
      tick: 0,
      marketStatus: initialMarketSnapshot.marketStatus,
      closeAt: initialMarketSnapshot.closeAt,
      diagnostics: compactDiagnostics(
        await timed("read:diagnostics", () => getJson("/health/diagnostics"))
      )
    });
    console.log(JSON.stringify({
      event: "finish",
      runId,
      marketId,
      reason: "market_closed",
      tick: 0,
      marketStatus: initialMarketSnapshot.marketStatus,
      closeAt: initialMarketSnapshot.closeAt,
      logPath
    }));
    return;
  }

  const users: SoakUser[] = [];

  for (let index = 0; index < userCount; index += 1) {
    users.push(await createSoakUser(index));
  }
  await grantSoakCash(users);

  let consecutiveBackendDownTicks = 0;

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const startedAt = Date.now();
    const marketSnapshot = await readMarketSnapshot();

    if (stopOnMarketClosed && isMarketClosed(marketSnapshot)) {
      await appendReceipt({
        event: "finish",
        at: new Date().toISOString(),
        runId,
        marketId,
        reason: "market_closed",
        tick,
        marketStatus: marketSnapshot.marketStatus,
        closeAt: marketSnapshot.closeAt,
        diagnostics: compactDiagnostics(
          await timed("read:diagnostics", () => getJson("/health/diagnostics"))
        )
      });
      console.log(JSON.stringify({
        event: "finish",
        runId,
        marketId,
        reason: "market_closed",
        tick,
        marketStatus: marketSnapshot.marketStatus,
        closeAt: marketSnapshot.closeAt,
        logPath
      }));
      return;
    }

    const activeOutcomes = marketSnapshot.outcomes;
    const targetOutcome = activeOutcomes[Math.floor(tick / phaseTicks) % activeOutcomes.length]!;
    const sellCandidates = await readSellCandidates(users);
    const trades = [];

    for (let tradeIndex = 0; tradeIndex < tradesPerTick; tradeIndex += 1) {
      trades.push(await runTrade(tick, tradeIndex, users, activeOutcomes, sellCandidates));
    }

    const shouldReadDiagnostics =
      diagnosticsEveryTicks > 0 && tick % Math.max(1, diagnosticsEveryTicks) === 0;
    const state = await readTickState(users[tick % users.length]!, shouldReadDiagnostics);
    const rejectedTrades = trades.filter((trade) => !trade.quote.ok || !trade.trade.ok);
    const resourceSkippedTrades = rejectedTrades.filter(isResourceSkip);
    const marketClosedTrades = rejectedTrades.filter(isMarketNotOpen);
    const failedTrades = rejectedTrades.filter(
      (trade) => !isResourceSkip(trade) && !(stopOnMarketClosed && isMarketNotOpen(trade))
    );
    const failedReads = state.reads.filter((read) => !read.ok);
    const backendDown =
      state.reads.every((read) => read.status === 0) ||
      (trades.length > 0 &&
        trades.every((trade) => trade.quote.status === 0 && trade.trade.status === 0));

    consecutiveBackendDownTicks = backendDown ? consecutiveBackendDownTicks + 1 : 0;

    const receipt = {
      event: "tick",
      at: new Date().toISOString(),
      tick,
      targetOutcome: {
        key: targetOutcome.outcomeKey,
        label: targetOutcome.label
      },
      trades,
      resourceSkippedTrades: resourceSkippedTrades.length,
      marketClosedTrades: marketClosedTrades.length,
      failedTrades: failedTrades.length,
      failedReads: failedReads.length,
      backendDown,
      consecutiveBackendDownTicks,
      ...state
    };

    await appendReceipt(receipt);
    console.log(JSON.stringify({
      event: "tick",
      tick,
      target: targetOutcome.label,
      resourceSkippedTrades: resourceSkippedTrades.length,
      marketClosedTrades: marketClosedTrades.length,
      failedTrades: failedTrades.length,
      failedReads: failedReads.length,
      backendDown,
      consecutiveBackendDownTicks,
      values: state.history.values,
      diagnostics: state.diagnostics
        ? {
            rssMiB: state.diagnostics.memory?.rssMiB,
            heapUsedMiB: state.diagnostics.memory?.heapUsedMiB,
            marketApiCacheEntries:
              (state.diagnostics.caches?.marketApi as { entries?: unknown } | undefined)?.entries,
            marketDetailCacheEntries:
              (state.diagnostics.caches?.marketDetailPassive as { entries?: unknown } | undefined)
                ?.entries,
            streamConnections:
              (state.diagnostics.streams as { connections?: unknown } | undefined)?.connections
          }
        : null
    }));

    if (stopOnMarketClosed && marketClosedTrades.length > 0) {
      await appendReceipt({
        event: "finish",
        at: new Date().toISOString(),
        runId,
        marketId,
        reason: "market_not_open",
        tick,
        marketClosedTrades: marketClosedTrades.length,
        diagnostics: compactDiagnostics(
          await timed("read:diagnostics", () => getJson("/health/diagnostics"))
        )
      });
      console.log(JSON.stringify({
        event: "finish",
        runId,
        marketId,
        reason: "market_not_open",
        tick,
        marketClosedTrades: marketClosedTrades.length,
        logPath
      }));
      return;
    }

    if (
      abortConsecutiveBackendDownTicks > 0 &&
      consecutiveBackendDownTicks >= abortConsecutiveBackendDownTicks
    ) {
      await appendReceipt({
        event: "abort",
        at: new Date().toISOString(),
        runId,
        marketId,
        reason: "backend_down_threshold",
        consecutiveBackendDownTicks,
        abortConsecutiveBackendDownTicks
      });
      console.error(JSON.stringify({
        event: "abort",
        runId,
        marketId,
        reason: "backend_down_threshold",
        consecutiveBackendDownTicks
      }));
      process.exitCode = 2;
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = intervalMs - elapsedMs;
    if (remainingMs > 0 && tick < maxTicks - 1) {
      await sleep(remainingMs);
    }
  }

  await appendReceipt({
    event: "finish",
    at: new Date().toISOString(),
    runId,
    marketId,
    diagnostics: compactDiagnostics(
      await timed("read:diagnostics", () => getJson("/health/diagnostics"))
    )
  });
  console.log(JSON.stringify({ event: "finish", runId, marketId, logPath }));
}

run().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await appendReceipt({
    event: "error",
    at: new Date().toISOString(),
    runId,
    marketId,
    message
  });
  console.error(message);
  process.exitCode = 1;
});

export {};
