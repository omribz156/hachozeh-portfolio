import {
  readMarketCategoryMeta
} from "../../shared/market-category";
import {
  resolveCanonicalMarketKeyById,
  resolveMarketIdentity,
  resolveOutcomeKey
} from "../../shared/market-identity";

export function resolveMarketId(marketKey: string): string {
  return resolveMarketIdentity(marketKey)?.marketId ?? marketKey;
}

export function readMarketKey(marketId: string): string {
  return resolveCanonicalMarketKeyById(marketId) ?? marketId;
}

export function readOutcomeKey(outcomeId: string): string {
  return resolveOutcomeKey(outcomeId) ?? outcomeId;
}

export function readCategory(categoryKey: string | null) {
  const categoryMeta = readMarketCategoryMeta(categoryKey);

  return {
    key: categoryMeta?.frontendKey ?? categoryKey,
    label: categoryMeta?.label ?? "שווקים"
  };
}
