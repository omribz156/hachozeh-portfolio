import {
  readMarketVisualAssetByCategory,
  type MarketVisualTheme
} from "./market-visual-registry";

export type MarketCategoryMeta = {
  backendKey: string;
  frontendKey: string;
  label: string;
  href: string;
  brandAlt: string;
  brandImageUrl: string;
  theme?: MarketVisualTheme;
};

// Category brand image and alt now come straight from the visual registry
// (local SVG buckets under /assets/images/market-buckets/).
// The old BAKED_DISPLAY_IMAGE_BY_CATEGORY table shipped hardcoded
// images.unsplash.com / lh3.googleusercontent.com URLs that bypassed Seer's
// curated registry assets and surfaced random photos on cards (see
// docs/agents/seer/market-image-taxonomy-v1.md "Rights Policy").
export function readMarketCategoryMeta(categoryKey: string | null): MarketCategoryMeta | null {
  const asset = readMarketVisualAssetByCategory(categoryKey);

  if (!asset) {
    return null;
  }

  return {
    backendKey: asset.canonicalCategory,
    frontendKey: asset.frontendKey,
    label: asset.label,
    href: `/trending?category=${asset.frontendKey}`,
    brandAlt: asset.label,
    brandImageUrl: asset.path,
    theme: asset.theme
  };
}

export function resolveBackendCategoryKey(categoryKey: string | null): string | null {
  if (!categoryKey || !categoryKey.trim()) {
    return null;
  }

  return readMarketCategoryMeta(categoryKey)?.backendKey ?? categoryKey;
}

export function resolveBackendCategoryKeys(categoryKey: string | null): string[] | null {
  const normalized = categoryKey?.trim();

  if (!normalized) {
    return null;
  }

  const asset = readMarketVisualAssetByCategory(normalized);

  if (!asset) {
    return [normalized];
  }

  return Array.from(
    new Set(
      [
        asset.canonicalCategory,
        asset.frontendKey,
        ...asset.aliases,
        normalized
      ].filter((item) => item.trim().length > 0)
    )
  );
}

export function resolveFrontendCategoryKey(categoryKey: string | null): string | null {
  if (!categoryKey || !categoryKey.trim()) {
    return null;
  }

  return readMarketCategoryMeta(categoryKey)?.frontendKey ?? categoryKey;
}
