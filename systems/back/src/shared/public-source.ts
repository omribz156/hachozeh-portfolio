function extractFirstUrl(value: string | null | undefined): string | null {
  return value?.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function readBasketGameId(url: URL): string | null {
  const hashMatch = url.hash.match(/game[-=](\d+)/i);
  const queryMatch =
    url.searchParams.get("GameId") ??
    url.searchParams.get("GameID") ??
    url.searchParams.get("game_id");

  return hashMatch?.[1] ?? queryMatch;
}

const SOURCE_LABELS_HE: Record<string, string> = {
  src_boi_announcements: "פרסומי בנק ישראל",
  src_boi_exchange_rates: "שערים יציגים של בנק ישראל",
  src_coinbase_exchange_candles: "נתוני מסחר של Coinbase",
  src_credible_reporting_bundle: "דיווחים מאומתים ממקורות עצמאיים",
  src_fiba_basketball_games: "אתר FIBA הרשמי",
  src_fifa_match_centre: "פיפ״א, עמוד המשחק הרשמי",
  src_ifa_fixtures_results: "אתר ההתאחדות לכדורגל בישראל",
  src_ims_daily_observations: "נתוני השירות המטאורולוגי",
  src_nba_official_games: "אתר ה-NBA הרשמי",
  src_nike_liga_official: "אתר הליגה הרשמי",
  src_tradingview_fx: "נתוני מט״ח",
  src_wimbledon_official: "ווימבלדון, האתר הרשמי",
  src_winner_league_basketball: "מנהלת ליגת Winner סל"
};

function localizeKnownEnglishSourceLabel(value: string): string | null {
  const normalized = value.toLowerCase();

  if (normalized.includes("bank of israel representative exchange")) {
    return SOURCE_LABELS_HE.src_boi_exchange_rates;
  }

  if (normalized.includes("bank of israel")) {
    return SOURCE_LABELS_HE.src_boi_announcements;
  }

  if (normalized.includes("israel meteorological service")) {
    return SOURCE_LABELS_HE.src_ims_daily_observations;
  }

  if (normalized.includes("tradingview")) {
    return SOURCE_LABELS_HE.src_tradingview_fx;
  }

  if (normalized.includes("nba official")) {
    return SOURCE_LABELS_HE.src_nba_official_games;
  }

  if (normalized.includes("fiba")) {
    return SOURCE_LABELS_HE.src_fiba_basketball_games;
  }

  if (normalized.includes("israel football association")) {
    return SOURCE_LABELS_HE.src_ifa_fixtures_results;
  }

  if (normalized.includes("winner league")) {
    return SOURCE_LABELS_HE.src_winner_league_basketball;
  }

  if (normalized.includes("wimbledon")) {
    return SOURCE_LABELS_HE.src_wimbledon_official;
  }

  if (normalized.includes("coinbase")) {
    return SOURCE_LABELS_HE.src_coinbase_exchange_candles;
  }

  return null;
}

export function localizeResolutionSourceLabel(
  value: string | null | undefined,
  sourceIds: readonly string[] = []
): string | null {
  const stripped = String(value ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*[:：]\s*$/, "")
    .trim();

  if (!stripped) {
    for (const sourceId of sourceIds) {
      const label = SOURCE_LABELS_HE[sourceId];

      if (label) {
        return label;
      }
    }

    return null;
  }

  if (/[\u0590-\u05ff]/.test(stripped)) {
    for (const sourceId of sourceIds) {
      if (sourceId === "src_fifa_match_centre" && stripped === "פיפ״א") {
        return SOURCE_LABELS_HE.src_fifa_match_centre;
      }
    }

    return stripped;
  }

  for (const sourceId of sourceIds) {
    const label = SOURCE_LABELS_HE[sourceId];

    if (label) {
      return label;
    }
  }

  return localizeKnownEnglishSourceLabel(stripped) ?? stripped;
}

export function toPublicResolutionSourceUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return null;
    }

    const isBasketGamesJson =
      url.hostname === "basket.co.il" &&
      url.pathname === "/pbp/json/games_all.json";
    const gameId = isBasketGamesJson ? readBasketGameId(url) : null;

    if (gameId) {
      return `https://basket.co.il/game-zone.asp?GameId=${gameId}#!stats`;
    }

    return raw;
  } catch {
    return null;
  }
}

export function readPublicResolutionSourceUrl(
  sourceLabelOrUrl: string | null | undefined,
  explicitUrl?: string | null
): string | null {
  return (
    toPublicResolutionSourceUrl(explicitUrl) ??
    toPublicResolutionSourceUrl(extractFirstUrl(sourceLabelOrUrl))
  );
}

export function publicizeResolutionSourceText(value: string | null | undefined): string | null {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  const text = raw
    .replace(/https?:\/\/\S+/g, (url) => toPublicResolutionSourceUrl(url) ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+([),.;:!?])/g, "$1")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n[^\S\n]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || null;
}

export function stripResolutionSourceUrl(value: string | null | undefined): string | null {
  return localizeResolutionSourceLabel(value);
}
