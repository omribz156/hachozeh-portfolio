import { quantizeMoney, quantizePrice, quantizeShares, toDecimal } from "../../shared/decimals";
import {
  buildMarketLifecycle,
  buildPublicMarketContract
} from "../../shared/market-truth";
import {
  publicizeResolutionSourceText,
  readPublicResolutionSourceUrl,
  stripResolutionSourceUrl
} from "../../shared/public-source";
import {
  readCategory,
  readMarketKey,
  readOutcomeKey
} from "./identity";
export { readExecutionLegs } from "../../shared/execution-legs";
import { resolvePublicDisplayName } from "../../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../../shared/public-avatar-url";
import { formatPublicVolumeLabel } from "../../shared/public-volume";
import type {
  MarketApiRow,
  MarketCommunityBoardEntry,
  MarketPositionRow
} from "./types";

function buildPrices(rows: MarketApiRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((row) => [readOutcomeKey(row.outcome_id), row.last_price])
  );
}

function buildPublicWinner(row: MarketApiRow) {
  if (row.market_status !== "resolved" || !row.winning_outcome_id || !row.winning_outcome_label) {
    return null;
  }

  return {
    outcomeId: row.winning_outcome_id,
    outcomeKey: readOutcomeKey(row.winning_outcome_id),
    label: row.winning_outcome_label
  };
}

function readContractResolutionSourceUrl(contract: unknown): string | null {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return null;
  }

  const source = (contract as Record<string, unknown>).resolutionSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const url = (source as Record<string, unknown>).url;
  return typeof url === "string" ? readPublicResolutionSourceUrl(null, url) : null;
}

function readContractResolutionSourceLabel(contract: unknown): string | null {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return null;
  }

  const source = (contract as Record<string, unknown>).resolutionSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const label = (source as Record<string, unknown>).label;
  return typeof label === "string" && label.trim().length > 0 ? label.trim() : null;
}

function buildPublicResult(row: MarketApiRow) {
  const isResolved = row.market_status === "resolved";
  const resolvedAt = isResolved ? row.market_resolved_at ?? row.resolution_resolved_at ?? null : null;
  const contract = buildPublicMarketContract(row.market_contract);
  const sourceUrl =
    readPublicResolutionSourceUrl(row.resolution_source, row.resolution_source_url) ??
    readContractResolutionSourceUrl(contract);

  return {
    status: row.market_status,
    settlementStatus: isResolved ? row.settlement_status ?? null : null,
    resolvedAt: resolvedAt?.toISOString() ?? null,
    winner: buildPublicWinner(row),
    source: {
      label:
        readContractResolutionSourceLabel(contract) ??
        stripResolutionSourceUrl(row.resolution_source),
      url: sourceUrl,
      rules: publicizeResolutionSourceText(row.resolution_rules),
      explanation: row.resolution_note?.trim() || null
    }
  };
}

function buildPublicTrust(row: MarketApiRow) {
  const resolutionSource = row.resolution_source?.trim() || null;
  const resolutionRules = row.resolution_rules?.trim() || null;
  const contract = buildPublicMarketContract(row.market_contract);
  const sourceUrl =
    readPublicResolutionSourceUrl(resolutionSource, row.resolution_source_url) ??
    readContractResolutionSourceUrl(contract);

  if (!resolutionSource && !resolutionRules && !contract) {
    return undefined;
  }

  return {
    resolutionSource:
      readContractResolutionSourceLabel(contract) ??
      stripResolutionSourceUrl(resolutionSource),
    sourceUrl,
    resolutionRules: publicizeResolutionSourceText(resolutionRules),
    contract
  };
}

function buildPublicMarketPath(row: MarketApiRow): string {
  const eventSlug = row.event_slug?.trim();

  if (eventSlug) {
    return `/event/${encodeURIComponent(eventSlug)}`;
  }

  return `/markets/${encodeURIComponent(readMarketKey(row.market_id))}`;
}

export function groupRowsByMarket(rows: MarketApiRow[]): MarketApiRow[][] {
  const groupedRows = new Map<string, MarketApiRow[]>();

  for (const row of rows) {
    const existingRows = groupedRows.get(row.market_id);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    groupedRows.set(row.market_id, [row]);
  }

  return [...groupedRows.values()];
}

export function buildOutcomes(rows: MarketApiRow[]) {
  const [firstRow] = rows;
  const winningOutcomeId = firstRow?.winning_outcome_id ?? null;
  const shouldExposeFinalValue = firstRow?.market_status === "resolved" && Boolean(winningOutcomeId);

  return rows
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((row) => ({
      outcomeKey: readOutcomeKey(row.outcome_id),
      outcomeId: row.outcome_id,
      label: row.outcome_label,
      shortLabel: row.outcome_short_label ?? row.outcome_label,
      sortOrder: row.sort_order,
      lastPrice: row.last_price,
      isWinner: row.winning_outcome_id ? row.outcome_id === row.winning_outcome_id : null,
      ...(shouldExposeFinalValue
        ? { finalValue: row.outcome_id === winningOutcomeId ? 1 : 0 }
        : {}),
      qShares: row.q_shares ?? null
    }));
}

export function buildMarketSummary(rows: MarketApiRow[]) {
  const [firstRow] = rows;

  if (!firstRow) {
    return null;
  }

  return {
    marketKey: readMarketKey(firstRow.market_id),
    marketId: firstRow.market_id,
    eventKey: firstRow.event_id ?? null,
    eventSlug: firstRow.event_slug ?? null,
    publicPath: buildPublicMarketPath(firstRow),
    marketStatus: firstRow.market_status,
    settlementStatus: firstRow.market_status === "resolved" ? firstRow.settlement_status ?? null : null,
    resolvedAt: firstRow.market_status === "resolved" ? firstRow.market_resolved_at?.toISOString() ?? null : null,
    winner: buildPublicWinner(firstRow),
    result: buildPublicResult(firstRow),
    lifecycle: buildMarketLifecycle(firstRow),
    trust: buildPublicTrust(firstRow),
    title: firstRow.title,
    description: firstRow.description,
    category: readCategory(firstRow.category_key),
    openAt: firstRow.open_at.toISOString(),
    closeAt: firstRow.close_at.toISOString(),
    publishedAt: firstRow.published_at?.toISOString() ?? null,
    updatedAt: firstRow.updated_at.toISOString(),
    marketStateVersion: Number(firstRow.market_state_version),
    outcomeCount: firstRow.outcome_count,
    volume: {
      value: firstRow.total_volume,
      label: formatPublicVolumeLabel(firstRow.total_volume)
    },
    prices: buildPrices(rows)
  };
}

export function buildMarketDetail(rows: MarketApiRow[]) {
  const summary = buildMarketSummary(rows);
  const [firstRow] = rows;

  if (!summary || !firstRow) {
    return null;
  }

  return {
    ...summary,
    liquidityB: firstRow.liquidity_b ?? null,
    orderModel: "immediate_execution",
    outcomes: buildOutcomes(rows)
  };
}

export function buildEmptyCommunityBoard(
  outcomes: ReturnType<typeof buildOutcomes>
): Record<string, MarketCommunityBoardEntry> {
  return Object.fromEntries(
    outcomes.map((outcome) => [outcome.outcomeKey, { yes: [], no: [] }])
  );
}

export function buildPublicUserLabel(fallbackLabel: string): string {
  return fallbackLabel.trim().slice(0, 40) || "סוחר";
}

export function buildAvatarLabel(userLabel: string): string {
  return userLabel.trim().slice(0, 1).toUpperCase() || "ס";
}

export function buildPublicUserIdentity(
  row: {
    user_id?: string | null;
    user_handle?: string | null;
    user_display_name?: string | null;
    user_avatar_url?: string | null;
  },
  fallbackLabel: string
) {
  const userLabel = buildPublicUserLabel(
    (row.user_id ? resolvePublicDisplayName(row.user_id, row.user_display_name, row.user_handle) : row.user_display_name?.trim()) ||
    row.user_handle?.trim() ||
    fallbackLabel
  );
  const userHandle = row.user_handle?.trim() || null;

  return {
    userLabel,
    userHandle,
    avatarLabel: buildAvatarLabel(userLabel),
    avatarUrl: sanitizePublicAvatarUrl(row.user_avatar_url)
  };
}

export function buildPositionEntry(
  row: MarketPositionRow,
  userIdentity: ReturnType<typeof buildPublicUserIdentity>,
  rank: number
) {
  const isBinaryMarket = Number(row.outcome_count ?? 0) === 2;
  const shouldUseComplement =
    isBinaryMarket && row.contract_side === "no" && row.complement_outcome_id;
  const outcomeId = shouldUseComplement ? row.complement_outcome_id! : row.outcome_id;
  const outcomeLabel = shouldUseComplement
    ? row.complement_outcome_label ?? row.outcome_label
    : row.outcome_label;
  const contractSide = isBinaryMarket ? "yes" : row.contract_side;
  const shares = toDecimal(row.shares);
  const costBasis = toDecimal(row.cost_basis);
  const currentPrice = toDecimal(row.current_price);
  const realizedPnl = toDecimal(row.realized_pnl);
  const positionValue = shares.mul(currentPrice);
  const unrealizedPnl = positionValue.minus(costBasis);
  const averageCost = shares.gt(0) ? costBasis.div(shares) : null;

  return {
    userId: row.user_id,
    userLabel: userIdentity.userLabel,
    userHandle: userIdentity.userHandle,
    avatarLabel: userIdentity.avatarLabel,
    avatarUrl: userIdentity.avatarUrl,
    avatarTone: ["blue", "orange", "pink", "green"][rank % 4],
    contractSide,
    outcomeKey: readOutcomeKey(outcomeId),
    outcomeId,
    outcomeLabel,
    shares: quantizeShares(shares),
    averageCost: averageCost ? quantizePrice(averageCost) : null,
    currentPrice: quantizePrice(currentPrice),
    positionValue: quantizeMoney(positionValue),
    realizedPnl: quantizeMoney(realizedPnl),
    unrealizedPnl: quantizeMoney(unrealizedPnl),
    pnl: quantizeMoney(realizedPnl.plus(unrealizedPnl))
  };
}

type MarketPositionEntry = ReturnType<typeof buildPositionEntry>;

export function mergePositionEntries(entries: MarketPositionEntry[]): MarketPositionEntry[] {
  const merged = new Map<string, {
    base: MarketPositionEntry;
    shares: ReturnType<typeof toDecimal>;
    costBasis: ReturnType<typeof toDecimal>;
    positionValue: ReturnType<typeof toDecimal>;
    realizedPnl: ReturnType<typeof toDecimal>;
    unrealizedPnl: ReturnType<typeof toDecimal>;
  }>();

  for (const entry of entries) {
    const key = [entry.userId, entry.outcomeId, entry.contractSide].join(":");
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        base: entry,
        shares: toDecimal(entry.shares),
        costBasis: toDecimal(entry.positionValue).minus(entry.unrealizedPnl),
        positionValue: toDecimal(entry.positionValue),
        realizedPnl: toDecimal(entry.realizedPnl),
        unrealizedPnl: toDecimal(entry.unrealizedPnl)
      });
      continue;
    }

    existing.shares = existing.shares.plus(entry.shares);
    existing.positionValue = existing.positionValue.plus(entry.positionValue);
    existing.realizedPnl = existing.realizedPnl.plus(entry.realizedPnl);
    existing.unrealizedPnl = existing.unrealizedPnl.plus(entry.unrealizedPnl);
    existing.costBasis = existing.costBasis.plus(
      toDecimal(entry.positionValue).minus(entry.unrealizedPnl)
    );
  }

  return [...merged.values()].map((entry) => {
    const averageCost = entry.shares.gt(0) ? entry.costBasis.div(entry.shares) : null;

    return {
      ...entry.base,
      shares: quantizeShares(entry.shares),
      averageCost: averageCost ? quantizePrice(averageCost) : null,
      positionValue: quantizeMoney(entry.positionValue),
      realizedPnl: quantizeMoney(entry.realizedPnl),
      unrealizedPnl: quantizeMoney(entry.unrealizedPnl),
      pnl: quantizeMoney(entry.realizedPnl.plus(entry.unrealizedPnl))
    };
  });
}
