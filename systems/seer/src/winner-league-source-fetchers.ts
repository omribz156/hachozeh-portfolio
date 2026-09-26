import type { ManualSeerSignal } from "./contracts";
import { getPlannedEventWarmupPolicy, isWithinUpcomingHorizon } from "./planned-event-family-policy";
import { buildSportsMatchWinnerTemplate } from "./planned-event-templates";
import { fetchSourceText } from "./source-fetch-client";
import {
  formatEnglishDateFromDayMonthYear,
  formatHebrewDateFromDayMonthYear,
  toIsoDateFromDayMonthYear
} from "./source-text-utils";
import { compactWhitespace, decodeHtmlEntities, slugify } from "./text";

export const WINNER_LEAGUE_SOURCE_ID = "src_winner_league_basketball";
export const WINNER_LEAGUE_CONFIG_URL = "https://basket.co.il/pbp/json/config.json";
export const WINNER_LEAGUE_GAMES_URL = "https://basket.co.il/pbp/json/games_all.json";

type WinnerLeagueConfig = {
  cYear?: number;
  BigYear?: string;
  display?: string;
  ActiveComp?: number;
  nextRound?: number;
  comp_cat?: number;
  external_id?: number;
  round_desc?: string;
  title?: string;
  title_eng?: string;
};

type WinnerLeagueGame = {
  id: number;
  ExternalID?: string;
  game_type?: number;
  GN?: number;
  team_name_1?: string;
  team_name_2?: string;
  team_name_eng_1?: string;
  team_name_eng_2?: string;
  game_date_txt?: string;
  game_time?: string;
  liveChannel?: string;
  pbp_link?: string;
  isATC?: number;
  isLive?: number;
  score_team1?: number;
  score_team2?: number;
};

function winnerLeaguePublicGameUrl(gameId: number | string): string {
  return `https://basket.co.il/game-zone.asp?GameId=${encodeURIComponent(String(gameId))}#!stats`;
}

function parseJsonWithOptionalBom<T>(value: string): T {
  return JSON.parse(value.replace(/^\uFEFF/, "")) as T;
}

function decodeCompact(value: string | undefined): string {
  return compactWhitespace(decodeHtmlEntities(value ?? "").replace(/\u00a0/g, " "));
}

function parseWinnerLeagueConfigJson(json: string): WinnerLeagueConfig | undefined {
  const parsed = parseJsonWithOptionalBom<WinnerLeagueConfig[]>(json);
  return parsed[0];
}

function parseWinnerLeagueGamesJson(json: string): WinnerLeagueGame[] {
  const parsed = parseJsonWithOptionalBom<Array<{ games?: WinnerLeagueGame[] }>>(json);
  return parsed[0]?.games ?? [];
}

function toWinnerLeagueGameObservedAt(game: WinnerLeagueGame): string | undefined {
  const dateText = compactWhitespace(game.game_date_txt ?? "");

  if (dateText.length === 0) {
    return undefined;
  }

  const dateIso = toIsoDateFromDayMonthYear(dateText);
  const dateOnly = dateIso.slice(0, 10);
  const timeText = compactWhitespace(game.game_time ?? "");

  if (/^\d{1,2}:\d{2}$/.test(timeText)) {
    return `${dateOnly}T${timeText.padStart(5, "0")}:00.000Z`;
  }

  return `${dateOnly}T00:00:00.000Z`;
}

function winnerLeagueCompetitionLabel(config: WinnerLeagueConfig | undefined): string {
  const title = decodeCompact(config?.title);
  const normalized = title.split(",")[0]?.trim();

  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return "ליגת Winner סל";
}

function shouldKeepWinnerLeagueGame(
  game: WinnerLeagueGame,
  generatedAt: string,
  nextRound?: number
): boolean {
  const warmupPolicy = getPlannedEventWarmupPolicy("sports-match-winner-v1");
  const observedAt = toWinnerLeagueGameObservedAt(game);

  if (!observedAt) {
    return false;
  }

  if (!isWithinUpcomingHorizon(observedAt, generatedAt, warmupPolicy.horizonDays)) {
    return false;
  }

  if (
    typeof nextRound === "number" &&
    typeof game.GN === "number" &&
    typeof warmupPolicy.maxRoundOffset === "number" &&
    game.GN > nextRound + warmupPolicy.maxRoundOffset
  ) {
    return false;
  }

  return (
    Number(game.score_team1 ?? 0) === 0 &&
    Number(game.score_team2 ?? 0) === 0 &&
    decodeCompact(game.team_name_1).length > 0 &&
    decodeCompact(game.team_name_2).length > 0
  );
}

function toWinnerLeagueManualSignals(
  games: WinnerLeagueGame[],
  generatedAt: string,
  config?: WinnerLeagueConfig
): ManualSeerSignal[] {
  const competitionLabel = winnerLeagueCompetitionLabel(config);

  return games.map((game) => {
    const teamOne = decodeCompact(game.team_name_1);
    const teamTwo = decodeCompact(game.team_name_2);
    const teamOneEnglish = decodeCompact(game.team_name_eng_1) || teamOne;
    const teamTwoEnglish = decodeCompact(game.team_name_eng_2) || teamTwo;
    const englishDateLabel =
      formatEnglishDateFromDayMonthYear(compactWhitespace(game.game_date_txt ?? "")) ?? "";
    const hebrewDateLabel =
      formatHebrewDateFromDayMonthYear(compactWhitespace(game.game_date_txt ?? "")) ??
      decodeCompact(game.game_date_txt);
    const observedAt = toWinnerLeagueGameObservedAt(game) ?? generatedAt;
    const gameTime = compactWhitespace(game.game_time ?? "");
    const recurringTemplate = buildSportsMatchWinnerTemplate({
      leftLabel: teamOne,
      rightLabel: teamTwo,
      displayTitle: `${teamOne} vs ${teamTwo} (${competitionLabel}, ${hebrewDateLabel})`,
      resolutionAnchor: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל."
    });
    const closeShape = /^\d{1,2}:\d{2}$/.test(gameTime)
      ? `Close before ${englishDateLabel} at ${gameTime}.`
      : `Close before ${englishDateLabel}.`;

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_winner_league_${slugify(`${game.game_date_txt}_${teamOneEnglish}_${teamTwoEnglish}`)}`,
      sourceId: WINNER_LEAGUE_SOURCE_ID,
      intakeLane: "planned",
      recurringTemplateId: recurringTemplate.recurringTemplateId,
      title: `${teamOne} נגד ${teamTwo}`,
      summary: `מנהלת ליגת Winner סל מציגה משחק רשמי מתקרב בין ${teamOne} ל-${teamTwo} ב-${hebrewDateLabel}${gameTime.length > 0 ? ` בשעה ${gameTime}` : ""}.`,
      category: "sports",
      whyNow: `${teamOne} מול ${teamTwo} מתוכנן ל-${hebrewDateLabel}${gameTime.length > 0 ? ` ב-${gameTime}` : ""}.`,
      observedAt,
      importedAt: generatedAt,
      sourceRef: winnerLeaguePublicGameUrl(game.id),
      sourceLabel: "מנהלת ליגת Winner סל",
      clusterHint: `winner_league_${slugify(`${englishDateLabel}_${teamOneEnglish}_${teamTwoEnglish}`)}`,
      lineageHint: `winner_league_matchup_${slugify(`${teamOneEnglish}_${teamTwoEnglish}`)}`,
      keyEntities: [teamOne, teamTwo, competitionLabel],
      question: recurringTemplate.question,
      marketAngle: recurringTemplate.marketAngle,
      marketForm: recurringTemplate.marketForm,
      proposedOutcomes: recurringTemplate.proposedOutcomes,
      marketWorthiness: "משחק ליגה ישראלי מתוזמן ורשמי מתאים לשוק ספורט נקי וברור.",
      resolutionFeasibility: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל מספיקה להכרעה.",
      suggestedCloseShape: closeShape,
      suggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
      notes: [
        `grounding: competition=${competitionLabel}`,
        `grounding: event-date=${englishDateLabel}`,
        ...(gameTime.length > 0 ? [`grounding: event-time=${gameTime}`] : []),
        "grounding: source=winner-league-games-json",
        `machine-source=${WINNER_LEAGUE_GAMES_URL}#game-${game.id}`,
        ...(typeof game.GN === "number" ? [`grounding: round=${game.GN}`] : []),
        "intake-lane=planned"
      ],
      tags: ["heartbeat", "authority", "official", "sports", "winner-league", "planned"]
    };
  });
}

export async function fetchWinnerLeagueSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const warmupPolicy = getPlannedEventWarmupPolicy("sports-match-winner-v1");
  const [configJson, gamesJson] = await Promise.all([
    fetchSourceText(WINNER_LEAGUE_CONFIG_URL, "Winner League config", fetchImpl),
    fetchSourceText(WINNER_LEAGUE_GAMES_URL, "Winner League games", fetchImpl)
  ]);

  const config = parseWinnerLeagueConfigJson(configJson);
  const games = parseWinnerLeagueGamesJson(gamesJson)
    .filter((game) => shouldKeepWinnerLeagueGame(game, generatedAt, config?.nextRound))
    .sort(
      (left, right) =>
        Date.parse(toWinnerLeagueGameObservedAt(left) ?? generatedAt) -
        Date.parse(toWinnerLeagueGameObservedAt(right) ?? generatedAt)
    )
    .slice(0, warmupPolicy.maxUpcomingSiblings);

  return toWinnerLeagueManualSignals(games, generatedAt, config);
}
