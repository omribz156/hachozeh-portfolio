import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";
import { readStringArg } from "./script-args";

type Verdict = "pass" | "review";
type ContractSide = "yes" | "no";

type MoneyAuditOptions = {
  marketId: string;
  json: boolean;
  failOnReview: boolean;
  renderLogReceipt: boolean;
};

type MarketAuditRow = {
  id: string;
  title: string;
  status: string;
  settlement_status: string | null;
  resolved_at: Date | string | null;
  market_treasury_account_id: string | null;
  resolution_id: string | null;
  winning_outcome_id: string | null;
  winner_label: string | null;
  market_treasury_balance: string | null;
};

type OutcomeAuditRow = {
  id: string;
  label: string;
  sort_order: number;
};

type ContractPositionAuditRow = {
  user_label: string;
  user_id: string;
  outcome_id: string;
  outcome_label: string | null;
  contract_side: ContractSide;
  contract_shares: string;
  contract_cost: string;
  settled: boolean;
};

type RealizationAuditRow = {
  id: string;
  user_label: string;
  user_id: string;
  outcome_id: string;
  outcome_label: string | null;
  type: "resolution_win" | "resolution_loss";
  claim_status: "pending" | "claimed" | "not_applicable";
  shares: string;
  proceeds: string;
  cost: string;
  pnl: string;
  created_at: Date | string;
};

type IncidentCompensationAuditRow = {
  realization_event_id: string;
  amount: string;
};

type ContractCoverage = ContractPositionAuditRow & {
  expected_outcome_ids: string[];
  realized_rows: number;
  realized_shares: string;
  realized_cost: string;
  share_delta: string;
  cost_delta: string;
  ok: boolean;
};

export type ResolutionMoneyAuditReport = {
  objectType: "resolution_money_audit";
  generatedAt: string;
  marketId: string;
  verdict: Verdict;
  market: MarketAuditRow | null;
  tradeSummary: Array<Record<string, unknown>>;
  realizationSummary: Array<Record<string, unknown>>;
  pendingClaims: {
    pending: string;
    claimed: string;
    winner_events: number;
    loser_events: number;
  };
  positions: {
    engine_open: number;
    contract_total: number;
    contract_unsettled: number;
    contract_settled: number;
  };
  realized: RealizationAuditRow[];
  incidentCompensation: IncidentCompensationAuditRow[];
  contractCoverage: ContractCoverage[];
  ledgerTx: Array<Record<string, unknown>>;
  accountDrift: Array<Record<string, unknown>>;
  lifecycle: Array<Record<string, unknown>>;
  checks: Record<string, boolean>;
};

function numeric(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function fixed(value: number): string {
  return value.toFixed(6);
}

function closeEnough(left: string | number | null | undefined, right: string | number): boolean {
  return Math.abs(numeric(left) - numeric(right)) <= 0.00001;
}

function sumRows<T>(rows: readonly T[], read: (row: T) => string): string {
  return fixed(rows.reduce((sum, row) => sum + numeric(read(row)), 0));
}

export function resolveContractExecutionOutcomeIds(
  outcomes: readonly OutcomeAuditRow[],
  requestedOutcomeId: string,
  contractSide: ContractSide
): string[] {
  if (contractSide === "yes") {
    return [requestedOutcomeId];
  }

  return outcomes
    .filter((outcome) => outcome.id !== requestedOutcomeId)
    .map((outcome) => outcome.id);
}

export function buildContractCoverage(
  outcomes: readonly OutcomeAuditRow[],
  contracts: readonly ContractPositionAuditRow[],
  realizations: readonly RealizationAuditRow[],
  resolutionCutoff: Date | string | null = null,
  resolutionCutoffToleranceMs = 1_000
): ContractCoverage[] {
  const cutoffTime = resolutionCutoff == null
    ? null
    : new Date(resolutionCutoff).getTime() - resolutionCutoffToleranceMs;
  const contractRealizations = cutoffTime == null
    ? realizations
    : realizations.filter((row) => new Date(row.created_at).getTime() >= cutoffTime);

  return contracts.map((contract) => {
    const expectedOutcomeIds = resolveContractExecutionOutcomeIds(
      outcomes,
      contract.outcome_id,
      contract.contract_side
    );
    const expectedOutcomeIdSet = new Set(expectedOutcomeIds);
    const matchingRealizations = contractRealizations.filter((row) => (
      row.user_id === contract.user_id && expectedOutcomeIdSet.has(row.outcome_id)
    ));
    const realizedShares = sumRows(matchingRealizations, (row) => row.shares);
    const realizedCost = sumRows(matchingRealizations, (row) => row.cost);
    const expectedShares = fixed(numeric(contract.contract_shares) * expectedOutcomeIds.length);
    const shareDelta = fixed(numeric(expectedShares) - numeric(realizedShares));
    const costDelta = fixed(numeric(contract.contract_cost) - numeric(realizedCost));

    return {
      ...contract,
      expected_outcome_ids: expectedOutcomeIds,
      realized_rows: matchingRealizations.length,
      realized_shares: realizedShares,
      realized_cost: realizedCost,
      share_delta: shareDelta,
      cost_delta: costDelta,
      ok: contract.settled && closeEnough(shareDelta, 0) && closeEnough(costDelta, 0)
    };
  });
}

export function realizationsMatchWinnerOrCompensation(
  realizations: readonly RealizationAuditRow[],
  winningOutcomeId: string | null,
  compensationRows: readonly IncidentCompensationAuditRow[]
): boolean {
  if (!winningOutcomeId) return false;

  const compensationByRealization = new Map(
    compensationRows.map((row) => [row.realization_event_id, row.amount])
  );

  return realizations.every((row) => {
    const shouldWin = row.outcome_id === winningOutcomeId;
    if (!shouldWin) {
      return row.type === "resolution_loss" && closeEnough(row.proceeds, 0);
    }
    if (row.type === "resolution_win") {
      return closeEnough(row.proceeds, row.shares);
    }

    const missingProceeds = numeric(row.shares) - numeric(row.proceeds);
    return closeEnough(compensationByRealization.get(row.id), missingProceeds);
  });
}

function readFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parseResolutionMoneyAuditOptions(
  args = process.argv.slice(2)
): MoneyAuditOptions {
  const marketId = readStringArg(args, "market-id", "").trim();

  if (!marketId) {
    throw new Error("--market-id is required.");
  }

  return {
    marketId,
    json: readFlag(args, "json"),
    failOnReview: readFlag(args, "fail-on-review"),
    renderLogReceipt: readFlag(args, "render-log-receipt")
  };
}

async function rows<T extends Record<string, unknown>>(
  db: Queryable,
  sql: string,
  marketId: string
): Promise<T[]> {
  return (await db.query(sql, [marketId])).rows as T[];
}

async function one<T extends Record<string, unknown>>(
  db: Queryable,
  sql: string,
  marketId: string
): Promise<T | null> {
  return (await db.query(sql, [marketId])).rows[0] as T | undefined ?? null;
}

export async function runResolutionMoneyAudit(
  db: Queryable,
  marketId: string,
  now = new Date()
): Promise<ResolutionMoneyAuditReport> {
  const market = await one<MarketAuditRow>(db, `
    select
      m.id,
      m.title,
      m.status,
      m.settlement_status,
      m.resolved_at,
      m.market_treasury_account_id,
      mr.id as resolution_id,
      mr.winning_outcome_id,
      wo.label as winner_label,
      a.balance_cached::numeric(20, 6)::text as market_treasury_balance
    from markets m
    left join market_resolutions mr
      on mr.market_id = m.id
    left join market_outcomes wo
      on wo.market_id = m.id
     and wo.id = mr.winning_outcome_id
    left join accounts a
      on a.id = m.market_treasury_account_id
    where m.id = $1
  `, marketId);

  if (!market) {
    return {
      objectType: "resolution_money_audit",
      generatedAt: now.toISOString(),
      marketId,
      verdict: "review",
      market: null,
      tradeSummary: [],
      realizationSummary: [],
      pendingClaims: { pending: "0.000000", claimed: "0.000000", winner_events: 0, loser_events: 0 },
      positions: { engine_open: 0, contract_total: 0, contract_unsettled: 0, contract_settled: 0 },
      realized: [],
      incidentCompensation: [],
      contractCoverage: [],
      ledgerTx: [],
      accountDrift: [],
      lifecycle: [],
      checks: { market_exists: false }
    };
  }

  const [
    outcomes,
    tradeSummary,
    realized,
    realizationSummary,
    positions,
    contractPositions,
    pendingClaims,
    ledgerTx,
    accountDrift,
    lifecycle,
    incidentCompensation
  ] = await Promise.all([
    rows<OutcomeAuditRow>(db, `
      select id, label, sort_order
      from market_outcomes
      where market_id = $1
      order by sort_order
    `, marketId),
    rows<Record<string, unknown>>(db, `
      select
        side,
        contract_side,
        count(*)::int as trades,
        coalesce(sum(cash_amount), 0)::numeric(20, 6)::text as cash,
        coalesce(sum(share_amount), 0)::numeric(20, 6)::text as shares,
        count(distinct user_id)::int as users
      from trades
      where market_id = $1
      group by side, contract_side
      order by side, contract_side
    `, marketId),
    rows<RealizationAuditRow>(db, `
      select
        re.id,
        coalesce(nullif(u.display_name, ''), nullif(u.handle, ''), 'user_' || substr(re.user_id, 1, 8)) as user_label,
        re.user_id,
        re.outcome_id,
        o.label as outcome_label,
        re.type,
        re.claim_status,
        re.shares_closed::numeric(20, 6)::text as shares,
        re.proceeds::numeric(20, 6)::text as proceeds,
        re.removed_cost_basis::numeric(20, 6)::text as cost,
        re.realized_pnl::numeric(20, 6)::text as pnl,
        re.created_at
      from realization_events re
      left join users u
        on u.id = re.user_id
      left join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      where re.market_id = $1
        and re.type in ('resolution_win', 'resolution_loss')
      order by re.type desc, re.proceeds desc, user_label
    `, marketId),
    rows<Record<string, unknown>>(db, `
      select
        type,
        claim_status,
        count(*)::int as events,
        coalesce(sum(shares_closed), 0)::numeric(20, 6)::text as shares,
        coalesce(sum(proceeds), 0)::numeric(20, 6)::text as proceeds,
        coalesce(sum(removed_cost_basis), 0)::numeric(20, 6)::text as cost,
        coalesce(sum(realized_pnl), 0)::numeric(20, 6)::text as pnl
      from realization_events
      where market_id = $1
        and type in ('resolution_win', 'resolution_loss')
      group by type, claim_status
      order by type, claim_status
    `, marketId),
    one<ResolutionMoneyAuditReport["positions"]>(db, `
      select
        (select count(*)::int from positions where market_id = $1) as engine_open,
        (select count(*)::int from contract_positions where market_id = $1) as contract_total,
        (select count(*)::int from contract_positions where market_id = $1 and settled_at is null) as contract_unsettled,
        (select count(*)::int from contract_positions where market_id = $1 and settled_at is not null) as contract_settled
    `, marketId),
    rows<ContractPositionAuditRow>(db, `
      select
        coalesce(nullif(u.display_name, ''), nullif(u.handle, ''), 'user_' || substr(cp.user_id, 1, 8)) as user_label,
        cp.user_id,
        cp.requested_outcome_id as outcome_id,
        o.label as outcome_label,
        cp.contract_side,
        cp.shares::numeric(20, 6)::text as contract_shares,
        cp.cost_basis::numeric(20, 6)::text as contract_cost,
        cp.settled_at is not null as settled
      from contract_positions cp
      left join users u
        on u.id = cp.user_id
      left join market_outcomes o
        on o.market_id = cp.market_id
       and o.id = cp.requested_outcome_id
      where cp.market_id = $1
      order by user_label, outcome_label, cp.contract_side
    `, marketId),
    one<ResolutionMoneyAuditReport["pendingClaims"]>(db, `
      select
        coalesce(sum(proceeds) filter (where type = 'resolution_win' and claim_status = 'pending'), 0)::numeric(20, 6)::text as pending,
        coalesce(sum(proceeds) filter (where type = 'resolution_win' and claim_status = 'claimed'), 0)::numeric(20, 6)::text as claimed,
        count(*) filter (where type = 'resolution_win')::int as winner_events,
        count(*) filter (where type = 'resolution_loss')::int as loser_events
      from realization_events
      where market_id = $1
        and type in ('resolution_win', 'resolution_loss')
    `, marketId),
    rows<Record<string, unknown>>(db, `
      with tx as (
        select
          lt.id,
          lt.type,
          count(le.id)::int as entries,
          coalesce(sum(le.amount), 0)::numeric(20, 6)::text as balance
        from ledger_transactions lt
        left join ledger_entries le
          on le.transaction_id = lt.id
        where lt.market_id = $1
        group by lt.id, lt.type
      )
      select
        type,
        count(*)::int as tx_count,
        coalesce(sum(abs(balance::numeric)), 0)::numeric(20, 6)::text as abs_unbalance,
        count(*) filter (where abs(balance::numeric) > 0.00001)::int as unbalanced
      from tx
      group by type
      order by type
    `, marketId),
    rows<Record<string, unknown>>(db, `
      with involved as (
        select distinct le.account_id
        from ledger_transactions lt
        join ledger_entries le
          on le.transaction_id = lt.id
        where lt.market_id = $1
        union
        select market_treasury_account_id
        from markets
        where id = $1
          and market_treasury_account_id is not null
      ),
      ledger as (
        select
          account_id,
          coalesce(sum(amount), 0)::numeric(20, 6) as ledger_balance
        from ledger_entries
        where account_id in (select account_id from involved)
        group by account_id
      )
      select
        a.id,
        a.type,
        coalesce(nullif(u.display_name, ''), nullif(u.handle, ''), a.owner_id) as owner_label,
        a.balance_cached::numeric(20, 6)::text as cached,
        coalesce(l.ledger_balance, 0)::numeric(20, 6)::text as ledger,
        (a.balance_cached - coalesce(l.ledger_balance, 0))::numeric(20, 6)::text as drift
      from accounts a
      left join ledger l
        on l.account_id = a.id
      left join users u
        on u.id = a.owner_id
      where a.id in (select account_id from involved)
        and abs(a.balance_cached - coalesce(l.ledger_balance, 0)) > 0.00001
      order by a.type, owner_label
    `, marketId),
    rows<Record<string, unknown>>(db, `
      select event_type, occurred_at, payload
      from lifecycle_events
      where market_id = $1
        and event_type in ('market_resolved', 'settlement_completed')
      order by occurred_at
    `, marketId),
    rows<IncidentCompensationAuditRow>(db, `
      select
        re.id as realization_event_id,
        coalesce(sum(le.amount) filter (
          where le.entry_role = 'credit_user_cash_incident_compensation'
        ), 0)::numeric(20, 6)::text as amount
      from realization_events re
      join ledger_transactions lt
        on lt.reference_type = 'market_incident_compensation'
       and lt.reference_id = 'market_incident_compensation:' || re.market_id || ':' || re.id
      join ledger_entries le
        on le.transaction_id = lt.id
      where re.market_id = $1
      group by re.id
      order by re.id
    `, marketId)
  ]);

  const positionCounts = positions ?? {
    engine_open: 0,
    contract_total: 0,
    contract_unsettled: 0,
    contract_settled: 0
  };
  const claims = pendingClaims ?? {
    pending: "0.000000",
    claimed: "0.000000",
    winner_events: 0,
    loser_events: 0
  };
  const contractCoverage = buildContractCoverage(
    outcomes,
    contractPositions,
    realized,
    market.resolved_at
  );
  const checks = {
    market_exists: true,
    resolved_completed: market.status === "resolved" && market.settlement_status === "completed",
    has_resolution_winner: typeof market.winning_outcome_id === "string" && market.winning_outcome_id.length > 0,
    no_engine_positions: positionCounts.engine_open === 0,
    contract_positions_settled: positionCounts.contract_unsettled === 0,
    contract_positions_have_realizations: contractCoverage.every((row) => row.ok),
    realizations_match_winner_or_compensation: realizationsMatchWinnerOrCompensation(
      realized,
      market.winning_outcome_id,
      incidentCompensation
    ),
    treasury_equals_pending_claims: closeEnough(market.market_treasury_balance, claims.pending),
    ledger_balanced: ledgerTx.every((row) => Number(row.unbalanced) === 0),
    account_cache_no_drift_for_market_accounts: accountDrift.length === 0,
    lifecycle_has_resolution_and_settlement:
      lifecycle.some((row) => row.event_type === "market_resolved") &&
      lifecycle.some((row) => row.event_type === "settlement_completed")
  };

  return {
    objectType: "resolution_money_audit",
    generatedAt: now.toISOString(),
    marketId,
    verdict: Object.values(checks).every(Boolean) ? "pass" : "review",
    market,
    tradeSummary,
    realizationSummary,
    pendingClaims: claims,
    positions: positionCounts,
    realized,
    incidentCompensation,
    contractCoverage,
    ledgerTx,
    accountDrift,
    lifecycle,
    checks
  };
}

export function formatResolutionMoneyAudit(report: ResolutionMoneyAuditReport): string {
  if (!report.market) {
    return `resolution-money-audit: verdict=review market=${report.marketId} missing`;
  }

  return [
    `resolution-money-audit: verdict=${report.verdict} market=${report.marketId}`,
    `resolution-money-audit: status=${report.market.status}/${report.market.settlement_status ?? "null"} winner=${report.market.winner_label ?? report.market.winning_outcome_id ?? "none"}`,
    `resolution-money-audit: positions engine_open=${report.positions.engine_open} contract_total=${report.positions.contract_total} contract_unsettled=${report.positions.contract_unsettled}`,
    `resolution-money-audit: claims pending=${report.pendingClaims.pending} claimed=${report.pendingClaims.claimed} treasury=${report.market.market_treasury_balance ?? "null"}`,
    ...Object.entries(report.checks).map(([name, ok]) => (
      `resolution-money-audit: ${ok ? "ok" : "review"} ${name}`
    ))
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseResolutionMoneyAuditOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const report = await runResolutionMoneyAudit(pool, options.marketId);
    const output = options.json
      ? JSON.stringify(report, null, options.renderLogReceipt ? 0 : 2)
      : formatResolutionMoneyAudit(report);

    if (options.renderLogReceipt) {
      console.error(`PROD_RESOLUTION_MONEY_AUDIT ${output}`);
    } else {
      console.log(output);
    }

    if (report.verdict === "review" && options.failOnReview) {
      process.exitCode = 1;
    }

    if (options.renderLogReceipt) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
