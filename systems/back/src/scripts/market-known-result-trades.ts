import { randomUUID } from "node:crypto";

import { Command, Option } from "commander";
import type { Pool, PoolClient } from "pg";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { insertEconomyTransferLedgerTransaction } from "../economy/economy-ledger";
import { splitCostBasisAcrossExecutionLegs } from "../engine/trading/trade-math";
import { updateOutcomeStatePrices } from "../engine/trading/pricing-state-writes";
import { appendBaseCandleFromState } from "../markets/market-history/base-candle-store";
import { quantizeMoney, quantizeShares, toDecimal } from "../shared/decimals";

type Options = {
  market?: string;
  cutoffAt?: string;
  trade?: string[];
  execute?: boolean;
  actorId?: string;
  reason?: string;
  idempotencyKey?: string;
  json?: boolean;
};

type MarketRow = {
  id: string;
  title: string;
  status: string;
  settlement_status: string | null;
  resolved_at: Date | null;
  liquidity_b: string;
  market_treasury_account_id: string;
  total_volume: string;
};

type TradeRow = {
  id: string;
  market_id: string;
  user_id: string;
  user_label: string;
  user_cash_account_id: string;
  outcome_id: string;
  requested_outcome_key: string;
  contract_side: "yes" | "no";
  side: "buy" | "sell";
  cash_amount: string;
  share_amount: string;
  created_at: Date;
  original_ledger_transaction_id: string;
  reversal_ledger_transaction_id: string | null;
};

type LegRow = { trade_id: string; outcome_id: string; share_amount: string; sort_order: number };
type StateRow = { outcome_id: string; q_shares: string };

export type KnownResultTradePlan = {
  objectType: "known_result_trade_plan";
  generatedAt: string;
  dryRun: boolean;
  market: MarketRow | null;
  cutoffAt: string;
  selectedTradeIds: string[];
  blockers: string[];
  trades: Array<{
    id: string;
    userId: string;
    userLabel: string;
    side: string;
    contractSide: string;
    cashAmount: string;
    shareAmount: string;
    createdAt: string;
    alreadyReversed: boolean;
    executionLegs: LegRow[];
  }>;
  totalCash: string;
  totalShares: string;
  executedReversalCount: number;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatRefund(value: string): string {
  return `+V₪ ${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 }).format(Number.parseFloat(value))}`;
}

function parseCutoff(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("--cutoff-at must be an ISO timestamp.");
  return new Date(timestamp).toISOString();
}

async function readMarket(db: Queryable, marketId: string, lock: boolean): Promise<MarketRow | null> {
  const result = await db.query<MarketRow>(
    `
      select m.id, m.title, m.status, m.settlement_status, m.resolved_at,
             ps.liquidity_b::text, m.market_treasury_account_id,
             ps.total_volume::numeric(20, 6)::text
      from markets m
      join market_pricing_state ps on ps.market_id = m.id
      where m.id = $1
      ${lock ? "for update of m, ps" : ""}
    `,
    [marketId]
  );
  return result.rows[0] ?? null;
}

async function readTrades(db: Queryable, marketId: string, cutoffAt: string, lock: boolean): Promise<TradeRow[]> {
  return (
    await db.query<TradeRow>(
      `
        select t.id, t.market_id, t.user_id,
               coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.handle), ''), u.id) as user_label,
               a.id as user_cash_account_id,
               t.outcome_id, t.requested_outcome_key, t.contract_side, t.side,
               t.cash_amount::text, t.share_amount::text, t.created_at,
               original.id as original_ledger_transaction_id,
               reversal.id as reversal_ledger_transaction_id
        from trades t
        join users u on u.id = t.user_id
        join accounts a on a.owner_id = t.user_id and a.type = 'user_cash'
        join ledger_transactions original
          on original.reference_type = 'trade' and original.reference_id = t.id
        left join ledger_transactions reversal
          on reversal.reference_type = 'known_result_trade_reversal'
         and reversal.reference_id = t.id
        where t.market_id = $1 and t.created_at >= $2::timestamptz
        order by t.created_at asc, t.id asc
        ${lock ? "for update of t" : ""}
      `,
      [marketId, cutoffAt]
    )
  ).rows;
}

async function readLegs(db: Queryable, tradeIds: string[]): Promise<LegRow[]> {
  if (tradeIds.length === 0) return [];
  return (
    await db.query<LegRow>(
      `select trade_id, outcome_id, share_amount::text, sort_order
       from trade_execution_legs where trade_id = any($1::text[])
       order by trade_id, sort_order`,
      [tradeIds]
    )
  ).rows;
}

export async function buildKnownResultTradePlan(
  db: Queryable,
  input: { marketId: string; cutoffAt: string; selectedTradeIds: string[]; execute: boolean },
  lock = false
): Promise<KnownResultTradePlan> {
  const market = await readMarket(db, input.marketId, lock);
  const tradesSinceCutoff = await readTrades(db, input.marketId, input.cutoffAt, lock);
  const selectedIds = unique(input.selectedTradeIds);
  const selected =
    selectedIds.length === 0 && !input.execute
      ? tradesSinceCutoff
      : tradesSinceCutoff.filter((trade) => selectedIds.includes(trade.id));
  const legs = await readLegs(db, selected.map((trade) => trade.id));
  const blockers: string[] = [];

  if (!market) blockers.push("market_not_found");
  if (market && (market.status !== "closed" || market.resolved_at || market.settlement_status === "completed")) {
    blockers.push("market_must_be_closed_unresolved");
  }
  if (input.execute && selectedIds.length === 0) blockers.push("no_trades_selected");
  for (const id of selectedIds) {
    if (!selected.some((trade) => trade.id === id)) blockers.push(`trade_not_found_after_cutoff:${id}`);
  }
  if (selected.some((trade) => trade.side !== "buy")) blockers.push("only_buy_trade_reversal_supported");
  if (selected.some((trade) => trade.reversal_ledger_transaction_id)) blockers.push("selected_trade_already_reversed");

  const firstSelected = selectedIds.length > 0 ? selected[0] : null;
  if (firstSelected) {
    const suffix = tradesSinceCutoff.filter((trade) =>
      trade.created_at.getTime() > firstSelected.created_at.getTime() ||
      (trade.created_at.getTime() === firstSelected.created_at.getTime() && trade.id >= firstSelected.id)
    );
    if (suffix.length !== selected.length || suffix.some((trade) => !selectedIds.includes(trade.id))) {
      blockers.push("selected_trades_are_not_exact_market_suffix");
    }
  }

  const legsByTrade = new Map<string, LegRow[]>();
  for (const leg of legs) legsByTrade.set(leg.trade_id, [...(legsByTrade.get(leg.trade_id) ?? []), leg]);
  for (const trade of selected) {
    if ((legsByTrade.get(trade.id) ?? []).length === 0) blockers.push(`trade_has_no_execution_legs:${trade.id}`);
  }

  return {
    objectType: "known_result_trade_plan",
    generatedAt: new Date().toISOString(),
    dryRun: !input.execute,
    market,
    cutoffAt: input.cutoffAt,
    selectedTradeIds: selectedIds,
    blockers: unique(blockers),
    trades: selected.map((trade) => ({
      id: trade.id,
      userId: trade.user_id,
      userLabel: trade.user_label,
      side: trade.side,
      contractSide: trade.contract_side,
      cashAmount: trade.cash_amount,
      shareAmount: trade.share_amount,
      createdAt: trade.created_at.toISOString(),
      alreadyReversed: Boolean(trade.reversal_ledger_transaction_id),
      executionLegs: legsByTrade.get(trade.id) ?? []
    })),
    totalCash: quantizeMoney(selected.reduce((sum, trade) => sum.plus(trade.cash_amount), toDecimal(0))),
    totalShares: quantizeShares(selected.reduce((sum, trade) => sum.plus(trade.share_amount), toDecimal(0))),
    executedReversalCount: 0
  };
}

async function reverseTrade(
  client: PoolClient,
  trade: TradeRow,
  legs: LegRow[],
  market: MarketRow,
  input: { actorId: string; reason: string; idempotencyKey: string }
): Promise<void> {
  const contractPosition = (
    await client.query<{ shares: string; cost_basis: string }>(
      `select shares::text, cost_basis::text from contract_positions
       where user_id=$1 and market_id=$2 and requested_outcome_key=$3 and contract_side=$4 for update`,
      [trade.user_id, trade.market_id, trade.requested_outcome_key, trade.contract_side]
    )
  ).rows[0];
  if (!contractPosition || toDecimal(contractPosition.shares).lt(trade.share_amount) || toDecimal(contractPosition.cost_basis).lt(trade.cash_amount)) {
    throw new Error(`contract_position_insufficient:${trade.id}`);
  }

  const costDeltas = splitCostBasisAcrossExecutionLegs(trade.cash_amount, legs.length);
  for (const [index, leg] of legs.entries()) {
    const position = (
      await client.query<{ shares: string; cost_basis: string }>(
        `select shares::text, cost_basis::text from positions
         where user_id=$1 and market_id=$2 and outcome_id=$3 for update`,
        [trade.user_id, trade.market_id, leg.outcome_id]
      )
    ).rows[0];
    const costDelta = costDeltas[index]!;
    if (!position || toDecimal(position.shares).lt(leg.share_amount) || toDecimal(position.cost_basis).lt(costDelta)) {
      throw new Error(`position_insufficient:${trade.id}:${leg.outcome_id}`);
    }
    const sharesAfter = quantizeShares(toDecimal(position.shares).minus(leg.share_amount));
    const costAfter = quantizeMoney(toDecimal(position.cost_basis).minus(costDelta));
    if (toDecimal(sharesAfter).isZero()) {
      await client.query(`delete from positions where user_id=$1 and market_id=$2 and outcome_id=$3`, [trade.user_id, trade.market_id, leg.outcome_id]);
    } else {
      await client.query(
        `update positions set shares=$4, cost_basis=$5, updated_at=now(), last_trade_at=now()
         where user_id=$1 and market_id=$2 and outcome_id=$3`,
        [trade.user_id, trade.market_id, leg.outcome_id, sharesAfter, costAfter]
      );
    }
  }

  const contractSharesAfter = quantizeShares(toDecimal(contractPosition.shares).minus(trade.share_amount));
  const contractCostAfter = quantizeMoney(toDecimal(contractPosition.cost_basis).minus(trade.cash_amount));
  if (toDecimal(contractSharesAfter).isZero()) {
    await client.query(
      `delete from contract_positions where user_id=$1 and market_id=$2 and requested_outcome_key=$3 and contract_side=$4`,
      [trade.user_id, trade.market_id, trade.requested_outcome_key, trade.contract_side]
    );
  } else {
    await client.query(
      `update contract_positions set shares=$5, cost_basis=$6, updated_at=now(), last_trade_at=now()
       where user_id=$1 and market_id=$2 and requested_outcome_key=$3 and contract_side=$4`,
      [trade.user_id, trade.market_id, trade.requested_outcome_key, trade.contract_side, contractSharesAfter, contractCostAfter]
    );
  }

  for (const leg of legs) {
    const result = await client.query(
      `update market_outcome_state set q_shares=q_shares-$3::numeric(20,6), updated_at=now()
       where market_id=$1 and outcome_id=$2 and q_shares >= $3::numeric(20,6) returning outcome_id`,
      [trade.market_id, leg.outcome_id, leg.share_amount]
    );
    if (result.rowCount !== 1) throw new Error(`market_q_shares_insufficient:${trade.id}:${leg.outcome_id}`);
  }

  await insertEconomyTransferLedgerTransaction(client, {
    type: "adjustment",
    referenceType: "known_result_trade_reversal",
    referenceId: trade.id,
    idempotencyKey: `${input.idempotencyKey}:${trade.id}`,
    createdBy: input.actorId,
    triggeredBy: "known_result_incident_repair",
    triggeredById: input.actorId,
    marketId: trade.market_id,
    outcomeId: trade.outcome_id,
    compensatesTransactionId: trade.original_ledger_transaction_id,
    compensationReason: input.reason,
    sourceAccountId: market.market_treasury_account_id,
    sourceAccountType: "market_treasury",
    targetAccountId: trade.user_cash_account_id,
    targetAccountType: "user_cash",
    amount: trade.cash_amount,
    sourceEntryRole: "debit_market_treasury_known_result_reversal",
    targetEntryRole: "credit_user_cash_known_result_reversal"
  });

  await client.query(
    `insert into audit_events (id, actor_id, action, entity_type, entity_id, payload)
     values ($1,$2,'known_result_trade_reversed','trade',$3,$4::jsonb)`,
    [`audit_${randomUUID()}`, input.actorId, trade.id, JSON.stringify({ marketId: trade.market_id, reason: input.reason, cashRefunded: trade.cash_amount })]
  );

  await client.query(
    `insert into user_notifications (
       id, user_id, type, producer_type, producer_id, market_id, html,
       amount, amount_tone, thumb_glyph, thumb_accent, metadata, created_at
     ) values ($1,$2,'system','known_result_trade_reversal',$3,$4,$5,$6,'pos','undo','var(--hz-action-buy-strong)',$7::jsonb,now())
     on conflict (user_id, producer_type, producer_id) do nothing`,
    [
      `notification_${randomUUID()}`,
      trade.user_id,
      trade.id,
      trade.market_id,
      `<b>תיקון מסחר</b>: העסקה שלך ב־<span class="hz-notif__q">${escapeHtml(market.title)}</span> בוטלה והסכום המקורי הוחזר לחשבון.`,
      formatRefund(trade.cash_amount),
      JSON.stringify({
        objectType: "known_result_trade_reversal",
        tradeId: trade.id,
        marketId: trade.market_id,
        refundedAmount: trade.cash_amount,
        reason: input.reason
      })
    ]
  );
}

export async function runKnownResultTradeRepair(pool: Pool, options: Required<Pick<Options, "market" | "cutoffAt" | "trade" | "actorId" | "reason" | "idempotencyKey">> & { execute: boolean }): Promise<KnownResultTradePlan> {
  const input = {
    marketId: options.market,
    cutoffAt: parseCutoff(options.cutoffAt),
    selectedTradeIds: unique(options.trade),
    execute: options.execute
  };
  if (!options.execute) return buildKnownResultTradePlan(pool, input);

  return withTransaction(pool, async (client) => {
    const plan = await buildKnownResultTradePlan(client, input, true);
    if (plan.blockers.length > 0 || !plan.market) throw new Error(`repair_blocked:${plan.blockers.join(",")}`);
    const tradeRows = await readTrades(client, input.marketId, input.cutoffAt, false);
    const selectedRows = tradeRows.filter((trade) => input.selectedTradeIds.includes(trade.id)).reverse();
    const legs = await readLegs(client, input.selectedTradeIds);
    for (const trade of selectedRows) {
      await reverseTrade(client, trade, legs.filter((leg) => leg.trade_id === trade.id), plan.market, options);
    }

    const states = (
      await client.query<StateRow>(`select outcome_id, q_shares::text from market_outcome_state where market_id=$1 order by outcome_id for update`, [input.marketId])
    ).rows;
    await updateOutcomeStatePrices(client, input.marketId, states.map((row) => row.outcome_id), states.map((row) => row.q_shares), plan.market.liquidity_b);
    await client.query(
      `update market_pricing_state set version=version+1, updated_at=now() where market_id=$1`,
      [input.marketId]
    );
    await appendBaseCandleFromState(client, input.marketId);
    return { ...plan, dryRun: false, executedReversalCount: selectedRows.length };
  });
}

async function main(options: Options): Promise<void> {
  if (!options.market?.trim()) throw new Error("--market is required.");
  if (!options.cutoffAt?.trim()) throw new Error("--cutoff-at is required.");
  if (options.execute && !options.trade?.length) throw new Error("At least one --trade is required for --execute.");
  const pool = createDbPool(loadAppEnv().db);
  try {
    const report = await runKnownResultTradeRepair(pool, {
      market: options.market.trim(), cutoffAt: options.cutoffAt, trade: options.trade ?? [],
      actorId: options.actorId?.trim() || "operator", reason: options.reason?.trim() || "Known-result trading incident",
      idempotencyKey: options.idempotencyKey?.trim() || `known-result-trade-reversal:${options.market.trim()}`,
      execute: Boolean(options.execute)
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const collect = (value: string, previous: string[]) => [...previous, value];
  new Command("market-known-result-trades")
    .description("Audit or reverse an exact suffix of known-result trades on a closed unresolved market.")
    .requiredOption("--market <market-id>")
    .requiredOption("--cutoff-at <iso>")
    .addOption(new Option("--trade <trade-id>").argParser(collect).default([]))
    .option("--execute")
    .option("--actor-id <actor-id>")
    .option("--reason <text>")
    .option("--idempotency-key <key>")
    .option("--json")
    .action(main)
    .parseAsync(process.argv)
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
