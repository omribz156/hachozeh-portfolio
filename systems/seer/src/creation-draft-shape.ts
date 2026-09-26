import { createHash } from "node:crypto";

import type {
  MarketDraftOutcome,
  ProposedOutcome,
  RecurringEventTemplateId,
  ReviewFeedbackItem,
  ReviewHandoffItem
} from "./contracts";
import { readMarketVisualAssetByCategory } from "./market-visual-registry";

export const DEFAULT_SEED_AMOUNT = "1000.000000";

const NORMAL_PUBLIC_LIQUIDITY_B = "25000.00000000";
const SERIOUS_ECONOMY_POLITICS_LIQUIDITY_B = "75000.00000000";

export function resolveCreationCategoryKey(category: string | undefined): string | null {
  return readMarketVisualAssetByCategory(category)?.canonicalCategory ?? null;
}

function shortenLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed.length <= 18 ? trimmed : null;
}

function slugifyIdentifier(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function buildLossySlugSuffix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 6);
}

function buildSeerMarketId(candidateMarketId: string): string {
  return `disc-${slugifyIdentifier(candidateMarketId, "market")}`;
}

function normalizeOutcomeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function resolveCentralBankOutcomeSuffix(label: string): string | null {
  const normalized = normalizeOutcomeLabel(label);

  if (normalized.includes("ללא שינוי") || normalized.includes("no change")) {
    return "hold";
  }

  if ((normalized.includes("ירידה") || normalized.includes("decrease") || normalized.includes("cut")) && (normalized.includes("0.50") || normalized.includes("50+"))) {
    return "cut-050-plus";
  }

  if ((normalized.includes("ירידה") || normalized.includes("decrease") || normalized.includes("cut")) && (normalized.includes("0.25") || normalized.includes("25"))) {
    return "cut-025";
  }

  if ((normalized.includes("עלייה") || normalized.includes("increase") || normalized.includes("hike")) && (normalized.includes("0.50") || normalized.includes("50+"))) {
    return "hike-050-plus";
  }

  if ((normalized.includes("עלייה") || normalized.includes("increase") || normalized.includes("hike")) && (normalized.includes("0.25") || normalized.includes("25"))) {
    return "hike-025";
  }

  return null;
}

function resolveDraftOutcomeId(
  candidateMarketId: string,
  recurringTemplateId: RecurringEventTemplateId | undefined,
  outcome: ProposedOutcome,
  index: number
): string {
  const marketId = buildSeerMarketId(candidateMarketId);

  if (
    recurringTemplateId === "boi-rate-decision-v1" ||
    recurringTemplateId === "fed-rate-decision-v1" ||
    recurringTemplateId === "ecb-rate-decision-v1"
  ) {
    const suffix = resolveCentralBankOutcomeSuffix(outcome.label);

    if (suffix) {
      return `${marketId}-${suffix}`;
    }
  }

  const labelSlug = slugifyIdentifier(outcome.label, `option-${index + 1}`);
  const slugLooksLossy = /[^\x00-\x7F]/.test(outcome.label) && !/[a-z]/.test(labelSlug);
  const stableLabelSlug = slugLooksLossy
    ? `${labelSlug}-${buildLossySlugSuffix(outcome.label)}`
    : labelSlug;
  return `${marketId}-${stableLabelSlug}`;
}

export function toDraftOutcome(
  candidateMarketId: string,
  recurringTemplateId: RecurringEventTemplateId | undefined,
  outcome: ProposedOutcome,
  index: number
): MarketDraftOutcome {
  return {
    outcomeId: resolveDraftOutcomeId(candidateMarketId, recurringTemplateId, outcome, index),
    label: outcome.label,
    shortLabel: shortenLabel(outcome.label),
    description: outcome.notes?.trim() || null,
    colorKey: null
  };
}

export function computeLiquidityB(params: {
  recurringTemplateId: RecurringEventTemplateId | undefined;
  categoryKey?: string | null;
  familyKey?: string | null;
  outcomeCount: number;
}): string {
  const categoryKey = (params.categoryKey ?? "").toLowerCase();
  const familyKey = (params.familyKey ?? params.recurringTemplateId ?? "").toLowerCase();

  if (
    familyKey.includes("boi") ||
    familyKey.includes("rate-decision") ||
    familyKey.includes("fx") ||
    categoryKey === "economy" ||
    categoryKey === "economics" ||
    categoryKey === "politics"
  ) {
    return SERIOUS_ECONOMY_POLITICS_LIQUIDITY_B;
  }

  return NORMAL_PUBLIC_LIQUIDITY_B;
}

export function computeReserveSeedAmount(params: {
  liquidityB: string;
  outcomeCount: number;
}): string {
  if (params.outcomeCount < 2) {
    return DEFAULT_SEED_AMOUNT;
  }

  const rawReserve = Number(params.liquidityB) * Math.log(params.outcomeCount);

  if (!Number.isFinite(rawReserve) || rawReserve <= 0) {
    return DEFAULT_SEED_AMOUNT;
  }

  return (Math.ceil(rawReserve * 1_000_000) / 1_000_000).toFixed(6);
}

export function buildCreationNotes(
  item: ReviewHandoffItem,
  feedback: ReviewFeedbackItem,
  closeAt: string,
  categoryKey: string,
  liquidityB: string,
  seedAmount: string,
  familyKey?: string,
  marketKindId?: string,
  event?: {
    eventId: string;
    eventResolutionPolicy: string;
  }
): string[] {
  const notes = [
    `creation-category=${categoryKey}`,
    `creation-close-at=${closeAt}`,
    `creation-reviewed-at=${feedback.reviewedAt}`,
    `creation-liquidity-b=${liquidityB}`,
    `creation-seed-amount=${seedAmount}`
  ];

  if (familyKey) {
    notes.push(`creation-family-key=${familyKey}`);
  }

  if (marketKindId) {
    notes.push(`creation-market-kind-id=${marketKindId}`);
  }

  if (event) {
    notes.push(`creation-event-id=${event.eventId}`);
    notes.push(`creation-event-resolution-policy=${event.eventResolutionPolicy}`);
  }

  if (feedback.editedQuestion) {
    notes.push("creation-uses-reviewed-question");
  }

  if (feedback.editedOutcomes?.length) {
    notes.push("creation-uses-reviewed-outcomes");
  }

  if (item.recurringTemplateId) {
    notes.push(`creation-template=${item.recurringTemplateId}`);
  }

  return notes;
}
