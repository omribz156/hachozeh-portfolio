import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";

const SEED_IDS = {
  actor: "system_seed",
  markets: {
    bankIsrael: "market_seed_1",
    nextPrimeMinister: "market_seed_next_prime_minister"
  },
  outcomes: {
    bankIsrael: [
      "market_seed_1_outcome_hold",
      "market_seed_1_outcome_cut_025",
      "market_seed_1_outcome_cut_050_plus",
      "market_seed_1_outcome_hike"
    ],
    nextPrimeMinister: [
      "market_seed_next_prime_minister_outcome_option_a",
      "market_seed_next_prime_minister_outcome_option_b",
      "market_seed_next_prime_minister_outcome_option_c",
      "market_seed_next_prime_minister_outcome_option_d"
    ]
  },
  accounts: {
    mintSource: "account_mint_source",
    platformTreasury: "account_platform_treasury",
    sink: "account_sink",
    bankIsraelTreasury: "account_market_seed_1_treasury",
    nextPrimeMinisterTreasury: "account_market_seed_next_prime_minister_treasury",
    userCash: "account_seed_user_1_cash",
    adminCash: "account_seed_admin_1_cash"
  },
  users: {
    demo: "seed_user_1",
    admin: "seed_admin_1"
  },
  identities: {
    demo: "identity_seed_user_1_email",
    admin: "identity_seed_admin_1_email"
  },
  ledger: {
    mint: "ledger_tx_seed_mint",
    bankIsraelMarketSeed: "ledger_tx_seed_market_seed_bank_israel",
    nextPrimeMinisterMarketSeed: "ledger_tx_seed_market_seed_next_prime_minister",
    userGrant: "ledger_tx_seed_user_grant"
  },
  idempotency: {
    mint: "seed:mint:bootstrap",
    bankIsraelMarketSeed: "seed:market-seed:bank-israel",
    nextPrimeMinisterMarketSeed: "seed:market-seed:next-prime-minister",
    userGrant: "seed:user-grant:bootstrap"
  }
} as const;

const PLATFORM_TREASURY_AMOUNT = "1000000.000000";
const MARKET_TREASURY_AMOUNT = "100000.000000";
const USER_CASH_AMOUNT = "10000.000000";
const ADMIN_CASH_AMOUNT = "0.000000";
const LIQUIDITY_B = "1000.00000000";
const INITIAL_Q_SHARES = "0.000000";
const INITIAL_PRICE = "0.25000000";
const SEEDED_USER_EMAIL = "seed-user@navi.local";
const SEEDED_ADMIN_EMAIL = "seed-admin@navi.local";
const BANK_ISRAEL_ORACLE_SOURCE_POLICY = JSON.stringify({
  preferredSourceIds: ["src_boi_announcements"],
  fallbackSourceIds: ["src_google_trends_israel_interest_rate"],
  closeConditionSourceIds: ["src_boi_announcements"],
  resolutionSourceIds: ["src_boi_announcements"],
  requiresHumanReviewOnWeakAuthority: true,
  notes: ["Bank of Israel announcement is the preferred official anchor."]
});
const NEXT_PRIME_MINISTER_ORACLE_SOURCE_POLICY = JSON.stringify({
  preferredSourceIds: ["src_gov_il_news"],
  closeConditionSourceIds: ["src_gov_il_news"],
  resolutionSourceIds: ["src_gov_il_news"],
  requiresHumanReviewOnSourceConflict: true,
  notes: ["Use official government publication until a more specific coalition/swearing source is added."]
});

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function run(): Promise<void> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    await withTransaction(pool, async (client) => {
      const existingSeed = await client.query<{ existing_id: string }>(
        `
          select id as existing_id
          from markets
          where id in ($1, $2)
          union all
          select id as existing_id
          from accounts
          where id in ($3, $4, $5, $6, $7, $8, $9)
          union all
          select id as existing_id
          from users
          where id in ($10, $11)
          limit 1
        `,
        [
          SEED_IDS.markets.bankIsrael,
          SEED_IDS.markets.nextPrimeMinister,
          SEED_IDS.accounts.mintSource,
          SEED_IDS.accounts.platformTreasury,
          SEED_IDS.accounts.sink,
          SEED_IDS.accounts.bankIsraelTreasury,
          SEED_IDS.accounts.nextPrimeMinisterTreasury,
          SEED_IDS.accounts.userCash,
          SEED_IDS.accounts.adminCash,
          SEED_IDS.users.demo,
          SEED_IDS.users.admin
        ]
      );

      if (existingSeed.rowCount && existingSeed.rows[0]) {
        throw new Error("Baseline seed already exists. Run npm run db:reset first.");
      }

      const marketOpenAt = hoursFromNow(-24);
      const marketCloseAt = hoursFromNow(24 * 30);

      await client.query(
        `
          insert into users (id, handle, status, role, trade_access_status, last_login_at)
          values
            ($1, 'seed_user', 'active', 'user', 'enabled', now()),
            ($2, 'seed_admin', 'active', 'admin', 'enabled', now())
          on conflict (id) do nothing
        `,
        [SEED_IDS.users.demo, SEED_IDS.users.admin]
      );

      await client.query(
        `
          insert into user_identities (
            id,
            user_id,
            type,
            identifier_normalized,
            identifier_display,
            status,
            verified_at
          )
          values
            ($1, $2, 'email', $3, $3, 'active', now()),
            ($4, $5, 'email', $6, $6, 'active', now())
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.identities.demo,
          SEED_IDS.users.demo,
          SEEDED_USER_EMAIL,
          SEED_IDS.identities.admin,
          SEED_IDS.users.admin,
          SEEDED_ADMIN_EMAIL
        ]
      );

      await client.query(
        `
          insert into accounts (id, type, owner_id, status, balance_cached)
          values
            ($1, 'mint_source', 'system', 'active', $8),
            ($2, 'platform_treasury', 'platform', 'active', $9),
            ($3, 'sink', 'system', 'active', '0.000000'),
            ($4, 'market_treasury', $10, 'active', $11),
            ($5, 'market_treasury', $12, 'active', $11),
            ($6, 'user_cash', $13, 'active', $14),
            ($7, 'user_cash', $15, 'active', $16)
          on conflict do nothing
        `,
        [
          SEED_IDS.accounts.mintSource,
          SEED_IDS.accounts.platformTreasury,
          SEED_IDS.accounts.sink,
          SEED_IDS.accounts.bankIsraelTreasury,
          SEED_IDS.accounts.nextPrimeMinisterTreasury,
          SEED_IDS.accounts.userCash,
          SEED_IDS.accounts.adminCash,
          `-${PLATFORM_TREASURY_AMOUNT}`,
          "790000.000000",
          SEED_IDS.markets.bankIsrael,
          MARKET_TREASURY_AMOUNT,
          SEED_IDS.markets.nextPrimeMinister,
          SEED_IDS.users.demo,
          USER_CASH_AMOUNT,
          SEED_IDS.users.admin,
          ADMIN_CASH_AMOUNT
        ]
      );

      await client.query(
        `
          insert into markets (
            id,
            status,
            settlement_status,
            title,
            description,
            category_key,
            open_at,
            close_at,
            published_at,
            close_on_event_completion,
            event_completion_close_requires_human_approval,
            oracle_source_policy,
            resolution_source,
            resolution_rules,
            liquidity_b,
            market_treasury_account_id,
            created_by
          )
          values (
            $1,
            'open',
            null,
            'החלטת הריבית הקרובה של בנק ישראל',
            'שוק בסיסי לזרימת backend אמיתית לפני חיבור מסחר מלא.',
            'economics',
            $2,
            $3,
            now(),
            false,
            false,
            $4,
            'bank_of_israel',
            'The market resolves to the single Bank of Israel rate decision outcome declared on the scheduled decision date.',
            $5,
            $6,
            $7
          )
          on conflict (id) do update
          set close_on_event_completion = excluded.close_on_event_completion,
              event_completion_close_requires_human_approval = excluded.event_completion_close_requires_human_approval,
              oracle_source_policy = excluded.oracle_source_policy
        `,
        [
          SEED_IDS.markets.bankIsrael,
          marketOpenAt.toISOString(),
          marketCloseAt.toISOString(),
          BANK_ISRAEL_ORACLE_SOURCE_POLICY,
          LIQUIDITY_B,
          SEED_IDS.accounts.bankIsraelTreasury,
          SEED_IDS.actor
        ]
      );

      await client.query(
        `
          insert into markets (
            id,
            status,
            settlement_status,
            title,
            description,
            category_key,
            open_at,
            close_at,
            published_at,
            close_on_event_completion,
            event_completion_close_requires_human_approval,
            oracle_source_policy,
            resolution_source,
            resolution_rules,
            liquidity_b,
            market_treasury_account_id,
            created_by
          )
          values (
            $1,
            'open',
            null,
            'מי יהיה ראש הממשלה הבא?',
            'שוק smoke ראשון ל-market detail 4 תוצאות מול backend אמיתי.',
            'politics',
            $2,
            $3,
            now(),
            true,
            true,
            $4,
            'official_election_result',
            'The market resolves to the single candidate officially sworn in as the next prime minister of Israel after the relevant election or coalition process.',
            $5,
            $6,
            $7
          )
          on conflict (id) do update
          set close_on_event_completion = excluded.close_on_event_completion,
              event_completion_close_requires_human_approval = excluded.event_completion_close_requires_human_approval,
              oracle_source_policy = excluded.oracle_source_policy
        `,
        [
          SEED_IDS.markets.nextPrimeMinister,
          marketOpenAt.toISOString(),
          hoursFromNow(24 * 90).toISOString(),
          NEXT_PRIME_MINISTER_ORACLE_SOURCE_POLICY,
          LIQUIDITY_B,
          SEED_IDS.accounts.nextPrimeMinisterTreasury,
          SEED_IDS.actor
        ]
      );

      await client.query(
        `
          insert into market_outcomes (id, market_id, label, short_label, sort_order, color_key)
          values
            ($1, $5, 'ללא שינוי', 'ללא שינוי', 0, 'blue'),
            ($2, $5, 'ירידה 0.25%', '0.25%-', 1, 'green'),
            ($3, $5, 'ירידה 0.50%+', '0.50%-', 2, 'orange'),
            ($4, $5, 'העלאה', 'העלאה', 3, 'pink')
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.outcomes.bankIsrael[0],
          SEED_IDS.outcomes.bankIsrael[1],
          SEED_IDS.outcomes.bankIsrael[2],
          SEED_IDS.outcomes.bankIsrael[3],
          SEED_IDS.markets.bankIsrael
        ]
      );

      await client.query(
        `
          insert into market_outcomes (id, market_id, label, short_label, sort_order, color_key)
          values
            ($1, $5, 'מועמד א''', 'א''', 0, 'blue'),
            ($2, $5, 'מועמד ב''', 'ב''', 1, 'green'),
            ($3, $5, 'מועמד ג''', 'ג''', 2, 'orange'),
            ($4, $5, 'מועמד ד''', 'ד''', 3, 'pink')
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.outcomes.nextPrimeMinister[0],
          SEED_IDS.outcomes.nextPrimeMinister[1],
          SEED_IDS.outcomes.nextPrimeMinister[2],
          SEED_IDS.outcomes.nextPrimeMinister[3],
          SEED_IDS.markets.nextPrimeMinister
        ]
      );

      await client.query(
        `
          insert into market_pricing_state (market_id, version, liquidity_b)
          values ($1, 0, $2)
          on conflict (market_id) do nothing
        `,
        [SEED_IDS.markets.bankIsrael, LIQUIDITY_B]
      );

      await client.query(
        `
          insert into market_pricing_state (market_id, version, liquidity_b)
          values ($1, 0, $2)
          on conflict (market_id) do nothing
        `,
        [SEED_IDS.markets.nextPrimeMinister, LIQUIDITY_B]
      );

      await client.query(
        `
          insert into market_outcome_state (market_id, outcome_id, q_shares, last_price)
          values
            ($1, $2, $6, $7),
            ($1, $3, $6, $7),
            ($1, $4, $6, $7),
            ($1, $5, $6, $7)
          on conflict (market_id, outcome_id) do nothing
        `,
        [
          SEED_IDS.markets.bankIsrael,
          SEED_IDS.outcomes.bankIsrael[0],
          SEED_IDS.outcomes.bankIsrael[1],
          SEED_IDS.outcomes.bankIsrael[2],
          SEED_IDS.outcomes.bankIsrael[3],
          INITIAL_Q_SHARES,
          INITIAL_PRICE
        ]
      );

      await client.query(
        `
          insert into market_outcome_state (market_id, outcome_id, q_shares, last_price)
          values
            ($1, $2, $6, $7),
            ($1, $3, $6, $7),
            ($1, $4, $6, $7),
            ($1, $5, $6, $7)
          on conflict (market_id, outcome_id) do nothing
        `,
        [
          SEED_IDS.markets.nextPrimeMinister,
          SEED_IDS.outcomes.nextPrimeMinister[0],
          SEED_IDS.outcomes.nextPrimeMinister[1],
          SEED_IDS.outcomes.nextPrimeMinister[2],
          SEED_IDS.outcomes.nextPrimeMinister[3],
          INITIAL_Q_SHARES,
          INITIAL_PRICE
        ]
      );

      await client.query(
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
            previous_transaction_hash,
            transaction_hash
          )
          values
            ($1, 1, 'mint', 'system', 'seed_mint', $5, $9, now(), 'GENESIS', 'seed-hash-001'),
            ($2, 2, 'market_seed', 'market', $6, $6, $9, now(), 'seed-hash-001', 'seed-hash-002'),
            ($3, 3, 'market_seed', 'market', $7, $7, $9, now(), 'seed-hash-002', 'seed-hash-003'),
            ($4, 4, 'grant', 'grant', $8, $8, $9, now(), 'seed-hash-003', 'seed-hash-004')
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.ledger.mint,
          SEED_IDS.ledger.bankIsraelMarketSeed,
          SEED_IDS.ledger.nextPrimeMinisterMarketSeed,
          SEED_IDS.ledger.userGrant,
          SEED_IDS.idempotency.mint,
          SEED_IDS.idempotency.bankIsraelMarketSeed,
          SEED_IDS.idempotency.nextPrimeMinisterMarketSeed,
          SEED_IDS.idempotency.userGrant,
          SEED_IDS.actor
        ]
      );

      await client.query(
        `
          insert into ledger_entries (id, transaction_id, account_id, amount, entry_role)
          values
            ('ledger_entry_seed_mint_1', $1, $2, $10, 'debit_mint_source'),
            ('ledger_entry_seed_mint_2', $1, $3, $11, 'credit_platform_treasury'),
            ('ledger_entry_seed_market_seed_bank_israel_1', $4, $3, $12, 'debit_platform_treasury'),
            ('ledger_entry_seed_market_seed_bank_israel_2', $4, $5, $13, 'credit_market_treasury'),
            ('ledger_entry_seed_market_seed_next_pm_1', $6, $3, $12, 'debit_platform_treasury'),
            ('ledger_entry_seed_market_seed_next_pm_2', $6, $7, $13, 'credit_market_treasury'),
            ('ledger_entry_seed_user_grant_1', $8, $3, $14, 'debit_platform_treasury'),
            ('ledger_entry_seed_user_grant_2', $8, $9, $15, 'credit_user_cash')
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.ledger.mint,
          SEED_IDS.accounts.mintSource,
          SEED_IDS.accounts.platformTreasury,
          SEED_IDS.ledger.bankIsraelMarketSeed,
          SEED_IDS.accounts.bankIsraelTreasury,
          SEED_IDS.ledger.nextPrimeMinisterMarketSeed,
          SEED_IDS.accounts.nextPrimeMinisterTreasury,
          SEED_IDS.ledger.userGrant,
          SEED_IDS.accounts.userCash,
          `-${PLATFORM_TREASURY_AMOUNT}`,
          PLATFORM_TREASURY_AMOUNT,
          `-${MARKET_TREASURY_AMOUNT}`,
          MARKET_TREASURY_AMOUNT,
          `-${USER_CASH_AMOUNT}`,
          USER_CASH_AMOUNT
        ]
      );

      await client.query(
        `
          insert into idempotency_records (
            id,
            scope,
            actor_id,
            idempotency_key,
            request_hash,
            status,
            response_snapshot,
            created_at,
            completed_at
          )
          values
            ('idempotency_seed_mint', 'mint', $1, $2, 'seed-request-hash-mint', 'completed', '{"seed":true}', now(), now()),
            ('idempotency_seed_market_seed_bank_israel', 'publish_market', $1, $3, 'seed-request-hash-market-seed-bank-israel', 'completed', '{"seed":true}', now(), now()),
            ('idempotency_seed_market_seed_next_prime_minister', 'publish_market', $1, $4, 'seed-request-hash-market-seed-next-prime-minister', 'completed', '{"seed":true}', now(), now()),
            ('idempotency_seed_user_grant', 'grant', $1, $5, 'seed-request-hash-user-grant', 'completed', '{"seed":true}', now(), now())
          on conflict (id) do nothing
        `,
        [
          SEED_IDS.actor,
          SEED_IDS.idempotency.mint,
          SEED_IDS.idempotency.bankIsraelMarketSeed,
          SEED_IDS.idempotency.nextPrimeMinisterMarketSeed,
          SEED_IDS.idempotency.userGrant
        ]
      );

      await client.query(
        `
          insert into audit_events (id, actor_id, action, entity_type, entity_id, payload)
          values
            ('audit_seed_market_created_bank_israel', $1, 'seed_market_created', 'market', $2, '{"seed":true}'),
            ('audit_seed_market_created_next_prime_minister', $1, 'seed_market_created', 'market', $3, '{"seed":true}'),
            ('audit_seed_funding_created_bank_israel', $1, 'seed_funding_created', 'market', $2, '{"seed":true}'),
            ('audit_seed_funding_created_next_prime_minister', $1, 'seed_funding_created', 'market', $3, '{"seed":true}')
          on conflict (id) do nothing
        `,
        [SEED_IDS.actor, SEED_IDS.markets.bankIsrael, SEED_IDS.markets.nextPrimeMinister]
      );
    });

    console.log(
      `seeded ${SEED_IDS.markets.bankIsrael} + ${SEED_IDS.markets.nextPrimeMinister} + users ${SEED_IDS.users.demo}, ${SEED_IDS.users.admin}`
    );
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
