import {
  appendReworkAttempt,
  persistPlannedRegistrySnapshot,
  persistReviewQueueSnapshot,
  readReviewFeedbackLog,
  readReviewQueueHistory,
  readReworkAttemptLog
} from "./persistence";
import {
  buildSeerClusters,
  buildLayeredReviewQueueFromClusters
} from "./pipeline";
import { buildPlannedRegistrySnapshotFromReviewItems } from "./planned-registry";
import { buildMissingReworkAttempts } from "./rework-loop";
import { buildReviewLearningMemory } from "./review-memory";
import { listSeerSources } from "./source-registry";

export async function ensureReworkAttemptsBackfilled(): Promise<void> {
  const [feedbackLog, queueHistory, existingAttempts] = await Promise.all([
    readReviewFeedbackLog(),
    readReviewQueueHistory(),
    readReworkAttemptLog()
  ]);
  const missingAttempts = buildMissingReworkAttempts(feedbackLog, queueHistory, existingAttempts);

  for (const attempt of missingAttempts) {
    await appendReworkAttempt(attempt);
  }
}

export async function buildQueueSectionsFromFeedback(generatedAt: string) {
  await ensureReworkAttemptsBackfilled();
  const sources = await listSeerSources();
  const learningMemory = await buildReviewLearningMemory(sources);
  const clusters = await buildSeerClusters();
  const reviewQueueSections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);
  const reviewQueue = [...reviewQueueSections.active, ...reviewQueueSections.rework];
  const reviewQueueSnapshot = await persistReviewQueueSnapshot(reviewQueue, generatedAt, reviewQueueSections);
  const plannedRegistrySnapshot = await persistPlannedRegistrySnapshot(
    buildPlannedRegistrySnapshotFromReviewItems(
      [...reviewQueueSections.active, ...reviewQueueSections.rework, ...reviewQueueSections.reviewed],
      generatedAt
    )
  );

  return {
    reviewQueue,
    reviewQueueSections,
    reviewQueueSnapshot,
    plannedRegistrySnapshot
  };
}
