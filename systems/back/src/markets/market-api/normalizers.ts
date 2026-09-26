import type {
  MarketCatalogSort,
  MarketContractSide,
  MarketHistoryRange,
  MarketTradeSide
} from "./types";

export const DEFAULT_MARKET_LIMIT = 50;
// Raised from 100 (growth-shape sweep, sitemap fix): the sitemap's markets
// child fetches the whole public catalog in one call so each chunk stays a
// single backend round trip. 1000 covers the catalog in one page at current
// scale and stays far under the sitemap spec's 50k-URLs-per-file ceiling.
// This is the shared public /api/markets cap — read-only pagination ceiling,
// not a security boundary — so raising it doesn't widen anything sensitive.
export const MAX_MARKET_LIMIT = 1000;
export const DEFAULT_TRADE_LIMIT = 50;
export const MAX_TRADE_LIMIT = 100;
export const DEFAULT_POSITION_LIMIT = 50;
export const MAX_POSITION_LIMIT = 100;
export const DEFAULT_HISTORY_LIMIT = 500;
export const MAX_HISTORY_LIMIT = 20000;

export const HISTORY_RANGE_MS: Record<Exclude<MarketHistoryRange, "all">, number> = {
  "1H": 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000
};

export function normalizeStatus(value: string | null): string | null {
  const normalizedValue = value?.trim() || "open";

  if (normalizedValue === "all") {
    return null;
  }

  if (
    normalizedValue === "draft" ||
    normalizedValue === "open" ||
    normalizedValue === "closed" ||
    normalizedValue === "resolved"
  ) {
    return normalizedValue;
  }

  return "open";
}

export function normalizeIsoDate(value: string | null): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedTime = Date.parse(normalizedValue);

  if (!Number.isFinite(parsedTime)) {
    return null;
  }

  return new Date(parsedTime).toISOString();
}

export function normalizeCatalogSort(value: string | null): MarketCatalogSort {
  if (value === "close_asc" || value === "volume_desc" || value === "id_asc") {
    return value;
  }

  return "updated_desc";
}

export function normalizeSide(value: string | null): MarketTradeSide | null {
  return value === "buy" || value === "sell" ? value : null;
}

export function normalizeContractSide(value: string | null): MarketContractSide | null {
  return value === "yes" || value === "no" ? value : null;
}

export function normalizeHistoryRange(value: string | null): MarketHistoryRange {
  const normalizedValue = value?.trim();
  const lowerValue = normalizedValue?.toLowerCase();

  if (
    normalizedValue === "1H" ||
    normalizedValue === "6H" ||
    normalizedValue === "1D" ||
    normalizedValue === "1W" ||
    normalizedValue === "1M" ||
    normalizedValue === "all"
  ) {
    return normalizedValue;
  }

  if (lowerValue === "1h") {
    return "1H";
  }

  if (lowerValue === "6h") {
    return "6H";
  }

  if (lowerValue === "1d") {
    return "1D";
  }

  if (lowerValue === "1w") {
    return "1W";
  }

  if (lowerValue === "1m") {
    return "1M";
  }

  if (lowerValue === "max") {
    return "all";
  }

  return "all";
}

export function normalizeUnixSeconds(value: string | null): number | null {
  const parsed = Number.parseFloat(value ?? "");

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function normalizeFidelityMinutes(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.min(parsed, 1440);
}

export function normalizeHistoryInterval(
  range: MarketHistoryRange,
  value: string | null
): string {
  const normalizedValue = value?.trim();

  if (
    normalizedValue === "1m" ||
    normalizedValue === "5m" ||
    normalizedValue === "15m" ||
    normalizedValue === "1h" ||
    normalizedValue === "4h" ||
    normalizedValue === "trade"
  ) {
    return normalizedValue;
  }

  if (range === "1H") {
    return "1m";
  }

  if (range === "6H") {
    return "1m";
  }

  if (range === "1D") {
    return "5m";
  }

  if (range === "1W") {
    return "1h";
  }

  if (range === "1M") {
    return "4h";
  }

  return "trade";
}

export function clampLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}
