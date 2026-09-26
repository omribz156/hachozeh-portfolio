import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

export type MarketVisualTheme = {
  primary: string;
  secondary: string;
  surface: string;
  accentReason: string;
  source: string;
};

export type MarketVisualRights = {
  status: string;
  publicUse: string;
  owner: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  notes?: string[];
};

// Display state for a sports team entity — see the back/shared copy of this
// type and workspace/docs/superpowers/specs/2026-06-01-sports-team-colors-design.md.
// Kept in sync with systems/back/src/shared/market-visual-registry.ts.
export type MarketVisualTeamBrand = {
  displayName: string;
  shortName: string;
  colorPrimary: string;
  colorOn: string;
  crestLabel: string;
  colorSecondary?: string; // second identity color — the jersey tile background
  crestPath?: string; // served path to the team jersey SVG
  sport?: string; // "football" | "basketball" — disambiguates clubs that field both
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
  // team is present only on sports team entity assets — see MarketVisualTeamBrand.
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
