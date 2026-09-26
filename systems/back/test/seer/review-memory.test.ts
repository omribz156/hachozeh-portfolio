import { describe, expect, it } from "vitest";

import { buildReviewLearningMemoryFromData } from "../../../seer/src/review-memory";
import { seerTestSources, reviewMemoryFeedbackLog, reviewMemoryQueueHistory } from "../../../seer/src/test-fixtures";

describe("buildReviewLearningMemoryFromData", () => {
  it("turns feedback plus queue history into source and lineage overlays", () => {
    const memory = buildReviewLearningMemoryFromData(
      seerTestSources,
      reviewMemoryFeedbackLog,
      reviewMemoryQueueHistory
    );

    expect(memory.sourceMemory.get("src_boi_announcements")).toMatchObject({
      reviewCount: 2,
      approveCount: 1,
      duplicateCount: 1
    });

    expect(memory.lineageMemory.get("lin_boi_rate_decisions")).toMatchObject({
      reviewCount: 2,
      approveCount: 1,
      mergeCount: 1,
      duplicateCount: 1
    });
  });
});
