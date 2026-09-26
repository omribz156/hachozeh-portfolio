import type {
  PlannedEvent,
  PlannedEventFamily,
  PlannedMarketBinding,
  PlannedRegistrySnapshot,
  ReviewHandoffItem
} from "./contracts";
import { isPlannedLane } from "./intake-lanes";
import { slugify } from "./text";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeFingerprintText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[״"]/g, "")
    .replace(/\s+/g, " ");
}

function extractGroundingValue(item: ReviewHandoffItem, key: string): string | null {
  const prefix = `grounding: ${key}=`;
  const value = [...(item.topRisks ?? []), ...(item.reviewHints ?? [])].find((entry) => entry.startsWith(prefix));

  return value?.slice(prefix.length).trim() ?? null;
}

function normalizeDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const directIso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);

  if (directIso?.[1]) {
    return directIso[1];
  }

  const parsed = new Date(`${value} UTC`);

  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

function normalizedSourceRefs(item: ReviewHandoffItem): string[] {
  return unique([
    ...(item.topSourceRefs ?? []),
    item.contract?.resolutionSource.url ?? "",
    item.suggestedResolutionAnchor ?? ""
  ].filter((value) => value.trim().length > 0));
}

function familyIdForItem(item: ReviewHandoffItem): string {
  return item.recurringTemplateId
    ? `family_${slugify(item.recurringTemplateId)}`
    : `family_${slugify(item.lineageId ?? item.category)}`;
}

function eventKeyForItem(item: ReviewHandoffItem): string {
  const explicitEventDate = extractGroundingValue(item, "event-date");
  const closeDate = item.contract?.timeline.closeAt?.slice(0, 10) ?? "";
  const eventDateKey = normalizeDateKey(explicitEventDate) ?? closeDate;
  const sourceKey = normalizedSourceRefs(item)[0] ?? item.candidateMarketId;
  const isCalendarTemplate =
    item.recurringTemplateId === "boi-rate-decision-v1" ||
    item.recurringTemplateId === "fed-rate-decision-v1" ||
    item.recurringTemplateId === "ecb-rate-decision-v1" ||
    item.recurringTemplateId === "knesset-dissolution-before-date-v1";

  if (isCalendarTemplate) {
    return slugify(`${familyIdForItem(item)}_${eventDateKey}`);
  }

  return slugify(`${familyIdForItem(item)}_${eventDateKey}_${sourceKey}`);
}

function marketFamilyKeyForItem(item: ReviewHandoffItem): string {
  return item.recurringTemplateId ?? item.marketForm;
}

export function plannedDuplicateKeyForReviewItem(item: ReviewHandoffItem): string | null {
  if (!isPlannedLane(item.intakeLane)) {
    return null;
  }

  if (!item.contract?.resolutionSource.url) {
    return null;
  }

  return `planned:${familyIdForItem(item)}:event_${eventKeyForItem(item)}:${marketFamilyKeyForItem(item)}`;
}

export function buildPlannedRegistrySnapshotFromReviewItems(
  items: ReviewHandoffItem[],
  generatedAt: string
): PlannedRegistrySnapshot {
  const plannedItems = items.filter(
    (item) => isPlannedLane(item.intakeLane) && Boolean(item.contract?.resolutionSource.url)
  );
  const familyMap = new Map<string, PlannedEventFamily>();
  const eventMap = new Map<string, PlannedEvent>();
  const marketBindings: PlannedMarketBinding[] = [];

  for (const item of plannedItems) {
    const familyId = familyIdForItem(item);
    const eventId = `event_${eventKeyForItem(item)}`;
    const sourceIds = unique([...(item.topSourceIds ?? []), ...(item.contract?.resolutionSource.sourceIds ?? [])]);
    const sourceRefs = normalizedSourceRefs(item);
    const existingFamily = familyMap.get(familyId);
    const existingEvent = eventMap.get(eventId);

    familyMap.set(familyId, {
      objectType: "planned_event_family",
      familyId,
      label: item.recurringTemplateId ?? item.lineageId ?? item.category,
      category: item.category,
      recurringTemplateId: item.recurringTemplateId,
      sourceIds: unique([...(existingFamily?.sourceIds ?? []), ...sourceIds]),
      sourceRefs: unique([...(existingFamily?.sourceRefs ?? []), ...sourceRefs]),
      createdAt: existingFamily?.createdAt ?? item.createdAt,
      updatedAt: generatedAt
    });

    eventMap.set(eventId, {
      objectType: "planned_event",
      eventId,
      familyId,
      label: extractGroundingValue(item, "event-date") ?? item.contract?.timeline.closeShape ?? item.question,
      category: item.category,
      status: "confirmed",
      scheduledAt: item.contract?.timeline.closeAt ?? null,
      closeShape: item.contract?.timeline.closeShape || item.suggestedCloseShape,
      sourceIds: unique([...(existingEvent?.sourceIds ?? []), ...sourceIds]),
      sourceRefs: unique([...(existingEvent?.sourceRefs ?? []), ...sourceRefs]),
      createdAt: existingEvent?.createdAt ?? item.createdAt,
      updatedAt: generatedAt
    });

    const marketFamilyKey = marketFamilyKeyForItem(item);
    const duplicateKey = `planned:${familyId}:${eventId}:${marketFamilyKey}`;

    marketBindings.push({
      objectType: "planned_market_binding",
      bindingId: `pmb_${slugify(`${eventId}_${marketFamilyKey}_${item.candidateMarketId}`)}`,
      familyId,
      eventId,
      candidateMarketId: item.candidateMarketId,
      reviewItemId: item.reviewItemId,
      marketFamilyKey,
      question: item.question,
      category: item.category,
      recurringTemplateId: item.recurringTemplateId,
      resolutionAuthorityType: item.contract?.resolutionAuthorityType,
      duplicateKey,
      sourceIds,
      sourceRefs,
      createdAt: item.createdAt
    });
  }

  const families = [...familyMap.values()].sort((left, right) => left.familyId.localeCompare(right.familyId));
  const events = [...eventMap.values()].sort((left, right) => left.eventId.localeCompare(right.eventId));

  return {
    objectType: "planned_registry_snapshot",
    snapshotId: `prs_${generatedAt.replace(/[^0-9]/g, "")}`,
    generatedAt,
    familyCount: families.length,
    eventCount: events.length,
    bindingCount: marketBindings.length,
    families,
    events,
    marketBindings: marketBindings.sort((left, right) =>
      normalizeFingerprintText(left.duplicateKey).localeCompare(normalizeFingerprintText(right.duplicateKey))
    )
  };
}
