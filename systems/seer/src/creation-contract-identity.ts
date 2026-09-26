import { createHash } from "node:crypto";

import type {
  EventResolutionPolicy,
  MarketContractV1,
  RecurringEventTemplateId,
  ReviewFeedbackItem,
  ReviewHandoffItem
} from "./contracts";
import { slugify } from "./text";

type CreationReadinessDuplicateInput = {
  candidateMarketId: string;
  question: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  contract?: MarketContractV1;
};

function extractFirstUrl(value: string | undefined): string | null {
  return value?.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function normalizeFingerprintText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[״"]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeSourceUrlForFingerprint(value: string | undefined): string {
  const url = extractFirstUrl(value);

  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
  }
}

function closeDateKeyFromShape(value: string | undefined): string | null {
  const match = value?.match(/([A-Za-z]+ \d{1,2}, 20\d{2})(?: at \d{1,2}:\d{2})?/);

  if (!match?.[1]) {
    return null;
  }

  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isCalendarEventTemplate(templateId: RecurringEventTemplateId | undefined): boolean {
  return (
    templateId === "boi-rate-decision-v1" ||
    templateId === "fed-rate-decision-v1" ||
    templateId === "ecb-rate-decision-v1" ||
    templateId === "knesset-dissolution-before-date-v1"
  );
}

export function buildContractDuplicateKey(
  item: ReviewHandoffItem,
  feedback?: Pick<ReviewFeedbackItem, "editedCloseShape" | "editedQuestion" | "editedResolutionAnchor">
): string | null {
  const closeDate = closeDateKeyFromShape(feedback?.editedCloseShape?.trim() || item.suggestedCloseShape);

  if (!closeDate) {
    return null;
  }

  const questionKey = normalizeFingerprintText(feedback?.editedQuestion?.trim() || item.question);

  if (isCalendarEventTemplate(item.recurringTemplateId)) {
    if (item.lineageContext === "sibling-candidate") {
      return `calendar:${item.recurringTemplateId}:${closeDate}:${questionKey}`;
    }

    return `calendar:${item.recurringTemplateId}:${closeDate}`;
  }

  const sourceText =
    feedback?.editedResolutionAnchor?.trim() ||
    item.suggestedResolutionAnchor ||
    item.sourceRolePlan?.resolve?.[0] ||
    item.topSourceRefs?.[0];
  const sourceKey = normalizeSourceUrlForFingerprint(sourceText);

  if (item.recurringTemplateId === "sports-match-winner-v1" || item.recurringTemplateId === "sports-regulation-3way-v1") {
    if (item.lineageContext === "sibling-candidate") {
      return `sports:${item.recurringTemplateId}:${closeDate}:${sourceKey}:${questionKey}`;
    }

    return `sports:${item.recurringTemplateId}:${closeDate}:${sourceKey || questionKey}`;
  }

  return `market:${closeDate}:${sourceKey}:${questionKey}`;
}

function toFamilyKeyIdentifier(value: string): string {
  const normalized = slugify(value).replace(/_+/g, "-");

  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    return normalized;
  }

  return `family-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function toBackendIdentifier(value: string, prefix: string): string {
  const normalized = slugify(value).replace(/_+/g, "-");

  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    return `${prefix}-${normalized}`;
  }

  return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function closeDateKeyFromIso(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function resolveEventPolicyMarker(item: ReviewHandoffItem): EventResolutionPolicy | null {
  const markerText = [...(item.topRisks ?? []), ...(item.reviewHints ?? [])].join("\n");

  if (/event[-_\s]?resolution[-_\s]?policy\s*[:=]\s*exclusive_first_hit/i.test(markerText)) {
    return "exclusive_first_hit";
  }

  if (/event[-_\s]?resolution[-_\s]?policy\s*[:=]\s*independent_children/i.test(markerText)) {
    return "independent_children";
  }

  return null;
}

export function resolveFamilyKey(item: ReviewHandoffItem): string | undefined {
  if (
    item.recurringTemplateId === "boi-rate-decision-v1" ||
    item.recurringTemplateId === "fed-rate-decision-v1" ||
    item.recurringTemplateId === "ecb-rate-decision-v1"
  ) {
    return item.recurringTemplateId;
  }

  if (item.lineageId?.trim()) {
    return toFamilyKeyIdentifier(item.lineageId);
  }

  if (item.recurringTemplateId?.trim()) {
    return item.recurringTemplateId;
  }

  return undefined;
}

export function resolveEventIdentity(
  item: ReviewHandoffItem,
  params: {
    closeAt: string | null;
    familyKey?: string | null;
    question: string;
    resolutionSource?: string | null;
  }
): {
  eventId: string;
  eventTitle: string;
  eventDescription: string | null;
  eventResolutionPolicy: EventResolutionPolicy;
  eventChildLabel: string;
} {
  const closeDate = closeDateKeyFromIso(params.closeAt) ?? closeDateKeyFromShape(item.suggestedCloseShape) ?? "unknown-date";
  const familyKey = params.familyKey ?? resolveFamilyKey(item) ?? item.recurringTemplateId ?? item.lineageId ?? item.category;
  const sourceKey = normalizeSourceUrlForFingerprint(
    params.resolutionSource ?? item.suggestedResolutionAnchor ?? item.topSourceRefs?.[0]
  );
  const eventStableKey = [familyKey, closeDate, item.lineageId ?? "", sourceKey].filter(Boolean).join(":");
  const eventTitle = item.contract?.measurement?.trim() || item.headline.replace(/^Review:\s*/i, "").trim() || params.question;

  return {
    eventId: toBackendIdentifier(eventStableKey, "event"),
    eventTitle,
    eventDescription: item.decisionSummary?.trim() || item.whyNow?.trim() || null,
    eventResolutionPolicy: resolveEventPolicyMarker(item) ?? "independent_children",
    eventChildLabel: params.question
  };
}

function readCalendarFamilyKey(item: CreationReadinessDuplicateInput): string | null {
  const normalizedQuestion = normalizeFingerprintText(item.question);
  const normalizedSource = normalizeFingerprintText(item.suggestedResolutionAnchor);

  if (
    item.candidateMarketId.includes("boi_rate_decision") ||
    ((normalizedQuestion.includes("ריבית") || normalizedQuestion.includes("החלטת בנק ישראל")) &&
      normalizedSource.includes("boi.org"))
  ) {
    return "boi-rate-decision-v1";
  }

  if (item.candidateMarketId.includes("fed_rate_decision")) {
    return "fed-rate-decision-v1";
  }

  if (item.candidateMarketId.includes("ecb_rate_decision")) {
    return "ecb-rate-decision-v1";
  }

  if (item.candidateMarketId.includes("knesset")) {
    return "knesset-dissolution-before-date-v1";
  }

  return null;
}

export function buildReadinessDuplicateKey(item: CreationReadinessDuplicateInput): string | null {
  const closeDate = closeDateKeyFromShape(item.suggestedCloseShape);

  if (!closeDate) {
    return null;
  }

  const normalizedQuestion = normalizeFingerprintText(item.question);
  const familyFromCandidate = readCalendarFamilyKey(item);

  if (familyFromCandidate) {
    return `calendar:${familyFromCandidate}:${closeDate}`;
  }

  const sourceKey = normalizeSourceUrlForFingerprint(item.suggestedResolutionAnchor);

  return `market:${closeDate}:${sourceKey}:${normalizedQuestion}`;
}
