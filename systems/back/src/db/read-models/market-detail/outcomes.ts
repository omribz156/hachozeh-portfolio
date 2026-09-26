import type {
  MarketDetailOutcome
} from "../../../http/routes/market-detail-fixtures";
import { findTeamBrandByLabel } from "../../../shared/market-visual-registry";
import { resolvePassiveOutcomeKey } from "./identity";
import type { MarketDetailRow } from "./types";

const TIE_OUTCOME_COLOR = {
  colorPrimary: "#94A3B8",
  colorOn: "#0F172A"
};

export function buildCurrentPrices(rows: MarketDetailRow[]): Record<string, number> {
  return Object.fromEntries(
    rows
      .map((row) => [resolvePassiveOutcomeKey(row.outcome_id), Number(row.last_price)])
      .filter((entry): entry is [string, number] => Boolean(entry[0]))
  );
}

export function buildOutcomes(rows: MarketDetailRow[]): MarketDetailOutcome[] {
  const [firstRow] = rows;
  const winningOutcomeId = firstRow?.winning_outcome_id ?? null;
  const shouldExposeFinalValue = firstRow?.market_status === "resolved" && Boolean(winningOutcomeId);
  const sportsContext = readSportsContext(firstRow);

  return rows
    .map((row) => {
      const outcomeKey = resolvePassiveOutcomeKey(row.outcome_id);
      const label = normalizeOutcomeLabel(row.label);
      const shortLabel = normalizeOutcomeLabel(row.short_label ?? row.label);
      const outcomeColor = sportsContext
        ? resolveSportsOutcomeColor(label, shortLabel, sportsContext.sport, sportsContext.league)
        : null;

      return {
        id: outcomeKey,
        key: outcomeKey,
        label,
        shortLabel,
        ...(outcomeColor ?? {}),
        ...(shouldExposeFinalValue
          ? { finalValue: row.outcome_id === winningOutcomeId ? 1 : 0 }
          : {})
      } satisfies MarketDetailOutcome;
    })
    .filter((outcome): outcome is MarketDetailOutcome => Boolean(outcome));
}

function normalizeOutcomeLabel(value: string): string {
  return value
    .replace(/^ירידה\s+(?!של(?:\s|$))/, "ירידה של ")
    .replace(/^עלייה\s+(?!של(?:\s|$))/, "עלייה של ")
    .replace(/של\s+של/g, "של")
    .replace(/של\s+\+([\d.]+%)/g, "של $1+");
}

function isTieOutcomeLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized === "תיקו" || normalized === "draw" || normalized === "tie";
}

function resolveSportsOutcomeColor(
  label: string,
  shortLabel: string,
  sport: string | null,
  league: string | null
): { colorPrimary: string; colorOn: string; crestPath?: string } | null {
  if (isTieOutcomeLabel(label) || isTieOutcomeLabel(shortLabel)) {
    return TIE_OUTCOME_COLOR;
  }

  const teamBrand =
    findTeamBrandByLabel(label, sport, league) ??
    findTeamBrandByLabel(shortLabel, sport, league);

  return teamBrand
    ? {
        colorPrimary: teamBrand.colorPrimary,
        colorOn: teamBrand.colorOn,
        // Surface the flag/crest the registry already holds so market-detail
        // outcome rows can show it (the feed/cards already do via sportsTeams).
        ...(teamBrand.crestPath ? { crestPath: teamBrand.crestPath } : {})
      }
    : null;
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

function readSportsContext(row: MarketDetailRow | undefined): { sport: string | null; league: string | null } | null {
  if (!row) {
    return null;
  }

  const sourceIds = readContractSourceIds(row.market_contract);
  const resultShape = readStringField(row.market_contract, "resultShape");
  const sport =
    sourceIds.includes("src_ifa_fixtures_results") ||
    sourceIds.includes("src_fifa_match_centre") ||
    resultShape === "three_way_result"
      ? "football"
      : sourceIds.includes("src_winner_league_basketball") ||
          sourceIds.includes("src_ibba_schedules") ||
          sourceIds.includes("src_fiba_basketball_games") ||
          sourceIds.includes("src_nba_official_games")
        ? "basketball"
        : sourceIds.includes("src_wimbledon_official")
          ? "tennis"
        : null;
  const league =
    sourceIds.includes("src_ifa_fixtures_results")
      ? "israeli-football"
      : sourceIds.includes("src_winner_league_basketball")
        ? "winner-league"
        : sourceIds.includes("src_fiba_basketball_games")
          ? "fiba"
        : sourceIds.includes("src_nba_official_games")
          ? "nba"
        : sourceIds.includes("src_wimbledon_official")
          ? "wimbledon"
          : null;

  if (row.category_key !== "sports" && !sport && !league) {
    return null;
  }

  return { sport, league };
}
