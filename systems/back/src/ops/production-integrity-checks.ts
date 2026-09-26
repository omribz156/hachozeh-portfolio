import type { Queryable } from "../db/client/pool";
import { PLATFORM_TREASURY_LOW_WATERMARK } from "../economy/economy-config";

type IntegritySeverity = "bad" | "watch";

export type ProductionIntegrityCheck = {
  name: string;
  severity: IntegritySeverity;
  count: number;
};

export type ProductionIntegrityReport = {
  objectType: "production_integrity_report";
  generatedAt: string;
  verdict: "ok" | "watch" | "bad";
  checks: ProductionIntegrityCheck[];
};

type CheckDefinition = {
  name: string;
  severity: IntegritySeverity;
  sql: string;
};

const CHECKS: CheckDefinition[] = [
  {
    name: "negative_account_balances",
    severity: "bad",
    sql: `
      /* check:negative_account_balances */
      select count(*)::int as count
      from accounts
      where type in ('user_cash', 'market_treasury', 'platform_treasury', 'sink')
        and balance_cached < 0
    `
  },
  {
    name: "economy_system_accounts_missing_or_inactive",
    severity: "bad",
    sql: `
      /* check:economy_system_accounts_missing_or_inactive */
      with required(type) as (
        values ('mint_source'), ('platform_treasury'), ('sink')
      ),
      account_counts as (
        select type, count(*) filter (where status = 'active') as active_count
        from accounts
        where type in ('mint_source', 'platform_treasury', 'sink')
        group by type
      )
      select count(*)::int as count
      from required r
      left join account_counts a
        on a.type = r.type
      where coalesce(a.active_count, 0) <> 1
    `
  },
  {
    name: "economy_system_account_duplicates",
    severity: "bad",
    sql: `
      /* check:economy_system_account_duplicates */
      select count(*)::int as count
      from (
        select type
        from accounts
        where type in ('mint_source', 'platform_treasury', 'sink')
        group by type
        having count(*) > 1
      ) duplicates
    `
  },
  {
    name: "platform_treasury_below_low_watermark",
    severity: "watch",
    sql: `
      /* check:platform_treasury_below_low_watermark */
      select count(*)::int as count
      from accounts
      where type = 'platform_treasury'
        and status = 'active'
        and balance_cached < ${PLATFORM_TREASURY_LOW_WATERMARK}
    `
  },
  {
    name: "economy_faucet_tables_missing",
    severity: "bad",
    sql: `
      /* check:economy_faucet_tables_missing */
      select (
        (case when to_regclass('public.user_faucet_state') is null then 1 else 0 end) +
        (case when to_regclass('public.faucet_claims') is null then 1 else 0 end)
      )::int as count
    `
  },
  {
    name: "ledger_transactions_without_entries",
    severity: "bad",
    sql: `
      /* check:ledger_transactions_without_entries */
      select count(*)::int as count
      from (
        select lt.id
        from ledger_transactions lt
        left join ledger_entries le
          on le.transaction_id = lt.id
        group by lt.id
        having count(le.id) < 2
      ) missing_entries
    `
  },
  {
    name: "ledger_unbalanced_transactions",
    severity: "bad",
    sql: `
      /* check:ledger_unbalanced_transactions */
      select count(*)::int as count
      from (
        select lt.id
        from ledger_transactions lt
        join ledger_entries le
          on le.transaction_id = lt.id
        group by lt.id
        having abs(sum(le.amount)) > 0.000001
      ) unbalanced
    `
  },
  {
    name: "account_cached_balance_ledger_drift",
    severity: "watch",
    sql: `
      /* check:account_cached_balance_ledger_drift */
      with ledger as (
        select account_id, coalesce(sum(amount), 0)::numeric(20, 6) as ledger_balance
        from ledger_entries
        group by account_id
      )
      select count(*)::int as count
      from accounts a
      left join ledger l
        on l.account_id = a.id
      where abs(a.balance_cached - coalesce(l.ledger_balance, 0)) > 0.000001
    `
  },
  {
    name: "negative_positions",
    severity: "bad",
    sql: `
      /* check:negative_positions */
      select count(*)::int as count from positions where shares <= 0 or cost_basis < 0
    `
  },
  {
    name: "negative_contract_positions",
    severity: "bad",
    sql: `
      /* check:negative_contract_positions */
      select count(*)::int as count from contract_positions where shares <= 0 or cost_basis < 0
    `
  },
  {
    name: "invalid_outcome_state",
    severity: "bad",
    sql: `
      /* check:invalid_outcome_state */
      select count(*)::int as count from market_outcome_state where q_shares < 0 or last_price < 0 or last_price > 1
    `
  },
  {
    name: "market_price_sum_drift",
    severity: "bad",
    sql: `
      /* check:market_price_sum_drift */
      select count(*)::int as count
      from (
        select market_id, sum(last_price) as total_price
        from market_outcome_state
        group by market_id
        having sum(last_price) < 0.99900000 or sum(last_price) > 1.00100000
      ) drift
    `
  },
  {
    name: "open_markets_past_close",
    severity: "bad",
    sql: `
      /* check:open_markets_past_close */
      select count(*)::int as count from markets where status = 'open' and close_at <= now()
    `
  },
  {
    name: "resolved_markets_without_resolution",
    severity: "bad",
    sql: `
      /* check:resolved_markets_without_resolution */
      select count(*)::int as count
      from markets m
      left join market_resolutions mr on mr.market_id = m.id
      where m.status = 'resolved' and mr.id is null
    `
  },
  {
    name: "resolved_markets_unsettled",
    severity: "bad",
    sql: `
      /* check:resolved_markets_unsettled */
      select count(*)::int as count from markets where status = 'resolved' and settlement_status is distinct from 'completed'
    `
  },
  {
    name: "closed_markets_without_resolution_case",
    severity: "watch",
    sql: `
      /* check:closed_markets_without_resolution_case */
      select count(*)::int as count
      from markets m
      left join oracle_cases oc
        on oc.market_id = m.id
       and oc.case_type = 'resolution_check'
       and oc.case_status in ('recommended', 'review_needed')
      where m.status = 'closed'
        and m.resolved_at is null
        and oc.id is null
    `
  }
];

function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return 0;
}

export async function runProductionIntegrityChecks(
  db: Queryable
): Promise<ProductionIntegrityReport> {
  const checks: ProductionIntegrityCheck[] = [];

  for (const check of CHECKS) {
    const result = await db.query<{ count: number | string }>(check.sql);
    checks.push({
      name: check.name,
      severity: check.severity,
      count: readCount(result.rows[0]?.count)
    });
  }

  const hasBad = checks.some((check) => check.severity === "bad" && check.count > 0);
  const hasWatch = checks.some((check) => check.severity === "watch" && check.count > 0);

  return {
    objectType: "production_integrity_report",
    generatedAt: new Date().toISOString(),
    verdict: hasBad ? "bad" : hasWatch ? "watch" : "ok",
    checks
  };
}
