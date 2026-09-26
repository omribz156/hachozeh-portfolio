import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSeerClustersFromSignals,
  buildLayeredReviewQueueFromClusters
} from "../../../seer/src/pipeline";
import { buildReviewLearningMemoryFromData } from "../../../seer/src/review-memory";
import { buildReworkAttempt, shouldCreateReworkAttempt } from "../../../seer/src/rework-loop";
import { seerTestSources, duplicatePressureSignals } from "../../../seer/src/test-fixtures";

afterEach(() => {
  vi.useRealTimers();
});

describe("rework loop", () => {
  it("only treats edit / rework / reject actions as real rework emitters", () => {
    expect(shouldCreateReworkAttempt("approve")).toBe(false);
    expect(shouldCreateReworkAttempt("hold")).toBe(false);
    expect(shouldCreateReworkAttempt("merge")).toBe(false);
    expect(shouldCreateReworkAttempt("approve-with-edits")).toBe(true);
    expect(shouldCreateReworkAttempt("request-rework")).toBe(true);
    expect(shouldCreateReworkAttempt("reject")).toBe(true);
  });

  it("auto-normalizes coarse BOI rate outcomes into explicit percentage steps", () => {
    const reviewItem = {
      objectType: "review_handoff_item" as const,
      reviewItemId: "rh_boi_mar_primary",
      candidateMarketId: "cm_boi_mar_primary",
      lineageId: "lin_boi_rate_decisions",
      category: "economy",
      headline: "Review: BOI March primary",
      question: "What will the Bank of Israel do at its March 30, 2026 rate decision?",
      marketForm: "multi-outcome" as const,
      proposedOutcomes: [
        { label: "Rate cut", kind: "named-outcome" as const },
        { label: "No change", kind: "named-outcome" as const },
        { label: "Rate hike", kind: "named-outcome" as const }
      ],
      whyNow: "Decision window is near.",
      decisionSummary: "Strong candidate, weak outcome precision.",
      maturity: "review-ready" as const,
      confidence: "medium" as const,
      authorityReadiness: "high" as const,
      lineageContext: "new-market" as const,
      topSupport: "Official BOI timing.",
      topRisks: [],
      recommendedAction: "approve-with-edits" as const,
      recommendedActionWhy: "Need explicit outcome steps.",
      suggestedCloseShape: "Close before March 30, 2026.",
      suggestedResolutionAnchor: "Bank of Israel official announcement.",
      sensitivityLevel: "normal" as const,
      createdAt: "2026-03-28T10:22:00Z"
    };
    const feedback = {
      objectType: "review_feedback_item" as const,
      reviewFeedbackId: "rf_boi_outcomes",
      reviewItemId: "rh_boi_mar_primary",
      candidateMarketId: "cm_boi_mar_primary",
      action: "approve-with-edits" as const,
      reasonCategory: "outcome-structure-needs-improvement" as const,
      reasonSummary: "go for % (eg. -025% point / no change / +0.25% point)",
      reviewedAt: "2026-04-08T09:30:33.513Z",
      lineageId: "lin_boi_rate_decisions"
    };

    const attempt = buildReworkAttempt(feedback, reviewItem);

    expect(attempt.status).toBe("auto-revised");
    expect(attempt.revisedOutcomes?.map((outcome) => outcome.label)).toEqual([
      "50+ bps decrease",
      "25 bps decrease",
      "No change",
      "25 bps increase",
      "50+ bps increase"
    ]);
  });

  it("promotes materially revised candidates back into active review", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00.000Z"));

    const queueItem = {
      objectType: "review_handoff_item" as const,
      reviewItemId: "rh_boi_mar_primary",
      candidateMarketId: "cm_boi_mar_primary",
      lineageId: "lin_boi_rate_decisions",
      category: "economy",
      headline: "Review: BOI March primary",
      question: "What will the Bank of Israel do at its March 30, 2026 rate decision?",
      marketForm: "multi-outcome" as const,
      proposedOutcomes: [
        { label: "Rate cut", kind: "named-outcome" as const },
        { label: "No change", kind: "named-outcome" as const },
        { label: "Rate hike", kind: "named-outcome" as const }
      ],
      whyNow: "Decision window is near.",
      decisionSummary: "Strong candidate, weak outcome precision.",
      maturity: "review-ready" as const,
      confidence: "medium" as const,
      authorityReadiness: "high" as const,
      lineageContext: "new-market" as const,
      topSupport: "Official BOI timing.",
      topRisks: [],
      recommendedAction: "approve-with-edits" as const,
      recommendedActionWhy: "Need explicit outcome steps.",
      suggestedCloseShape: "Close before March 30, 2026.",
      suggestedResolutionAnchor: "Bank of Israel official announcement.",
      sensitivityLevel: "normal" as const,
      createdAt: "2026-03-28T10:22:00Z"
    };
    const feedback = {
      objectType: "review_feedback_item" as const,
      reviewFeedbackId: "rf_boi_outcomes",
      reviewItemId: "rh_boi_mar_primary",
      candidateMarketId: "cm_boi_mar_primary",
      action: "approve-with-edits" as const,
      reasonCategory: "outcome-structure-needs-improvement" as const,
      reasonSummary: "go for % (eg. -025% point / no change / +0.25% point)",
      reviewedAt: "2026-04-08T09:30:33.513Z",
      lineageId: "lin_boi_rate_decisions"
    };
    const reworkAttempt = buildReworkAttempt(feedback, queueItem);
    const learningMemory = buildReviewLearningMemoryFromData(
      seerTestSources,
      [feedback],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_boi_primary",
          generatedAt: "2026-03-28T10:23:00Z",
          itemCount: 1,
          items: [queueItem]
        }
      ],
      [reworkAttempt]
    );
    const clusters = buildSeerClustersFromSignals(duplicatePressureSignals, learningMemory);
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);
    const promoted = sections.active.find((item) => item.candidateMarketId === "cm_boi_mar_primary");

    expect(promoted).toBeDefined();
    expect(promoted?.proposedOutcomes.map((outcome) => outcome.label)).toEqual([
      "50+ bps decrease",
      "25 bps decrease",
      "No change",
      "25 bps increase",
      "50+ bps increase"
    ]);
  });

  it("collapses arbitrary Eurovision country shortlist into an Israel binary replay", () => {
    const reviewItem = {
      objectType: "review_handoff_item" as const,
      reviewItemId: "rh_eurovision_2026_winner",
      candidateMarketId: "cm_eurovision_2026_winner",
      lineageId: "lin_eurovision_winner_markets",
      category: "politics",
      headline: "Review: Eurovision 2026 winner race",
      question: "Which country will win Eurovision 2026?",
      marketForm: "multi-outcome" as const,
      proposedOutcomes: [
        { label: "Sweden", kind: "named-outcome" as const },
        { label: "Israel", kind: "named-outcome" as const },
        { label: "Italy", kind: "named-outcome" as const },
        { label: "Other", kind: "named-outcome" as const }
      ],
      whyNow: "The event window is known and public attention is already warming up.",
      decisionSummary: "Good candidate, weak shortlist basis.",
      maturity: "review-ready" as const,
      confidence: "medium" as const,
      authorityReadiness: "high" as const,
      lineageContext: "new-market" as const,
      topSupport: "Official event source confirms the timeline and authority path.",
      topRisks: [],
      recommendedAction: "request-rework" as const,
      recommendedActionWhy: "Need cleaner outcome basis.",
      suggestedCloseShape: "Close before May 17, 2026.",
      suggestedResolutionAnchor: "Official Eurovision final scoreboard.",
      sensitivityLevel: "normal" as const,
      createdAt: "2026-03-28T11:10:00Z"
    };
    const feedback = {
      objectType: "review_feedback_item" as const,
      reviewFeedbackId: "rf_eurovision_rework",
      reviewItemId: "rh_eurovision_2026_winner",
      candidateMarketId: "cm_eurovision_2026_winner",
      action: "request-rework" as const,
      reasonCategory: "outcome-structure-needs-improvement" as const,
      reasonSummary: "why choose this specific countries ? on what basis",
      reviewedAt: "2026-04-08T09:28:00.256Z",
      lineageId: "lin_eurovision_winner_markets"
    };

    const attempt = buildReworkAttempt(feedback, reviewItem);

    expect(attempt.status).toBe("auto-revised");
    expect(attempt.revisedQuestion).toBe("Will Israel win Eurovision 2026?");
    expect(attempt.revisedOutcomes?.map((outcome) => outcome.label)).toEqual(["Yes", "No"]);
  });
});
