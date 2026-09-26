import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

export type MarketVisualTheme = {
  primary: string;
  secondary: string;
  surface: string;
  accentReason: string;
  source: string;
};

type MarketVisualRights = {
  status: string;
  publicUse: string;
  owner: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  notes?: string[];
};

// Display state for a sports team entity. Hydrated onto matchup cards at read
// time (the discovery presenter resolves a side's outcome label → team asset
// via findAssetByAlias), never stamped into a contract — so updating a club's
// color reflects on every existing market instantly. See
// workspace/docs/superpowers/specs/2026-06-01-sports-team-colors-design.md.
export type MarketVisualTeamBrand = {
  displayName: string; // full name for the identity band (e.g. מכבי ת"א)
  shortName: string; // compact label for the segmented bar (e.g. מכבי)
  colorPrimary: string; // team kit color — the jersey shirt + button tint
  colorOn: string; // legible foreground color that sits on colorPrimary
  crestLabel: string; // initial stand-in for unseeded contexts
  colorSecondary?: string; // second identity color — the jersey tile background
  crestPath?: string; // served path to the side identity image
  sport?: string; // "football" | "basketball" | "tennis" — disambiguates reusable names
};

export type MarketVisualAsset = {
  assetId: string;
  kind: "category" | "entity" | "event" | "source";
  canonicalCategory: string;
  frontendKey: string;
  aliases: string[];
  label: string;
  // path is the SVG icon — required for every asset, the doctrine floor.
  path: string;
  // photoPath is an optional editorial photograph. Surfaces that earn a
  // photo (hero card, market-detail header) render this when present; card
  // thumbs always render `path` (the SVG) regardless. See
  // workspace/docs/agents/seer/market-image-taxonomy-v1.md "Photo Doctrine".
  photoPath?: string;
  // team is present only on sports team entity assets — carries the brand
  // colors + crest the matchup card renders. Optional everywhere else.
  team?: MarketVisualTeamBrand;
  rights: MarketVisualRights;
  theme: MarketVisualTheme;
};

export type MarketVisualRegistry = {
  objectType: "market_visual_asset_registry_v1";
  assets: MarketVisualAsset[];
};

const REGISTRY_RELATIVE_PATH = "workspace/assets/market-images/registry.json";

let cachedRegistry: MarketVisualRegistry | null = null;

function normalizeKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

// Team-label matching strips quote glyphs — gershayim ״ (U+05F4), geresh ׳
// (U+05F3), and ASCII ' ` " — so a side label written הפועל ב״ש matches an alias
// הפועל ב"ש. The same club shows up with different quote marks across markets
// (titles use gershayim, some outcome labels use a straight quote), so exact
// alias matching would miss. Collapses whitespace too.
function normalizeTeamLabel(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/["'`׳״]/g, "")
    .replace(/\s+/g, " ");
}

function findRepoFile(relativePath: string): string {
  const starts = [process.cwd(), __dirname];

  for (const start of starts) {
    let current = start;

    for (let index = 0; index < 8; index += 1) {
      const candidate = join(current, relativePath);

      if (existsSync(candidate)) {
        return candidate;
      }

      const parent = dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }
  }

  throw new Error(`Market visual registry not found: ${relativePath}`);
}

export function readMarketVisualRegistry(): MarketVisualRegistry {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const registryPath = findRepoFile(REGISTRY_RELATIVE_PATH);
  cachedRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as MarketVisualRegistry;

  return cachedRegistry;
}

export function readMarketVisualAssetById(assetId: string): MarketVisualAsset | null {
  const normalized = normalizeKey(assetId);

  if (!normalized) {
    return null;
  }

  return readMarketVisualRegistry().assets.find((asset) => normalizeKey(asset.assetId) === normalized) ?? null;
}

export function readMarketVisualAssetByCategory(categoryKey: string | null | undefined): MarketVisualAsset | null {
  const normalized = normalizeKey(categoryKey);

  if (!normalized) {
    return null;
  }

  return (
    readMarketVisualRegistry().assets.find(
      (asset) =>
        asset.kind === "category" &&
        (normalizeKey(asset.canonicalCategory) === normalized ||
          normalizeKey(asset.frontendKey) === normalized ||
          asset.aliases.some((alias) => normalizeKey(alias) === normalized))
    ) ?? null
  );
}

// Read-time content rematch — finds the first asset whose aliases appear in
// the haystack (market title + category etc.). Returns the highest-priority
// match across kinds (entity > event > source > category), so a more specific
// asset always wins over a generic category fallback.
//
// Two use cases the presenter relies on:
//   1. Photo hydration — stamped asset has no photoPath, but a newly-registered
//      entity asset matches the title and has one (e.g. Trump asset added
//      months after the market was created).
//   2. Better SVG match — stamped asset is a category-kind fallback (e.g. the
//      shekel/dollar market was created with category=economy and stamped
//      with bucket.economy.default.v1), but the title actually matches a more
//      specific bucket via alias (fx → "שער הדולר"). Replacing the SVG src
//      with the better match keeps the user's question right ("why is my
//      currency market wearing an economy icon?") without re-stamping
//      contracts. Misclassifications self-heal as the registry grows.
//
// The contract still records Seer's original intent; the registry answers
// "what's the current best image for this market?"
export function findAssetByAlias(haystack: string | null | undefined): MarketVisualAsset | null {
  const lower = normalizeKey(haystack);

  if (!lower) {
    return null;
  }

  const assets = readMarketVisualRegistry().assets;
  // `source` kept in the union for legacy contract parsing but no source-kind
  // assets exist in the registry as of 2026-05-30 — the bucket was retired
  // because the generic shield SVG didn't carry meaningful info at thumb size.
  // See workspace/docs/agents/seer/market-image-taxonomy-v1.md "Retired buckets".
  const order: MarketVisualAsset["kind"][] = ["entity", "event", "category"];

  for (const kind of order) {
    const found = assets.find(
      (asset) =>
        asset.kind === kind &&
        asset.aliases.some((alias) => {
          const aliasLower = normalizeKey(alias);
          return Boolean(aliasLower) && lower.includes(aliasLower);
        })
    );
    if (found) {
      return found;
    }
  }

  return null;
}

// Legacy name kept for callers that specifically want entity-only matching
// (e.g. a future "show entity badge" feature). Today both presenters use the
// broader findAssetByAlias above.
export function findEntityAssetByAlias(haystack: string | null | undefined): MarketVisualAsset | null {
  const found = findAssetByAlias(haystack);
  return found?.kind === "entity" ? found : null;
}

// Resolve a single matchup side's outcome label to its team brand. The
// discovery matchup presenter calls this per side to hydrate team colors at
// read time (display state, never stamped). Returns null when no seeded team
// matches — goal-range markets ("0-1 שערים"), NBA, or unseeded clubs — and the
// card then keeps its default side colors. Dedicated (not findAssetByAlias)
// because it (a) matches on the per-side label, not a whole-market haystack,
// (b) normalizes quote glyphs, and (c) only considers team-bearing assets.
// Aliases are city-specific (no bare "מכבי"/"הפועל") so a side resolves to
// exactly one club. Self-heals as the registry grows.
export function findTeamBrandByLabel(
  label: string | null | undefined,
  sport?: string | null,
  league?: string | null
): MarketVisualTeamBrand | null {
  const norm = normalizeTeamLabel(label);

  if (!norm) {
    return null;
  }

  // Sport/league-aware: a club can field multiple teams under the same name
  // (Maccabi TA football, Winner League basketball, EuroLeague basketball).
  // When the market's sport is known, require a matching sport tag so basketball
  // markets never inherit football shirts. When league is known, prefer the
  // matching league path before any same-sport fallback.
  let fallback: MarketVisualTeamBrand | null = null;
  let sportFallback: MarketVisualTeamBrand | null = null;

  const leaguePath =
    league === "winner-league" ? "/basketball/il-winner-league/" :
    league === "euroleague" ? "/basketball/euroleague/" :
    league === "nba" ? "/basketball/nba/" :
    league === "israeli-football" ? "/football/il-premier-league/" :
    league === "wimbledon" ? "/market-photos/tennis-stars/" :
    null;

  for (const asset of readMarketVisualRegistry().assets) {
    if (asset.kind !== "entity" || !asset.team) {
      continue;
    }

    const matched = asset.aliases.some((alias) => {
      const aliasNorm = normalizeTeamLabel(alias);
      return Boolean(aliasNorm) && norm.includes(aliasNorm);
    });

    if (!matched) {
      continue;
    }

    if (sport && asset.team.sport === sport && leaguePath && asset.team.crestPath?.includes(leaguePath)) {
      return asset.team;
    }

    if (sport && asset.team.sport === sport && !sportFallback) {
      sportFallback = asset.team;
    }

    if (!fallback) {
      fallback = asset.team;
    }
  }

  return sportFallback ?? fallback;
}
