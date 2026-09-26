import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  ManualSeerSignal,
  MarketCreationDraft,
  MarketCreationDraftSnapshot,
  OperatorLead,
  PlannedRegistrySnapshot,
  PlatformShapeSnapshot,
  ReworkAttemptItem,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSections,
  ReviewQueueSnapshot,
  SourceFamilyRequest,
  SourceFamilyRequestSnapshot,
  SourceRegistryEntry
} from "./contracts";

const feedbackLogPath = resolve(__dirname, "..", "state", "review-feedback.jsonl");
const reviewQueueHistoryPath = resolve(__dirname, "..", "state", "review-queue-history.jsonl");
const latestReviewQueuePath = resolve(__dirname, "..", "state", "review-queue-latest.json");
const sourceRegistryLogPath = resolve(__dirname, "..", "state", "source-registry.jsonl");
const manualSignalLogPath = resolve(__dirname, "..", "state", "manual-signals.jsonl");
const reworkAttemptLogPath = resolve(__dirname, "..", "state", "rework-attempts.jsonl");
const latestPlatformShapesPath = resolve(__dirname, "..", "state", "platform-shapes-latest.json");
const marketCreationDraftHistoryPath = resolve(__dirname, "..", "state", "market-creation-drafts-history.jsonl");
const latestMarketCreationDraftsPath = resolve(__dirname, "..", "state", "market-creation-drafts-latest.json");
const plannedRegistryHistoryPath = resolve(__dirname, "..", "state", "planned-registry-history.jsonl");
const latestPlannedRegistryPath = resolve(__dirname, "..", "state", "planned-registry-latest.json");
const operatorLeadLogPath = resolve(__dirname, "..", "state", "operator-leads.jsonl");
const latestOperatorLeadsPath = resolve(__dirname, "..", "state", "operator-leads-latest.json");
const sourceFamilyRequestHistoryPath = resolve(__dirname, "..", "state", "source-family-requests-history.jsonl");
const latestSourceFamilyRequestsPath = resolve(__dirname, "..", "state", "source-family-requests-latest.json");
const maxHistoryBytes = Number(process.env.SEER_STATE_MAX_HISTORY_BYTES ?? 10 * 1024 * 1024);
const rotationKeep = Math.max(1, Number(process.env.SEER_LOG_ROTATION_KEEP ?? 3));

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true
  });
}

async function rotateAppendOnlyFile(path: string): Promise<void> {
  if (!Number.isFinite(maxHistoryBytes) || maxHistoryBytes <= 0) {
    return;
  }

  try {
    const current = await stat(path);

    if (current.size >= maxHistoryBytes) {
      // Shift existing backups: .{keep-1} → drop, .{keep-2} → .{keep-1}, ..., .1 → .2, base → .1
      // SEER_LOG_ROTATION_KEEP controls how many numbered backups survive (default 3).
      for (let index = rotationKeep - 1; index >= 1; index--) {
        const src = `${path}.${index}`;
        const dst = `${path}.${index + 1}`;
        try {
          await stat(src);
          await rename(src, dst);
        } catch {
          // src doesn't exist yet — nothing to shift
        }
      }
      await rename(path, `${path}.1`);
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

async function appendStateLine(path: string, contents: string): Promise<void> {
  await ensureParent(path);
  await rotateAppendOnlyFile(path);
  await writeFile(path, contents.endsWith("\n") ? contents : `${contents}\n`, {
    flag: "a",
    encoding: "utf8"
  });
}

export async function appendReviewFeedback(item: ReviewFeedbackItem): Promise<void> {
  await appendStateLine(feedbackLogPath, JSON.stringify(item));
}

async function readJsonLines<T>(
  path: string,
  validateRecord?: (record: unknown) => record is T
): Promise<T[]> {
  try {
    const contents = await readFile(path, "utf8");
    const results: T[] = [];

    for (const raw of contents.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn(`[seer/persistence] skipping malformed JSONL line in ${path}: JSON.parse failed`);
        continue;
      }

      if (validateRecord !== undefined) {
        if (!validateRecord(parsed)) {
          console.warn(`[seer/persistence] skipping invalid record in ${path}: failed shape check`);
          continue;
        }
        results.push(parsed);
      } else {
        results.push(parsed as T);
      }
    }

    return results;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isReviewFeedbackItem(r: unknown): r is ReviewFeedbackItem {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as Record<string, unknown>)["objectType"] === "review_feedback_item" &&
    typeof (r as Record<string, unknown>)["reviewFeedbackId"] === "string" &&
    typeof (r as Record<string, unknown>)["reviewItemId"] === "string" &&
    typeof (r as Record<string, unknown>)["candidateMarketId"] === "string" &&
    typeof (r as Record<string, unknown>)["reviewedAt"] === "string"
  );
}

export async function readReviewFeedbackLog(): Promise<ReviewFeedbackItem[]> {
  return readJsonLines<ReviewFeedbackItem>(feedbackLogPath, isReviewFeedbackItem);
}

export async function appendReworkAttempt(item: ReworkAttemptItem): Promise<void> {
  await appendStateLine(reworkAttemptLogPath, JSON.stringify(item));
}

function isReworkAttemptItem(r: unknown): r is ReworkAttemptItem {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as Record<string, unknown>)["objectType"] === "rework_attempt_item" &&
    typeof (r as Record<string, unknown>)["reworkAttemptId"] === "string" &&
    typeof (r as Record<string, unknown>)["candidateMarketId"] === "string" &&
    typeof (r as Record<string, unknown>)["basedOnReviewFeedbackId"] === "string" &&
    typeof (r as Record<string, unknown>)["generatedAt"] === "string"
  );
}

export async function readReworkAttemptLog(): Promise<ReworkAttemptItem[]> {
  const attempts = await readJsonLines<ReworkAttemptItem>(reworkAttemptLogPath, isReworkAttemptItem);
  const deduped = new Map<string, ReworkAttemptItem>();

  for (const attempt of attempts) {
    deduped.set(attempt.basedOnReviewFeedbackId, attempt);
  }

  return [...deduped.values()];
}

export async function appendSourceRegistryEntry(entry: SourceRegistryEntry): Promise<void> {
  await appendStateLine(sourceRegistryLogPath, JSON.stringify(entry));
}

function isSourceRegistryEntry(r: unknown): r is SourceRegistryEntry {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as Record<string, unknown>)["objectType"] === "source_registry_entry" &&
    typeof (r as Record<string, unknown>)["sourceId"] === "string" &&
    typeof (r as Record<string, unknown>)["label"] === "string" &&
    typeof (r as Record<string, unknown>)["createdAt"] === "string"
  );
}

export async function readSourceRegistryEntries(): Promise<SourceRegistryEntry[]> {
  return readJsonLines<SourceRegistryEntry>(sourceRegistryLogPath, isSourceRegistryEntry);
}

export async function appendManualSeerSignals(items: ManualSeerSignal[]): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const contents = items.map((item) => JSON.stringify(item)).join("\n");
  await appendStateLine(manualSignalLogPath, contents);
}

function isManualSeerSignal(r: unknown): r is ManualSeerSignal {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as Record<string, unknown>)["objectType"] === "manual_seer_signal" &&
    typeof (r as Record<string, unknown>)["signalId"] === "string" &&
    typeof (r as Record<string, unknown>)["sourceId"] === "string" &&
    typeof (r as Record<string, unknown>)["title"] === "string" &&
    typeof (r as Record<string, unknown>)["importedAt"] === "string"
  );
}

export async function readManualSeerSignals(): Promise<ManualSeerSignal[]> {
  return readJsonLines<ManualSeerSignal>(manualSignalLogPath, isManualSeerSignal);
}

export async function appendOperatorLead(item: OperatorLead): Promise<void> {
  await appendStateLine(operatorLeadLogPath, JSON.stringify(item));

  await writeFile(latestOperatorLeadsPath, JSON.stringify(await readOperatorLeads(), null, 2), "utf8");
}

function isOperatorLead(r: unknown): r is OperatorLead {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as Record<string, unknown>)["objectType"] === "operator_lead" &&
    typeof (r as Record<string, unknown>)["leadId"] === "string" &&
    typeof (r as Record<string, unknown>)["createdAt"] === "string" &&
    typeof (r as Record<string, unknown>)["rawPrompt"] === "string"
  );
}

export async function readOperatorLeads(): Promise<OperatorLead[]> {
  return readJsonLines<OperatorLead>(operatorLeadLogPath, isOperatorLead);
}

export async function persistReviewQueueSnapshot(
  items: ReviewHandoffItem[],
  generatedAt: string,
  queueSections?: ReviewQueueSections
): Promise<ReviewQueueSnapshot> {
  const snapshot: ReviewQueueSnapshot = {
    objectType: "review_queue_snapshot",
    snapshotId: `rqs_${generatedAt.replace(/[^0-9]/g, "")}`,
    generatedAt,
    itemCount: items.length,
    items,
    queueSections
  };

  await appendStateLine(reviewQueueHistoryPath, JSON.stringify(snapshot));
  await writeFile(latestReviewQueuePath, JSON.stringify(snapshot, null, 2), "utf8");

  return snapshot;
}

export async function readReviewQueueHistory(): Promise<ReviewQueueSnapshot[]> {
  return readJsonLines<ReviewQueueSnapshot>(reviewQueueHistoryPath);
}

export async function readLatestReviewQueueSnapshot(): Promise<ReviewQueueSnapshot | null> {
  try {
    const contents = await readFile(latestReviewQueuePath, "utf8");
    return JSON.parse(contents) as ReviewQueueSnapshot;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function persistLatestPlatformShapeSnapshots(items: PlatformShapeSnapshot[]): Promise<void> {
  await ensureParent(latestPlatformShapesPath);
  await writeFile(latestPlatformShapesPath, JSON.stringify(items, null, 2), "utf8");
}

export async function readLatestPlatformShapeSnapshots(): Promise<PlatformShapeSnapshot[]> {
  try {
    const contents = await readFile(latestPlatformShapesPath, "utf8");
    return JSON.parse(contents) as PlatformShapeSnapshot[];
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function persistMarketCreationDraftSnapshot(
  items: MarketCreationDraft[],
  generatedAt: string
): Promise<MarketCreationDraftSnapshot> {
  const snapshot: MarketCreationDraftSnapshot = {
    objectType: "market_creation_draft_snapshot",
    snapshotId: `mcds_${generatedAt.replace(/[^0-9]/g, "")}`,
    generatedAt,
    itemCount: items.length,
    items
  };

  await appendStateLine(marketCreationDraftHistoryPath, JSON.stringify(snapshot));
  await writeFile(latestMarketCreationDraftsPath, JSON.stringify(snapshot, null, 2), "utf8");

  return snapshot;
}

export async function readMarketCreationDraftHistory(): Promise<MarketCreationDraftSnapshot[]> {
  return readJsonLines<MarketCreationDraftSnapshot>(marketCreationDraftHistoryPath);
}

export async function readLatestMarketCreationDraftSnapshot(): Promise<MarketCreationDraftSnapshot | null> {
  try {
    const contents = await readFile(latestMarketCreationDraftsPath, "utf8");
    return JSON.parse(contents) as MarketCreationDraftSnapshot;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function persistPlannedRegistrySnapshot(snapshot: PlannedRegistrySnapshot): Promise<PlannedRegistrySnapshot> {
  await appendStateLine(plannedRegistryHistoryPath, JSON.stringify(snapshot));
  await writeFile(latestPlannedRegistryPath, JSON.stringify(snapshot, null, 2), "utf8");

  return snapshot;
}

export async function readPlannedRegistryHistory(): Promise<PlannedRegistrySnapshot[]> {
  return readJsonLines<PlannedRegistrySnapshot>(plannedRegistryHistoryPath);
}

export async function readLatestPlannedRegistrySnapshot(): Promise<PlannedRegistrySnapshot | null> {
  try {
    const contents = await readFile(latestPlannedRegistryPath, "utf8");
    return JSON.parse(contents) as PlannedRegistrySnapshot;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function persistSourceFamilyRequestSnapshot(
  items: SourceFamilyRequest[],
  generatedAt: string
): Promise<SourceFamilyRequestSnapshot> {
  const snapshot: SourceFamilyRequestSnapshot = {
    objectType: "source_family_request_snapshot",
    snapshotId: `sfrs_${generatedAt.replace(/[^0-9]/g, "")}`,
    generatedAt,
    itemCount: items.length,
    items
  };

  await appendStateLine(sourceFamilyRequestHistoryPath, JSON.stringify(snapshot));
  await writeFile(latestSourceFamilyRequestsPath, JSON.stringify(snapshot, null, 2), "utf8");

  return snapshot;
}

export async function readLatestSourceFamilyRequestSnapshot(): Promise<SourceFamilyRequestSnapshot | null> {
  try {
    const contents = await readFile(latestSourceFamilyRequestsPath, "utf8");
    return JSON.parse(contents) as SourceFamilyRequestSnapshot;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function getReviewFeedbackLogPath(): string {
  return feedbackLogPath;
}

export function getReviewQueueHistoryPath(): string {
  return reviewQueueHistoryPath;
}

export function getLatestReviewQueuePath(): string {
  return latestReviewQueuePath;
}

export function getSourceRegistryLogPath(): string {
  return sourceRegistryLogPath;
}

export function getManualSignalLogPath(): string {
  return manualSignalLogPath;
}

export function getOperatorLeadLogPath(): string {
  return operatorLeadLogPath;
}

export function getLatestOperatorLeadsPath(): string {
  return latestOperatorLeadsPath;
}

export function getReworkAttemptLogPath(): string {
  return reworkAttemptLogPath;
}

export function getLatestPlatformShapesPath(): string {
  return latestPlatformShapesPath;
}

export function getMarketCreationDraftHistoryPath(): string {
  return marketCreationDraftHistoryPath;
}

export function getLatestMarketCreationDraftsPath(): string {
  return latestMarketCreationDraftsPath;
}

export function getLatestPlannedRegistryPath(): string {
  return latestPlannedRegistryPath;
}

export function getPlannedRegistryHistoryPath(): string {
  return plannedRegistryHistoryPath;
}

export function getLatestSourceFamilyRequestsPath(): string {
  return latestSourceFamilyRequestsPath;
}

export function getSourceFamilyRequestHistoryPath(): string {
  return sourceFamilyRequestHistoryPath;
}
