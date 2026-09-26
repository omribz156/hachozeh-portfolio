import type { SourceRegistryEntry } from "./contracts";
import { readSourceRegistryEntries } from "./persistence";
import { buildReviewLearningMemory } from "./review-memory";

import { seededSeerSourceRegistry } from "./seed/source-registry-data";

export { seededSeerSourceRegistry };

function entryTimestamp(entry: SourceRegistryEntry): number {
  const parsed = Date.parse(entry.updatedAt || entry.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeSourceRegistryEntry(
  seeded: SourceRegistryEntry,
  manual: SourceRegistryEntry
): SourceRegistryEntry {
  const seededIsNewer = entryTimestamp(seeded) >= entryTimestamp(manual);
  const mergedBase = seededIsNewer ? { ...manual, ...seeded } : { ...seeded, ...manual };
  const mergedUpdatedAt = new Date(Math.max(entryTimestamp(seeded), entryTimestamp(manual))).toISOString();
  const lifecycleCapabilities =
    !manual.lifecycleCapabilities?.length
      ? seeded.lifecycleCapabilities
      : !seeded.lifecycleCapabilities?.length
        ? manual.lifecycleCapabilities
        : entryTimestamp(seeded) > entryTimestamp(manual)
          ? seeded.lifecycleCapabilities
          : manual.lifecycleCapabilities;

  return {
    ...mergedBase,
    lifecycleCapabilities,
    updatedAt: mergedUpdatedAt,
    flags: [...new Set([...(seeded.flags ?? []), ...(manual.flags ?? [])])],
    domainNotes: [...new Set([...(seeded.domainNotes ?? []), ...(manual.domainNotes ?? [])])]
  };
}

export async function listSeerSources(): Promise<SourceRegistryEntry[]> {
  const manualEntries = await readSourceRegistryEntries();
  const merged = new Map<string, SourceRegistryEntry>();

  for (const entry of seededSeerSourceRegistry) {
    merged.set(entry.sourceId, entry);
  }

  for (const entry of manualEntries) {
    const seeded = merged.get(entry.sourceId);
    merged.set(entry.sourceId, seeded ? mergeSourceRegistryEntry(seeded, entry) : entry);
  }

  const sources = [...merged.values()];
  const learningMemory = await buildReviewLearningMemory(sources);

  return sources.map((source) => {
    const memory = learningMemory.sourceMemory.get(source.sourceId);

    if (!memory) {
      return source;
    }

    const reviewNotes = [
      ...(source.reviewNotes ?? []),
      `review-memory: approvals=${memory.approveCount}, rejects=${memory.rejectCount}, holds=${memory.holdCount}, duplicate-pressure=${memory.duplicateCount}`
    ];
    const flags = new Set(source.flags ?? []);

    if (memory.rejectCount > memory.approveCount) {
      flags.add("manual-review-needed");
    }

    if (memory.duplicateCount > 0) {
      flags.add("duplicate-surface");
    }

    if (memory.groundingIssueCount > 0) {
      flags.add("authority-gap");
    }

    return {
      ...source,
      lastSeenAt: memory.lastReviewedAt,
      lastUsefulAt: memory.lastUsefulAt ?? source.lastUsefulAt,
      reviewNotes,
      flags: [...flags]
    };
  });
}

export async function findSeerSource(sourceId: string): Promise<SourceRegistryEntry | undefined> {
  const sources = await listSeerSources();
  return sources.find((source) => source.sourceId === sourceId);
}
