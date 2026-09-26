import { readMarketCategoryMeta } from "../../shared/market-category";
import {
  resolveCanonicalMarketKeyById,
  resolveOutcomeKey
} from "../../shared/market-identity";
import {
  buildMarketLifecycle,
  buildPublicMarketContract
} from "../../shared/market-truth";
import { findTeamBrandByLabel } from "../../shared/market-visual-registry";
import {
  publicizeResolutionSourceText,
  readPublicResolutionSourceUrl,
  stripResolutionSourceUrl
} from "../../shared/public-source";
import {
  formatCloseLabel,
  formatProbabilityLabel,
  formatUpdatedLabel,
  formatVolumeLabel,
  quantizeProbability
} from "./formatters";
import { buildFallbackImage } from "./image";
import { buildDiscoverySignals } from "./signals";
import type {
  DiscoveryFeedItem,
  DiscoveryMarketShape,
  DiscoveryOutcomeRole,
  DiscoveryFeedRow,
  DiscoveryMovementRow,
  DiscoverySportsGame,
  DiscoverySportsTeam,
  DiscoveryViewerPositionRow
} from "./types";

type DiscoveryOutcomeSummary = DiscoveryFeedItem["outcomes"][number];
type DiscoveryViewerPosition = NonNullable<DiscoveryFeedItem["viewerPosition"]>;
type DiscoveryMovement = NonNullable<DiscoveryFeedItem["movement"]>;

function buildWinner(row: DiscoveryFeedRow) {
  if (!row.winning_outcome_id || !row.winning_outcome_label) {
    return null;
  }

  return {
    outcomeId: row.winning_outcome_id,
    outcomeKey:
      resolveOutcomeKey(row.winning_outcome_id) ?? row.winning_outcome_id,
    label: row.winning_outcome_label
  };
}

function buildResult(row: DiscoveryFeedRow) {
  const resolvedAt = row.market_resolved_at ?? row.resolution_resolved_at ?? null;

  return {
    status: row.market_status,
    settlementStatus: row.settlement_status ?? null,
    resolvedAt: resolvedAt?.toISOString() ?? null,
    winner: buildWinner(row),
    source: {
      label: stripResolutionSourceUrl(row.resolution_source),
      url: readPublicResolutionSourceUrl(row.resolution_source, row.resolution_source_url),
      rules: publicizeResolutionSourceText(row.resolution_rules),
      explanation: row.resolution_note?.trim() || null
    }
  };
}

function buildTrust(row: DiscoveryFeedRow): DiscoveryFeedItem["trust"] {
  const resolutionSource = row.resolution_source?.trim() || null;
  const resolutionRules = row.resolution_rules?.trim() || null;
  const contract = buildPublicMarketContract(row.market_contract);

  if (!resolutionSource && !resolutionRules && !contract) {
    return undefined;
  }

  return {
    resolutionSource: stripResolutionSourceUrl(resolutionSource),
    sourceUrl: readPublicResolutionSourceUrl(resolutionSource, row.resolution_source_url),
    resolutionRules: publicizeResolutionSourceText(resolutionRules),
    contract
  };
}

function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object" || !(field in value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

function readStringArrayField(value: unknown, field: string): string[] {
  if (!value || typeof value !== "object" || !(field in value)) {
    return [];
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return Array.isArray(fieldValue)
    ? fieldValue.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readContractSourceIds(contract: unknown): string[] {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return [];
  }

  const source = (contract as Record<string, unknown>).resolutionSource;
  return readStringArrayField(source, "sourceIds");
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isYesLabel(value: string): boolean {
  return ["yes", "כן"].includes(value);
}

function isNoLabel(value: string): boolean {
  return ["no", "לא"].includes(value);
}

function isDrawLabel(value: string): boolean {
  return value === "draw" || value === "tie" || value.includes("תיקו");
}

function isUpLabel(value: string): boolean {
  return (
    value.includes("up") ||
    value.includes("over") ||
    value.includes("above") ||
    value.includes("מעל") ||
    value.includes("יעלה") ||
    value.includes("עלייה")
  );
}

function isDownLabel(value: string): boolean {
  return (
    value.includes("down") ||
    value.includes("under") ||
    value.includes("below") ||
    value.includes("מתחת") ||
    value.includes("ירד") ||
    value.includes("ירידה")
  );
}

function outcomeLabel(row: DiscoveryFeedRow): string {
  return normalizeLabel(row.outcome_short_label ?? row.outcome_label);
}

function isYesNoMarket(rows: DiscoveryFeedRow[]): boolean {
  if (rows.length !== 2) {
    return false;
  }

  const labels = rows.map(outcomeLabel);
  return labels.some(isYesLabel) && labels.some(isNoLabel);
}

function isLiveDirectionMarket(rows: DiscoveryFeedRow[], firstRow: DiscoveryFeedRow): boolean {
  // resultShape is the shape of the RESULT — the right field to drive the card.
  // measurementKind describes WHAT is measured, not how the market resolves: a
  // Bank-of-Israel rate-decision market has measurementKind "rate_direction"
  // (we measure which way the rate moved) but resultShape "yes_no" — it's a
  // plain binary that closes months out, not a live-ticking direction market.
  // Matching measurementKind for the substring "direction"/"live" wrongly gave
  // that market the live card. Only a genuine direction resultShape (or an
  // up/down crypto market) earns the live shape.
  const resultShape = normalizeLabel(readStringField(firstRow.market_contract, "resultShape"));

  if (resultShape.includes("direction") || resultShape.includes("up_down")) {
    return true;
  }

  if (rows.length !== 2) {
    return false;
  }

  const labels = rows.map(outcomeLabel);
  return labels.some(isUpLabel) && labels.some(isDownLabel) && firstRow.category_key === "crypto";
}

function classifyMarketShape(rows: DiscoveryFeedRow[], firstRow: DiscoveryFeedRow): DiscoveryMarketShape {
  const sortedRows = [...rows].sort((left, right) => left.sort_order - right.sort_order);

  if (isLiveDirectionMarket(sortedRows, firstRow)) {
    return "live";
  }

  if (firstRow.category_key === "sports" && sortedRows.length >= 2 && sortedRows.length <= 3) {
    return "matchup";
  }

  if (sortedRows.length === 3 && sortedRows.some((row) => isDrawLabel(outcomeLabel(row)))) {
    return "matchup";
  }

  if (isYesNoMarket(sortedRows)) {
    return "binary";
  }

  if (sortedRows.length === 2) {
    return "binary";
  }

  return "multi";
}

function resolveBinaryRole(row: DiscoveryFeedRow): DiscoveryOutcomeRole | null {
  const label = outcomeLabel(row);

  if (isYesLabel(label)) {
    return "yes";
  }

  if (isNoLabel(label)) {
    return "no";
  }

  return null;
}

function resolveLiveRole(row: DiscoveryFeedRow): DiscoveryOutcomeRole | null {
  const label = outcomeLabel(row);

  if (isUpLabel(label)) {
    return "up";
  }

  if (isDownLabel(label)) {
    return "down";
  }

  return row.sort_order === 0 ? "up" : "down";
}

function buildRoleResolver(
  rows: DiscoveryFeedRow[],
  shape: DiscoveryMarketShape
): (row: DiscoveryFeedRow) => DiscoveryOutcomeRole | null {
  if (shape === "binary") {
    return resolveBinaryRole;
  }

  if (shape === "live") {
    return resolveLiveRole;
  }

  if (shape !== "matchup") {
    return () => null;
  }

  const sideRows = [...rows]
    .sort((left, right) => left.sort_order - right.sort_order)
    .filter((row) => !isDrawLabel(outcomeLabel(row)));
  const sideARow = sideRows[0] ?? null;
  const sideBRow = sideRows[1] ?? null;

  return (row) => {
    if (isDrawLabel(outcomeLabel(row))) {
      return "draw";
    }

    if (row.outcome_id === sideARow?.outcome_id) {
      return "side_a";
    }

    if (row.outcome_id === sideBRow?.outcome_id) {
      return "side_b";
    }

    return null;
  };
}

function buildOutcomeSummary(
  row: DiscoveryFeedRow,
  role: DiscoveryOutcomeRole | null
): DiscoveryOutcomeSummary {
  return {
    outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
    label: row.outcome_short_label ?? row.outcome_label,
    probability: quantizeProbability(row.last_price),
    displayProbability: formatProbabilityLabel(row.last_price),
    role
  };
}

// Hydrate team brands for a matchup card. home = side_a, away = side_b; each
// side resolves its team by outcome label against the registry. Returns null
// for non-matchup shapes and for matchups where neither side is a seeded team
// (goal-range markets, NBA, unseeded clubs) — the card then keeps its default
// gold/blue side colors. A partially-resolved match (one side known) still
// ships, so a seeded team lights up even against an unseeded opponent.
function buildSportsTeams(
  shape: DiscoveryMarketShape,
  rows: DiscoveryFeedRow[],
  resolveRole: (row: DiscoveryFeedRow) => DiscoveryOutcomeRole | null,
  sportKey: string | null,
  leagueKey: string | null
): DiscoveryFeedItem["sportsTeams"] {
  if (shape !== "matchup") {
    return null;
  }

  const toTeam = (role: DiscoveryOutcomeRole): DiscoverySportsTeam | null => {
    const row = [...rows]
      .sort((left, right) => left.sort_order - right.sort_order)
      .find((candidate) => resolveRole(candidate) === role);

    if (!row) {
      return null;
    }

    // Sport-aware so a club that fields both teams (e.g. Maccabi TA) resolves
    // to the right crest — football shirt vs basketball singlet.
    const brand =
      findTeamBrandByLabel(row.outcome_label, sportKey, leagueKey) ??
      findTeamBrandByLabel(row.outcome_short_label ?? "", sportKey, leagueKey);

    if (!brand) {
      return null;
    }

    return {
      outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
      displayName: brand.displayName,
      shortName: brand.shortName,
      colorPrimary: brand.colorPrimary,
      colorOn: brand.colorOn,
      crestLabel: brand.crestLabel,
      colorSecondary: brand.colorSecondary,
      crestPath: brand.crestPath
    };
  };

  const home = toTeam("side_a");
  const away = toTeam("side_b");

  // Ship team brands only when BOTH sides resolve. A half-resolved matchup (one
  // seeded club, one unseeded) would render a half-colored card — but the
  // gold/blue default card already covers "we don't have the teams", so a
  // partial is never worth it. Both-or-nothing.
  if (!home || !away) {
    return null;
  }

  return { home, away };
}

function readSportsLeague(sourceIds: string[]): DiscoverySportsGame["league"] {
  if (sourceIds.includes("src_ifa_fixtures_results")) {
    return { key: "israeli-football", label: "כדורגל ישראלי" };
  }

  if (sourceIds.includes("src_winner_league_basketball")) {
    return { key: "winner-league", label: "ליגת Winner סל" };
  }

  if (sourceIds.includes("src_ibba_schedules")) {
    return { key: "ibba", label: "איגוד הכדורסל" };
  }

  if (sourceIds.includes("src_fiba_basketball_games")) {
    return { key: "fiba", label: "FIBA" };
  }

  if (sourceIds.includes("src_nba_official_games")) {
    return { key: "nba", label: "NBA" };
  }

  if (sourceIds.includes("src_wimbledon_official")) {
    return { key: "wimbledon", label: "ווימבלדון" };
  }

  return null;
}

function readSportsSport(sourceIds: string[], resultShape: string | null): DiscoverySportsGame["sport"] {
  if (
    sourceIds.includes("src_ifa_fixtures_results") ||
    sourceIds.includes("src_fifa_match_centre") ||
    resultShape === "three_way_result"
  ) {
    return { key: "football", label: "כדורגל" };
  }

  if (
    sourceIds.includes("src_winner_league_basketball") ||
    sourceIds.includes("src_ibba_schedules") ||
    sourceIds.includes("src_fiba_basketball_games") ||
    sourceIds.includes("src_nba_official_games")
  ) {
    return { key: "basketball", label: "כדורסל" };
  }

  if (sourceIds.includes("src_wimbledon_official")) {
    return { key: "tennis", label: "טניס" };
  }

  return null;
}

function buildSportsGame(
  shape: DiscoveryMarketShape,
  rows: DiscoveryFeedRow[],
  firstRow: DiscoveryFeedRow
): DiscoverySportsGame | null {
  if (firstRow.category_key !== "sports") {
    return null;
  }

  const sourceIds = readContractSourceIds(firstRow.market_contract);
  const resultShape = readStringField(firstRow.market_contract, "resultShape");
  const sortedRows = [...rows].sort((left, right) => left.sort_order - right.sort_order);
  const hasDraw = sortedRows.some((row) => isDrawLabel(outcomeLabel(row)));
  const matchupKind = hasDraw ? "three_way" : sortedRows.length === 2 ? "two_way" : "unknown";

  return {
    sport: readSportsSport(sourceIds, resultShape),
    league: readSportsLeague(sourceIds),
    sourceIds,
    resultShape,
    matchupKind,
    hasDraw
  };
}

function formatPnlLabel(value: number): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `V₪ ${sign}${rounded}`;
}

function oppositeRole(role: DiscoveryOutcomeRole | null): DiscoveryOutcomeRole | null {
  if (role === "yes") {
    return "no";
  }

  if (role === "no") {
    return "yes";
  }

  if (role === "up") {
    return "down";
  }

  if (role === "down") {
    return "up";
  }

  return null;
}

function resolveViewerPositionSide(
  position: DiscoveryViewerPositionRow,
  outcome: DiscoveryOutcomeSummary | null,
  shape: DiscoveryMarketShape
): string {
  if (position.contract_side === "yes") {
    return outcome?.role ?? outcome?.outcomeKey ?? position.outcome_id;
  }

  const inverseRole = shape === "binary" || shape === "live"
    ? oppositeRole(outcome?.role ?? null)
    : null;

  return inverseRole ?? outcome?.outcomeKey ?? position.outcome_id;
}

function buildViewerPosition(
  position: DiscoveryViewerPositionRow | null,
  outcomes: DiscoveryOutcomeSummary[],
  shape: DiscoveryMarketShape
): DiscoveryViewerPosition | null {
  if (!position) {
    return null;
  }

  const outcomeKey = resolveOutcomeKey(position.outcome_id) ?? position.outcome_id;
  const outcome = outcomes.find((candidate) => candidate.outcomeKey === outcomeKey) ?? null;
  const shares = Number(position.shares);
  const costBasis = Number(position.cost_basis);
  const currentPrice = Number(position.current_price);
  const averageCost = shares > 0 ? costBasis / shares : 0;
  const pnl = shares * currentPrice - costBasis;

  return {
    side: resolveViewerPositionSide(position, outcome, shape),
    shares: Number.isFinite(shares) ? shares : 0,
    averageCost: Number.isFinite(averageCost) ? averageCost : 0,
    pnlLabel: formatPnlLabel(pnl),
    outcomeKey,
    contractSide: position.contract_side
  };
}

function readMovementPercent(value: string): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric * 100);
}

function buildMovement(
  movementRow: DiscoveryMovementRow | null | undefined
): DiscoveryMovement | null {
  if (!movementRow) {
    return null;
  }

  return {
    outcomeKey: resolveOutcomeKey(movementRow.outcome_id) ?? movementRow.outcome_id,
    window: movementRow.window_key,
    fromProbability: quantizeProbability(movementRow.from_price),
    toProbability: quantizeProbability(movementRow.to_price),
    deltaPercent: readMovementPercent(movementRow.delta),
    absDeltaPercent: readMovementPercent(movementRow.abs_delta),
    tradeCount: Number(movementRow.trade_count) || 0,
    volume: {
      value: movementRow.trade_volume,
      label: formatVolumeLabel(movementRow.trade_volume)
    }
  };
}

function buildPublicMarketPath(
  marketKey: string,
  eventSlug?: string | null,
  parentKey?: string | null,
  focusMarketKey?: string | null
): string {
  const slug = eventSlug?.trim();

  if (focusMarketKey) {
    return `/markets/${encodeURIComponent(focusMarketKey)}?focus=1`;
  }

  if (slug) {
    return `/event/${encodeURIComponent(slug)}`;
  }

  return `/markets/${encodeURIComponent(parentKey || marketKey)}`;
}

function buildEventMetadata(
  rows: DiscoveryFeedRow[],
  representativeMarketKey: string
): DiscoveryFeedItem["event"] {
  const eventKey = rows[0]?.event_id?.trim();
  const eventSlug = rows[0]?.event_slug?.trim() || null;
  const isEventGroupCard =
    Boolean(eventKey) &&
    rows.length > 1 &&
    rows.every((row) => row.discovery_shape === "multi");

  if (!eventKey || !isEventGroupCard) {
    return null;
  }

  return {
    eventKey,
    eventSlug,
    publicPath: eventSlug ? `/event/${encodeURIComponent(eventSlug)}` : null,
    parentKey: eventKey,
    representativeMarketKey,
    childMarketKeys: rows.map((row) => resolveCanonicalMarketKeyById(row.outcome_id) ?? row.outcome_id)
  };
}

export function buildFeedItem(
  rows: DiscoveryFeedRow[],
  viewerPositionRow?: DiscoveryViewerPositionRow | null,
  options?: {
    hotRank?: number | null;
    movementRow?: DiscoveryMovementRow | null;
  }
): DiscoveryFeedItem | null {
  const [firstRow] = rows;

  if (!firstRow) {
    return null;
  }

  const categoryMeta = readMarketCategoryMeta(firstRow.category_key);
  const shape = firstRow.discovery_shape ?? classifyMarketShape(rows, firstRow);
  const resolveRole = buildRoleResolver(rows, shape);
  const outcomes = [...rows]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((row) => buildOutcomeSummary(row, resolveRole(row)));
  const outcomeByKey = new Map(outcomes.map((outcome) => [outcome.outcomeKey, outcome]));
  const topOutcomes = [...rows]
    .sort((left, right) => Number(right.last_price) - Number(left.last_price))
    .slice(0, 4)
    .map((row) => {
      const outcomeKey = resolveOutcomeKey(row.outcome_id) ?? row.outcome_id;
      return outcomeByKey.get(outcomeKey) ?? buildOutcomeSummary(row, resolveRole(row));
    });
  const movement = buildMovement(options?.movementRow ?? null);
  const sportsGame = buildSportsGame(shape, rows, firstRow);
  const marketKey = resolveCanonicalMarketKeyById(firstRow.market_id) ?? firstRow.market_id;
  const event = buildEventMetadata(rows, marketKey);

  return {
    feedKey: event ? `event:${event.eventKey}` : marketKey,
    marketKey,
    href: buildPublicMarketPath(
      marketKey,
      firstRow.event_slug,
      event?.parentKey,
      firstRow.discovery_event_child_card ? marketKey : null
    ),
    event,
    isEventChildCard: firstRow.discovery_event_child_card === true,
    marketStatus: firstRow.market_status,
    shape,
    title: firstRow.title,
    description: firstRow.description,
    category: {
      key: categoryMeta?.frontendKey ?? firstRow.category_key,
      label: categoryMeta?.label ?? "שווקים"
    },
    closeAt: firstRow.close_at.toISOString(),
    closeLabel: formatCloseLabel(firstRow.close_at),
    updatedAt: firstRow.updated_at.toISOString(),
    updatedLabel: formatUpdatedLabel(firstRow.updated_at),
    publishedAt: firstRow.published_at?.toISOString() ?? null,
    settlementStatus: firstRow.settlement_status ?? null,
    resolvedAt: firstRow.market_resolved_at?.toISOString() ?? null,
    lifecycle: buildMarketLifecycle(firstRow),
    winner: buildWinner(firstRow),
    result: buildResult(firstRow),
    trust: buildTrust(firstRow),
    image: buildFallbackImage(
      firstRow.market_contract,
      firstRow.category_key,
      firstRow.title,
      rows.find((row) => row.outcome_image_url)?.outcome_image_url ?? null,
      event ? { src: firstRow.event_icon, alt: firstRow.event_title ?? firstRow.title } : null
    ),
    sportsTeams: buildSportsTeams(
      shape,
      rows,
      resolveRole,
      sportsGame?.sport?.key ?? null,
      sportsGame?.league?.key ?? null
    ),
    sports: sportsGame,
    volume: {
      value: firstRow.total_volume,
      label: formatVolumeLabel(firstRow.total_volume)
    },
    activity: {
      recentTradeCount: Number(firstRow.recent_trade_count ?? 0) || 0,
      recentTradeVolume: {
        value: firstRow.recent_trade_volume ?? "0",
        label: formatVolumeLabel(firstRow.recent_trade_volume ?? "0")
      }
    },
    viewerPosition: buildViewerPosition(viewerPositionRow ?? null, outcomes, shape),
    movement,
    outcomes,
    preview: {
      marketType: shape === "binary" || shape === "live" ? "binary" : "multi_outcome",
      topOutcomes
    },
    signals: buildDiscoverySignals(firstRow, {
      hotRank: options?.hotRank ? { rank: options.hotRank } : null,
      movement
    })
  };
}
