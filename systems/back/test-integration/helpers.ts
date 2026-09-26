/**
 * Shared helpers for integration tests.
 *
 * - createTestPool()    — returns a pg Pool pointed at navi_test
 * - truncateAllTables() — wipes data tables between tests
 * - seedMinimalMarket() — inserts a minimal open binary market + user + accounts
 */

import { Pool } from "pg";

function testUserHandle(userId: string): string {
  const normalized = userId
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");

  if (
    normalized.length >= 3 &&
    normalized.length <= 24 &&
    /^[a-z0-9][a-z0-9_.]*[a-z0-9]$/.test(normalized)
  ) {
    return normalized;
  }

  return `inttest_${Math.abs(hashString(userId)).toString(36).slice(0, 8)}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return hash;
}

export function createTestPool(): Pool {
  const dbName = process.env["DB_NAME"] ?? "navi_test";

  if (!dbName.endsWith("_test")) {
    throw new Error(
      `[helpers] HARD FAIL: DB_NAME="${dbName}" does not end with "_test". Refusing to create pool.`
    );
  }

  return new Pool({
    host: process.env["DB_HOST"] ?? "127.0.0.1",
    port: parseInt(process.env["DB_PORT"] ?? "55432", 10),
    user: process.env["DB_USER"] ?? "navi",
    password: process.env["DB_PASSWORD"] ?? "navi",
    database: dbName,
    connectionTimeoutMillis: 10_000,
    max: 5
  });
}

/**
 * Wipe all data tables in dependency-safe order.
 * schema_migrations is intentionally excluded so migrations
 * are not re-applied between every test.
 */
export async function truncateAllTables(pool: Pool): Promise<void> {
  await pool.query(`
    truncate table
      audit_events,
      lifecycle_events,
      user_abuse_flags,
      faucet_claims,
      user_faucet_state,
      realization_events,
      ledger_entries,
      ledger_transactions,
      idempotency_records,
      trade_execution_legs,
      trades,
      contract_positions,
      positions,
      market_outcome_state,
      market_pricing_state,
      market_outcomes,
      market_resolutions,
      markets,
      accounts,
      user_identities,
      sessions,
      users
    restart identity cascade
  `);
}

// ── Seed helpers ───────────────────────────────────────────────────────────────

export type SeedIds = {
  userId: string;
  userCashAccountId: string;
  marketId: string;
  marketKey: string;
  marketTreasuryAccountId: string;
  platformTreasuryAccountId: string;
  mintSourceAccountId: string;
  outcomeYesId: string;
  outcomeNoId: string;
};

export type SeedMultiOutcomeIds = Omit<SeedIds, "outcomeYesId" | "outcomeNoId"> & {
  outcomeIds: string[];
};

/**
 * Seeds:
 *   - 1 active user with cash balance
 *   - 1 open binary market (yes/no) with pricing state
 *   - platform treasury, mint-source, and market treasury accounts
 *   - a minimal ledger genesis row so ledger-head reads work
 */
export async function seedMinimalBinaryMarket(
  pool: Pool,
  opts: {
    userId?: string;
    userCash?: string;
    marketId?: string;
    marketKey?: string;
    closeAt?: Date;
    liquidityB?: string;
    marketTreasuryBalance?: string;
    platformTreasuryBalance?: string;
  } = {}
): Promise<SeedIds> {
  const userId = opts.userId ?? "inttest_user_1";
  const marketId = opts.marketId ?? "inttest_market_binary";
  const marketKey = opts.marketKey ?? marketId;
  const outcomeYesId = `${marketId}_outcome_yes`;
  const outcomeNoId = `${marketId}_outcome_no`;
  const userCashAccountId = `account_${userId}_cash`;
  const marketTreasuryAccountId = `account_${marketId}_treasury`;
  const platformTreasuryAccountId = "account_inttest_platform_treasury";
  const mintSourceAccountId = "account_inttest_mint_source";

  const userCash = opts.userCash ?? "1000.000000";
  const marketTreasuryBalance = opts.marketTreasuryBalance ?? "100000.000000";
  const platformTreasuryBalance = opts.platformTreasuryBalance ?? "1000000.000000";
  const liquidityB = opts.liquidityB ?? "1000.00000000";
  const closeAt = opts.closeAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(
      `insert into users (id, handle, status, role, trade_access_status, last_login_at)
       values ($1, $2, 'active', 'user', 'enabled', now())
       on conflict (id) do nothing`,
      [userId, testUserHandle(userId)]
    );

    await client.query(
      `insert into accounts (id, type, owner_id, status, balance_cached)
       values
         ($1, 'mint_source',       'system',   'active', $5),
         ($2, 'platform_treasury', 'platform', 'active', $6),
         ($3, 'market_treasury',   $7,         'active', $8),
         ($4, 'user_cash',         $9,         'active', $10)
       on conflict (id) do nothing`,
      [
        mintSourceAccountId,
        platformTreasuryAccountId,
        marketTreasuryAccountId,
        userCashAccountId,
        `-${platformTreasuryBalance}`,
        platformTreasuryBalance,
        marketId,
        marketTreasuryBalance,
        userId,
        userCash
      ]
    );

    await client.query(
      `insert into markets (
         id, status, settlement_status, title, description,
         category_key, open_at, close_at, published_at,
         close_on_event_completion, event_completion_close_requires_human_approval,
         oracle_source_policy, resolution_source, resolution_rules,
         liquidity_b, market_treasury_account_id, created_by
       ) values (
         $1, 'open', null, 'Integration Test Market', 'Binary yes/no market for integration tests',
         'test', now() - interval '1 hour', $2, now(),
         false, false,
         '{}', 'integration_test', 'Resolves to yes or no.',
         $3, $4, 'system_inttest'
       ) on conflict (id) do nothing`,
      [marketId, closeAt.toISOString(), liquidityB, marketTreasuryAccountId]
    );

    await client.query(
      `insert into market_outcomes (id, market_id, label, short_label, sort_order, color_key)
       values
         ($1, $3, 'Yes', 'Yes', 0, 'green'),
         ($2, $3, 'No',  'No',  1, 'red')
       on conflict (id) do nothing`,
      [outcomeYesId, outcomeNoId, marketId]
    );

    await client.query(
      `insert into market_pricing_state (market_id, version, liquidity_b)
       values ($1, 0, $2)
       on conflict (market_id) do nothing`,
      [marketId, liquidityB]
    );

    await client.query(
      `insert into market_outcome_state (market_id, outcome_id, q_shares, last_price)
       values
         ($1, $2, '0.000000', '0.50000000'),
         ($1, $3, '0.000000', '0.50000000')
       on conflict (market_id, outcome_id) do nothing`,
      [marketId, outcomeYesId, outcomeNoId]
    );

    // Minimal ledger genesis so ledger-head reads return a row
    await client.query(
      `insert into ledger_transactions (
         id, sequence_number, type, reference_type, reference_id,
         idempotency_key, created_by, posted_at,
         previous_transaction_hash, transaction_hash
       ) values (
         $1, 1, 'mint', 'system', 'inttest_genesis',
         'inttest:genesis', 'system_inttest', now(),
         'GENESIS', 'inttest-genesis-hash'
       ) on conflict (id) do nothing`,
      [`ledger_tx_inttest_genesis_${marketId}`]
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return {
    userId,
    userCashAccountId,
    marketId,
    marketKey,
    marketTreasuryAccountId,
    platformTreasuryAccountId,
    mintSourceAccountId,
    outcomeYesId,
    outcomeNoId
  };
}

export async function seedMinimalMultiOutcomeMarket(
  pool: Pool,
  opts: {
    userId?: string;
    userCash?: string;
    marketId?: string;
    marketKey?: string;
    outcomeCount: 3 | 4;
    closeAt?: Date;
    liquidityB?: string;
    marketTreasuryBalance?: string;
    platformTreasuryBalance?: string;
  }
): Promise<SeedMultiOutcomeIds> {
  const userId = opts.userId ?? "inttest_user_multi_1";
  const marketId = opts.marketId ?? `inttest_market_${opts.outcomeCount}_way`;
  const marketKey = opts.marketKey ?? marketId;
  const userCashAccountId = `account_${userId}_cash`;
  const marketTreasuryAccountId = `account_${marketId}_treasury`;
  const platformTreasuryAccountId = "account_inttest_platform_treasury";
  const mintSourceAccountId = "account_inttest_mint_source";
  const outcomeIds = Array.from({ length: opts.outcomeCount }, (_value, index) => (
    `${marketId}_outcome_${index + 1}`
  ));

  const userCash = opts.userCash ?? "1000.000000";
  const marketTreasuryBalance = opts.marketTreasuryBalance ?? "100000.000000";
  const platformTreasuryBalance = opts.platformTreasuryBalance ?? "1000000.000000";
  const liquidityB = opts.liquidityB ?? "1000.00000000";
  const closeAt = opts.closeAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(
      `insert into users (id, handle, status, role, trade_access_status, last_login_at)
       values ($1, $2, 'active', 'user', 'enabled', now())
       on conflict (id) do nothing`,
      [userId, testUserHandle(userId)]
    );

    await client.query(
      `insert into accounts (id, type, owner_id, status, balance_cached)
       values
         ($1, 'mint_source',       'system',   'active', $5),
         ($2, 'platform_treasury', 'platform', 'active', $6),
         ($3, 'market_treasury',   $7,         'active', $8),
         ($4, 'user_cash',         $9,         'active', $10)
       on conflict (id) do nothing`,
      [
        mintSourceAccountId,
        platformTreasuryAccountId,
        marketTreasuryAccountId,
        userCashAccountId,
        `-${platformTreasuryBalance}`,
        platformTreasuryBalance,
        marketId,
        marketTreasuryBalance,
        userId,
        userCash
      ]
    );

    await client.query(
      `insert into markets (
         id, status, settlement_status, title, description,
         category_key, open_at, close_at, published_at,
         close_on_event_completion, event_completion_close_requires_human_approval,
         oracle_source_policy, resolution_source, resolution_rules,
         liquidity_b, market_treasury_account_id, created_by
       ) values (
         $1, 'open', null, 'Integration Test Multi Market', 'Multi-outcome market for integration tests',
         'test', now() - interval '1 hour', $2, now(),
         false, false,
         '{}', 'integration_test', 'Resolves to one winner.',
         $3, $4, 'system_inttest'
       ) on conflict (id) do nothing`,
      [marketId, closeAt.toISOString(), liquidityB, marketTreasuryAccountId]
    );

    for (const [index, outcomeId] of outcomeIds.entries()) {
      await client.query(
        `insert into market_outcomes (id, market_id, label, short_label, sort_order, color_key)
         values ($1, $2, $3, $3, $4, 'blue')
         on conflict (id) do nothing`,
        [outcomeId, marketId, `Option ${index + 1}`, index]
      );
    }

    await client.query(
      `insert into market_pricing_state (market_id, version, liquidity_b)
       values ($1, 0, $2)
       on conflict (market_id) do nothing`,
      [marketId, liquidityB]
    );

    const initialPrice = (1 / opts.outcomeCount).toFixed(8);
    for (const outcomeId of outcomeIds) {
      await client.query(
        `insert into market_outcome_state (market_id, outcome_id, q_shares, last_price)
         values ($1, $2, '0.000000', $3)
         on conflict (market_id, outcome_id) do nothing`,
        [marketId, outcomeId, initialPrice]
      );
    }

    await client.query(
      `insert into ledger_transactions (
         id, sequence_number, type, reference_type, reference_id,
         idempotency_key, created_by, posted_at,
         previous_transaction_hash, transaction_hash
       ) values (
         $1, 1, 'mint', 'system', 'inttest_genesis',
         'inttest:genesis', 'system_inttest', now(),
         'GENESIS', 'inttest-genesis-hash'
       ) on conflict (id) do nothing`,
      [`ledger_tx_inttest_genesis_${marketId}`]
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return {
    userId,
    userCashAccountId,
    marketId,
    marketKey,
    marketTreasuryAccountId,
    platformTreasuryAccountId,
    mintSourceAccountId,
    outcomeIds
  };
}

/**
 * Read a single account balance from the DB.
 */
export async function readBalance(pool: Pool, accountId: string): Promise<string> {
  const result = await pool.query<{ balance_cached: string }>(
    "select balance_cached::text from accounts where id = $1",
    [accountId]
  );

  if (!result.rows[0]) {
    throw new Error(`Account ${accountId} not found`);
  }

  return result.rows[0].balance_cached;
}

export async function readTotalEconomyBalance(pool: Pool): Promise<string> {
  const result = await pool.query<{ total_balance: string }>(
    "select coalesce(sum(balance_cached), 0)::text as total_balance from accounts"
  );

  return result.rows[0]?.total_balance ?? "0";
}

/**
 * Read a position row (returns null if not found).
 */
export async function readPosition(
  pool: Pool,
  userId: string,
  marketId: string,
  outcomeId: string
): Promise<{ shares: string; cost_basis: string; realized_pnl: string } | null> {
  const result = await pool.query<{ shares: string; cost_basis: string; realized_pnl: string }>(
    `select shares::text, cost_basis::text, realized_pnl::text
     from positions
     where user_id = $1 and market_id = $2 and outcome_id = $3`,
    [userId, marketId, outcomeId]
  );

  return result.rows[0] ?? null;
}

/**
 * Read a contract_position row.
 */
export async function readContractPosition(
  pool: Pool,
  userId: string,
  marketId: string,
  outcomeId: string,
  contractSide: "yes" | "no"
): Promise<{ shares: string; cost_basis: string; realized_pnl: string } | null> {
  const result = await pool.query<{ shares: string; cost_basis: string; realized_pnl: string }>(
    `select shares::text, cost_basis::text, realized_pnl::text
     from contract_positions
     where user_id = $1 and market_id = $2 and requested_outcome_id = $3 and contract_side = $4`,
    [userId, marketId, outcomeId, contractSide]
  );

  return result.rows[0] ?? null;
}

/**
 * Count ledger entries for an account.
 */
export async function countLedgerEntriesForAccount(
  pool: Pool,
  accountId: string
): Promise<number> {
  const result = await pool.query<{ cnt: string }>(
    "select count(*)::text as cnt from ledger_entries where account_id = $1",
    [accountId]
  );

  return parseInt(result.rows[0]?.cnt ?? "0", 10);
}

/**
 * Close a market (set status to 'closed') — needed before resolveMarket.
 */
export async function closeMarket(pool: Pool, marketId: string): Promise<void> {
  await pool.query(
    "update markets set status = 'closed', closed_at = now() where id = $1",
    [marketId]
  );
}

/**
 * Read realization events for a user on a market.
 */
export async function readRealizationEvents(
  pool: Pool,
  userId: string,
  marketId: string
): Promise<Array<{ type: string; claim_status: string; proceeds: string; shares_closed: string }>> {
  const result = await pool.query<{
    type: string;
    claim_status: string;
    proceeds: string;
    shares_closed: string;
  }>(
    `select type, claim_status, proceeds::text, shares_closed::text
     from realization_events
     where user_id = $1 and market_id = $2
     order by created_at`,
    [userId, marketId]
  );

  return result.rows;
}
