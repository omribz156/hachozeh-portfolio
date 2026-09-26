import type { Queryable } from "../../db/client/pool";
import type { RequestActor } from "../../auth/actor-resolver";
import { buildFallbackImage } from "../../discovery/feed/image";
import {
  isMaterialShareAmount,
  MATERIAL_SHARES_THRESHOLD,
  quantizeMoney,
  quantizePrice,
  quantizeShares,
  toDecimal
} from "../../shared/decimals";
import {
  resolveCanonicalMarketKeyById,
  resolveOutcomeKey
} from "../../shared/market-identity";
import {
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../../shared/incident-compensation";
import type { AppEnv } from "../../config/env";
import { resolvePortfolioActor } from "./portfolio-actor";

type AccountRow = {
  balance_cached: string;
};

type RealizedPnlRow = {
  realized_pnl_total: string | null;
};

type PositionSnapshotRow = {
  market_id: string;
  market_title: string;
  category_key?: string | null;
  market_contract?: unknown;
  market_status: string;
  persisted_status?: string | null;
  close_at: Date | null;
  outcome_id: string;
  outcome_label: string;
  outcome_count: number | string | null;
  complement_outcome_id?: string | null;
  complement_outcome_label?: string | null;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
  current_price: string;
  day_start_price?: string;
  outcome_image_url?: string | null;
};

type ContractPositionSnapshotRow = {
  market_id: string;
  market_title: string;
  category_key?: string | null;
  market_contract?: unknown;
  market_status: string;
  persisted_status?: string | null;
  close_at: Date | null;
  requested_outcome_id: string;
  requested_outcome_label: string;
  complement_outcome_id: string | null;
  complement_outcome_label: string | null;
  leading_outcome_id: string | null;
  leading_outcome_label: string | null;
  leading_price: string | null;
  contract_side: "yes" | "no";
  outcome_count: number | string | null;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
  current_price: string;
  day_start_price?: string;
  outcome_image_url?: string | null;
};

type PortfolioMarketImage = ReturnType<typeof buildFallbackImage>;

export type PortfolioSnapshotResponse = {
  actorMode: "demo" | "session";
  asOf: string;
  summary: {
    availableCash: string;
    portfolioValue: string;
    totalAccountValue: string;
    realizedPnl: string;
    unrealizedPnl: string;
    openPositionsCount: number;
  };
  positions: Array<{
    marketKey: string;
    marketTitle: string;
    image: PortfolioMarketImage;
    marketStatus: string;
    persistedMarketStatus: string;
    effectiveMarketStatus: string;
    marketCloseAt: string | null;
    expectedResolutionAt: string | null;
    outcomeKey: string;
    outcomeLabel: string;
    contractSide: "yes" | "no";
    isBinaryMarket: boolean;
    binaryComplementOutcomeKey: string | null;
    binaryComplementOutcomeLabel: string | null;
    leadingOutcomeKey?: string | null;
    leadingOutcomeLabel?: string | null;
    leadingOutcomePrice?: string | null;
    shares: string;
    costBasis: string;
    averageEntryPrice: string | null;
    currentPrice: string;
    positionValue: string;
    realizedPnl: string;
    unrealizedPnl: string;
    totalPnl: string;
    dayPnl: string;
    markAsOf: string;
  }>;
  contractPositions: Array<{
    marketKey: string;
    marketTitle: string;
    image: PortfolioMarketImage;
    marketStatus: string;
    persistedMarketStatus: string;
    effectiveMarketStatus: string;
    marketCloseAt: string | null;
    expectedResolutionAt: string | null;
    outcomeKey: string;
    outcomeLabel: string;
    contractSide: "yes" | "no";
    isBinaryMarket: boolean;
    binaryComplementOutcomeKey: string | null;
    binaryComplementOutcomeLabel: string | null;
    leadingOutcomeKey?: string | null;
    leadingOutcomeLabel?: string | null;
    leadingOutcomePrice?: string | null;
    shares: string;
    costBasis: string;
    averageEntryPrice: string | null;
    currentPrice: string;
    positionValue: string;
    realizedPnl: string;
    unrealizedPnl: string;
    totalPnl: string;
    dayPnl: string;
    markAsOf: string;
  }>;
};

type PortfolioPosition = PortfolioSnapshotResponse["positions"][number];
type PortfolioContractPosition = PortfolioSnapshotResponse["contractPositions"][number];

export class PortfolioSnapshotServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PortfolioSnapshotServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function readUserCashAccount(
  db: Queryable,
  actorId: string
): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(
    `
      select balance_cached
      from accounts
      where type = 'user_cash'
        and owner_id = $1
      limit 1
    `,
    [actorId]
  );

  return result.rows[0] ?? null;
}

async function readRealizedPnlTotal(
  db: Queryable,
  actorId: string
): Promise<string> {
  const result = await db.query<RealizedPnlRow>(
    `
      select coalesce(sum(${EFFECTIVE_REALIZED_PNL_SQL}), 0)::text as realized_pnl_total
      from realization_events re
      left join market_resolutions mr
        on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      where re.user_id = $1
    `,
    [actorId]
  );

  return quantizeMoney(result.rows[0]?.realized_pnl_total ?? "0");
}

async function readActivePositions(
  db: Queryable,
  actorId: string
): Promise<PositionSnapshotRow[]> {
  const result = await db.query<PositionSnapshotRow>(
    `
      select
        p.market_id,
        m.title as market_title,
        m.category_key,
        m.market_contract,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.close_at,
        p.outcome_id,
        o.label as outcome_label,
        counts.outcome_count,
        complement.outcome_id as complement_outcome_id,
        complement.outcome_label as complement_outcome_label,
        p.shares,
        p.cost_basis,
        p.realized_pnl,
        os.last_price as current_price,
        outcome_image.outcome_image_url,
        coalesce(
          (
            select t.price_after
            from trades t
            where t.market_id = p.market_id
              and t.outcome_id = p.outcome_id
              and t.created_at <= now() - interval '24 hours'
            order by t.created_at desc, t.id desc
            limit 1
          ),
          (
            select t.price_before
            from trades t
            where t.market_id = p.market_id
              and t.outcome_id = p.outcome_id
              and t.created_at > now() - interval '24 hours'
            order by t.created_at asc, t.id asc
            limit 1
          ),
          os.last_price
        ) as day_start_price
      from positions p
      join markets m
        on m.id = p.market_id
      join market_outcomes o
        on o.market_id = p.market_id
       and o.id = p.outcome_id
      join market_outcome_state os
        on os.market_id = p.market_id
       and os.outcome_id = p.outcome_id
      join lateral (
        select count(*)::int as outcome_count
        from market_outcomes mo
        where mo.market_id = p.market_id
      ) counts on true
      left join lateral (
        select
          mo.id as outcome_id,
          mo.label as outcome_label
        from market_outcomes mo
        where mo.market_id = p.market_id
          and mo.id <> p.outcome_id
        order by mo.sort_order
        limit 1
      ) complement on counts.outcome_count = 2
      left join lateral (
        select mo.image_url as outcome_image_url
        from market_outcomes mo
        where mo.market_id = p.market_id
          and nullif(trim(mo.image_url), '') is not null
        order by mo.sort_order
        limit 1
      ) outcome_image on true
      where p.user_id = $1
        and p.shares >= $2
        and p.settled_at is null
        and m.status not in ('resolved', 'voided')
      order by m.updated_at desc, p.updated_at desc, o.sort_order asc
    `,
    [actorId, MATERIAL_SHARES_THRESHOLD]
  );

  return result.rows.filter((row) => isMaterialShareAmount(row.shares));
}

async function readActiveContractPositions(
  db: Queryable,
  actorId: string
): Promise<ContractPositionSnapshotRow[]> {
  const result = await db.query<ContractPositionSnapshotRow>(
    `
      select
        cp.market_id,
        m.title as market_title,
        m.category_key,
        m.market_contract,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.close_at,
        cp.requested_outcome_id,
        o.label as requested_outcome_label,
        complement.outcome_id as complement_outcome_id,
        complement.outcome_label as complement_outcome_label,
        leader.outcome_id as leading_outcome_id,
        leader.outcome_label as leading_outcome_label,
        leader.price as leading_price,
        cp.contract_side,
        counts.outcome_count,
        cp.shares,
        cp.cost_basis,
        cp.realized_pnl,
        case
          when cp.contract_side = 'no' then (1 - os.last_price)
          else os.last_price
        end as current_price,
        outcome_image.outcome_image_url,
        case
          when cp.contract_side = 'no' then (1 - coalesce(
            (
              select t.price_after
              from trades t
              where t.market_id = cp.market_id
                and t.outcome_id = cp.requested_outcome_id
                and t.created_at <= now() - interval '24 hours'
              order by t.created_at desc, t.id desc
              limit 1
            ),
            (
              select t.price_before
              from trades t
              where t.market_id = cp.market_id
                and t.outcome_id = cp.requested_outcome_id
                and t.created_at > now() - interval '24 hours'
              order by t.created_at asc, t.id asc
              limit 1
            ),
            os.last_price
          ))
          else coalesce(
            (
              select t.price_after
              from trades t
              where t.market_id = cp.market_id
                and t.outcome_id = cp.requested_outcome_id
                and t.created_at <= now() - interval '24 hours'
              order by t.created_at desc, t.id desc
              limit 1
            ),
            (
              select t.price_before
              from trades t
              where t.market_id = cp.market_id
                and t.outcome_id = cp.requested_outcome_id
                and t.created_at > now() - interval '24 hours'
              order by t.created_at asc, t.id asc
              limit 1
            ),
            os.last_price
          )
        end as day_start_price
      from contract_positions cp
      join markets m
        on m.id = cp.market_id
      join market_outcomes o
        on o.market_id = cp.market_id
       and o.id = cp.requested_outcome_id
      join market_outcome_state os
        on os.market_id = cp.market_id
       and os.outcome_id = cp.requested_outcome_id
      join lateral (
        select count(*)::int as outcome_count
        from market_outcomes mo
        where mo.market_id = cp.market_id
      ) counts on true
      left join lateral (
        select
          mo.id as outcome_id,
          mo.label as outcome_label
        from market_outcomes mo
        where mo.market_id = cp.market_id
          and mo.id <> cp.requested_outcome_id
        order by mo.sort_order
        limit 1
      ) complement on counts.outcome_count = 2
      left join lateral (
        select mo.image_url as outcome_image_url
        from market_outcomes mo
        where mo.market_id = cp.market_id
          and nullif(trim(mo.image_url), '') is not null
        order by mo.sort_order
        limit 1
      ) outcome_image on true
      left join lateral (
        select mo.id as outcome_id, mo.label as outcome_label, mos.last_price as price
        from market_outcomes mo
        join market_outcome_state mos
          on mos.market_id = mo.market_id and mos.outcome_id = mo.id
        where mo.market_id = cp.market_id
        order by mos.last_price desc nulls last, mo.sort_order asc
        limit 1
      ) leader on true
      where cp.user_id = $1
        and cp.shares >= $2
        and cp.settled_at is null
        and m.status not in ('resolved', 'voided')
      order by m.updated_at desc, cp.updated_at desc, o.sort_order asc, cp.contract_side asc
    `,
    [actorId, MATERIAL_SHARES_THRESHOLD]
  );

  return result.rows.filter((row) => isMaterialShareAmount(row.shares));
}

function buildPortfolioMarketImage(
  row: Pick<
    PositionSnapshotRow | ContractPositionSnapshotRow,
    "market_contract" | "category_key" | "market_title" | "outcome_image_url"
  >
): PortfolioMarketImage {
  return buildFallbackImage(
    row.market_contract ?? null,
    row.category_key ?? null,
    row.market_title,
    row.outcome_image_url ?? null
  );
}

function buildContractPositionSnapshot(
  row: ContractPositionSnapshotRow,
  asOf: string
): PortfolioContractPosition {
  const isBinaryMarket = Number(row.outcome_count ?? 0) === 2;
  const shouldUseComplement =
    isBinaryMarket && row.contract_side === "no" && row.complement_outcome_id;
  const outcomeId = shouldUseComplement ? row.complement_outcome_id! : row.requested_outcome_id;
  const outcomeLabel = shouldUseComplement
    ? row.complement_outcome_label ?? row.requested_outcome_label
    : row.requested_outcome_label;
  const contractSide = isBinaryMarket ? "yes" : row.contract_side;
  // The OTHER side of a binary market, relative to the DISPLAYED outcome. When a
  // "no" leg was flipped to show as yes-on-complement, the other side is the
  // originally-requested outcome; otherwise it's the SQL-resolved complement.
  // Lets the UI name the leader for team-vs-team binaries (not just כן/לא).
  const complementOutcomeId = isBinaryMarket
    ? (shouldUseComplement ? row.requested_outcome_id : row.complement_outcome_id ?? null)
    : null;
  const complementOutcomeLabel = isBinaryMarket
    ? (shouldUseComplement ? row.requested_outcome_label : row.complement_outcome_label ?? null)
    : null;
  const shares = toDecimal(row.shares);
  const costBasis = toDecimal(row.cost_basis);
  const currentPrice = toDecimal(row.current_price);
  const dayStartPrice = toDecimal(row.day_start_price ?? row.current_price);
  const positionValue = shares.mul(currentPrice);
  const dayPnl = shares.mul(currentPrice.minus(dayStartPrice));
  const unrealizedPnl = positionValue.minus(costBasis);
  const realizedPnl = toDecimal(row.realized_pnl);
  const averageEntryPrice = shares.gt(0) ? costBasis.div(shares) : null;

  return {
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketTitle: row.market_title,
    image: buildPortfolioMarketImage(row),
    marketStatus: row.market_status,
    persistedMarketStatus: row.persisted_status ?? row.market_status,
    effectiveMarketStatus: row.market_status,
    marketCloseAt: row.close_at?.toISOString() ?? null,
    expectedResolutionAt: null,
    outcomeKey: resolveOutcomeKey(outcomeId) ?? outcomeId,
    outcomeLabel,
    contractSide,
    isBinaryMarket,
    binaryComplementOutcomeKey: complementOutcomeId
      ? resolveOutcomeKey(complementOutcomeId) ?? complementOutcomeId
      : null,
    binaryComplementOutcomeLabel: complementOutcomeLabel ?? null,
    // The market's current LEADER (top outcome by price) — lets the UI name
    // "where the market thinks it's going" for ANY shape, incl. multi-outcome
    // where there's no "other side" to derive (the binary complement can't help).
    leadingOutcomeKey: row.leading_outcome_id
      ? resolveOutcomeKey(row.leading_outcome_id) ?? row.leading_outcome_id
      : null,
    leadingOutcomeLabel: row.leading_outcome_label ?? null,
    leadingOutcomePrice: row.leading_price ?? null,
    shares: quantizeShares(shares),
    costBasis: quantizeMoney(costBasis),
    averageEntryPrice: averageEntryPrice ? quantizePrice(averageEntryPrice) : null,
    currentPrice: quantizePrice(currentPrice),
    positionValue: quantizeMoney(positionValue),
    realizedPnl: quantizeMoney(realizedPnl),
    unrealizedPnl: quantizeMoney(unrealizedPnl),
    totalPnl: quantizeMoney(realizedPnl.plus(unrealizedPnl)),
    dayPnl: quantizeMoney(dayPnl),
    markAsOf: asOf
  };
}

function sanitizeMultiNoContractRows(
  rows: ContractPositionSnapshotRow[]
): ContractPositionSnapshotRow[] {
  const sanitized = rows.map((row) => ({ ...row }));
  const byMarket = new Map<string, ContractPositionSnapshotRow[]>();

  for (const row of sanitized) {
    const marketRows = byMarket.get(row.market_id) ?? [];
    marketRows.push(row);
    byMarket.set(row.market_id, marketRows);
  }

  for (const marketRows of byMarket.values()) {
    const outcomeCount = Number(marketRows[0]?.outcome_count ?? 0);
    if (outcomeCount <= 2) continue;

    const complementCount = outcomeCount - 1;
    const noRows = marketRows.filter((row) => row.contract_side === "no");
    const yesRows = marketRows.filter((row) => row.contract_side === "yes");
    if (!noRows.length || !yesRows.length) continue;

    for (const noRow of noRows) {
      const shareDelta = toDecimal(noRow.shares);
      if (!isMaterialShareAmount(shareDelta)) continue;

      const costDelta = toDecimal(noRow.cost_basis).div(complementCount);
      for (const yesRow of yesRows) {
        if (yesRow.requested_outcome_id === noRow.requested_outcome_id) continue;

        const nextShares = toDecimal(yesRow.shares).minus(shareDelta);
        const nextCostBasis = toDecimal(yesRow.cost_basis).minus(costDelta);
        yesRow.shares = quantizeShares(nextShares.isNegative() ? 0 : nextShares);
        yesRow.cost_basis = quantizeMoney(nextCostBasis.isNegative() ? 0 : nextCostBasis);
      }
    }
  }

  return sanitized.filter((row) => isMaterialShareAmount(row.shares));
}

function mergeContractPositions(
  rows: ContractPositionSnapshotRow[],
  asOf: string
): PortfolioContractPosition[] {
  const merged = new Map<string, {
    base: PortfolioContractPosition;
    shares: ReturnType<typeof toDecimal>;
    costBasis: ReturnType<typeof toDecimal>;
    positionValue: ReturnType<typeof toDecimal>;
    realizedPnl: ReturnType<typeof toDecimal>;
    unrealizedPnl: ReturnType<typeof toDecimal>;
    dayPnl: ReturnType<typeof toDecimal>;
  }>();

  for (const row of rows) {
    const position = buildContractPositionSnapshot(row, asOf);
    const key = [
      position.marketKey,
      position.outcomeKey,
      position.contractSide
    ].join(":");
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        base: position,
        shares: toDecimal(position.shares),
        costBasis: toDecimal(position.costBasis),
        positionValue: toDecimal(position.positionValue),
        realizedPnl: toDecimal(position.realizedPnl),
        unrealizedPnl: toDecimal(position.unrealizedPnl),
        dayPnl: toDecimal(position.dayPnl)
      });
      continue;
    }

    existing.shares = existing.shares.plus(position.shares);
    existing.costBasis = existing.costBasis.plus(position.costBasis);
    existing.positionValue = existing.positionValue.plus(position.positionValue);
    existing.realizedPnl = existing.realizedPnl.plus(position.realizedPnl);
    existing.unrealizedPnl = existing.unrealizedPnl.plus(position.unrealizedPnl);
    existing.dayPnl = existing.dayPnl.plus(position.dayPnl);
  }

  return [...merged.values()]
    .filter((entry) => isMaterialShareAmount(entry.shares))
    .map((entry) => {
      const averageEntryPrice = entry.shares.gt(0)
        ? entry.costBasis.div(entry.shares)
        : null;

      return {
        ...entry.base,
        shares: quantizeShares(entry.shares),
        costBasis: quantizeMoney(entry.costBasis),
        averageEntryPrice: averageEntryPrice ? quantizePrice(averageEntryPrice) : null,
        positionValue: quantizeMoney(entry.positionValue),
        realizedPnl: quantizeMoney(entry.realizedPnl),
        unrealizedPnl: quantizeMoney(entry.unrealizedPnl),
        totalPnl: quantizeMoney(entry.realizedPnl.plus(entry.unrealizedPnl)),
        dayPnl: quantizeMoney(entry.dayPnl)
      };
    });
}

function buildNativePositionSnapshot(
  row: PositionSnapshotRow,
  asOf: string
): PortfolioPosition {
  const shares = toDecimal(row.shares);
  const costBasis = toDecimal(row.cost_basis);
  const currentPrice = toDecimal(row.current_price);
  const dayStartPrice = toDecimal(row.day_start_price ?? row.current_price);
  const positionValue = shares.mul(currentPrice);
  const dayPnl = shares.mul(currentPrice.minus(dayStartPrice));
  const unrealizedPnl = positionValue.minus(costBasis);
  const realizedPnl = toDecimal(row.realized_pnl);
  const averageEntryPrice = shares.gt(0) ? costBasis.div(shares) : null;

  return {
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketTitle: row.market_title,
    image: buildPortfolioMarketImage(row),
    marketStatus: row.market_status,
    persistedMarketStatus: row.persisted_status ?? row.market_status,
    effectiveMarketStatus: row.market_status,
    marketCloseAt: row.close_at?.toISOString() ?? null,
    expectedResolutionAt: null,
    outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
    outcomeLabel: row.outcome_label,
    contractSide: "yes",
    isBinaryMarket: Number(row.outcome_count ?? 0) === 2,
    binaryComplementOutcomeKey: row.complement_outcome_id
      ? resolveOutcomeKey(row.complement_outcome_id) ?? row.complement_outcome_id
      : null,
    binaryComplementOutcomeLabel: row.complement_outcome_label ?? null,
    shares: quantizeShares(shares),
    costBasis: quantizeMoney(costBasis),
    averageEntryPrice: averageEntryPrice ? quantizePrice(averageEntryPrice) : null,
    currentPrice: quantizePrice(currentPrice),
    positionValue: quantizeMoney(positionValue),
    realizedPnl: quantizeMoney(realizedPnl),
    unrealizedPnl: quantizeMoney(unrealizedPnl),
    totalPnl: quantizeMoney(realizedPnl.plus(unrealizedPnl)),
    dayPnl: quantizeMoney(dayPnl),
    markAsOf: asOf
  };
}

function contractPositionToPosition(position: PortfolioContractPosition): PortfolioPosition {
  return {
    ...position,
    binaryComplementOutcomeKey: null,
    binaryComplementOutcomeLabel: null
  };
}

export async function readPortfolioSnapshot(
  db: Queryable,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PortfolioSnapshotResponse> {
  const resolvedActor = resolvePortfolioActor(env, actor);
  const [cashAccount, realizedPnlTotal, positionRows, contractPositionRows] = await Promise.all([
    readUserCashAccount(db, resolvedActor.actorId),
    readRealizedPnlTotal(db, resolvedActor.actorId),
    readActivePositions(db, resolvedActor.actorId),
    readActiveContractPositions(db, resolvedActor.actorId)
  ]);

  if (!cashAccount) {
    throw new PortfolioSnapshotServiceError(
      401,
      "unauthorized",
      "Portfolio actor is not available."
    );
  }

  const asOf = new Date().toISOString();
  const contractPositions = mergeContractPositions(
    sanitizeMultiNoContractRows(contractPositionRows),
    asOf
  );
  const positions = contractPositions.length
    ? contractPositions.map(contractPositionToPosition)
    : positionRows.map((row) => buildNativePositionSnapshot(row, asOf));

  const availableCash = quantizeMoney(cashAccount.balance_cached);
  const portfolioValue = quantizeMoney(
    positions.reduce((sum, row) => sum.plus(row.positionValue), toDecimal(0))
  );
  const unrealizedPnl = quantizeMoney(
    positions.reduce((sum, row) => sum.plus(row.unrealizedPnl), toDecimal(0))
  );
  const totalAccountValue = quantizeMoney(toDecimal(availableCash).plus(portfolioValue));

  return {
    actorMode: resolvedActor.mode,
    asOf,
    summary: {
      availableCash,
      portfolioValue,
      totalAccountValue,
      realizedPnl: realizedPnlTotal,
      unrealizedPnl,
      openPositionsCount: positions.length
    },
    positions,
    contractPositions
  };
}
