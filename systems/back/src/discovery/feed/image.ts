import { readMarketCategoryMeta } from "../../shared/market-category";
import { readContractMarketImage } from "../../shared/market-truth";
import {
  findAssetByAlias,
  readMarketVisualAssetById
} from "../../shared/market-visual-registry";
import type { DiscoveryFeedItem } from "./types";

function readApprovedOutcomeImage(outcomeImageUrl: string | null): string | null {
  if (!outcomeImageUrl?.trim()) {
    return null;
  }

  const src = outcomeImageUrl.trim();

  return isRegistryBucketPath(src) ? null : src;
}

// Returns true if the path looks like one of our generic registry bucket SVGs
// (a category/source/entity/event default asset path). Such a stamp is
// considered "improvable" because alias rematch can upgrade it to a more
// specific registry asset. External URLs/custom paths are operator decisions.
function isRegistryBucketPath(src: string): boolean {
  return src.startsWith("/assets/images/market-buckets/");
}

function normalizeCategoryKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function canUseAliasRematch(
  categoryKey: string | null,
  asset: NonNullable<ReturnType<typeof findAssetByAlias>>
): boolean {
  if (asset.kind === "category") {
    return true;
  }

  const normalizedCategory = normalizeCategoryKey(categoryKey);

  if (!normalizedCategory) {
    return true;
  }

  return (
    normalizeCategoryKey(asset.canonicalCategory) === normalizedCategory ||
    normalizeCategoryKey(asset.frontendKey) === normalizedCategory
  );
}

// Image selection ladder, matching docs/agents/seer/market-image-taxonomy-v1.md:
// contract image -> alias rematch -> custom legacy outcome image -> category fallback.
// Generic bucket paths on legacy outcomes are treated as stale stamps; they
// should not make a politics market wear the sports bucket.
export function buildFallbackImage(
  marketContract: unknown,
  categoryKey: string | null,
  title: string,
  outcomeImageUrl: string | null,
  preferredImage?: { src: string | null | undefined; alt: string | null | undefined } | null
): DiscoveryFeedItem["image"] {
  const preferredSrc = preferredImage?.src?.trim();

  if (preferredSrc) {
    return {
      src: preferredSrc,
      alt: preferredImage?.alt?.trim() || title
    };
  }

  const contractImage = readContractMarketImage(marketContract);

  if (contractImage && !isRegistryBucketPath(contractImage.src)) {
    const asset = contractImage.assetId
      ? readMarketVisualAssetById(contractImage.assetId)
      : null;
    return {
      src: contractImage.src,
      alt: contractImage.alt,
      ...(contractImage.theme ? { theme: contractImage.theme } : {}),
      ...(asset?.photoPath ? { photoSrc: asset.photoPath } : {})
    };
  }

  const rematched = findAssetByAlias(title);
  if (rematched && canUseAliasRematch(categoryKey, rematched)) {
    return {
      src: rematched.path,
      alt: contractImage?.alt ?? title,
      ...(contractImage?.theme ? { theme: contractImage.theme } : {}),
      ...(rematched.photoPath ? { photoSrc: rematched.photoPath } : {})
    };
  }

  if (contractImage) {
    return {
      src: contractImage.src,
      alt: contractImage.alt,
      ...(contractImage.theme ? { theme: contractImage.theme } : {})
    };
  }

  const approvedOutcomeImage = readApprovedOutcomeImage(outcomeImageUrl);
  if (approvedOutcomeImage) {
    return {
      src: approvedOutcomeImage,
      alt: title
    };
  }

  const categoryMeta = readMarketCategoryMeta(categoryKey);
  if (categoryMeta) {
    return {
      src: categoryMeta.brandImageUrl,
      alt: categoryMeta.brandAlt,
      theme: categoryMeta.theme
    };
  }

  return null;
}
