import { describe, expect, it } from "vitest";

import {
  buildPlannedRegistrySnapshotFromReviewItems,
  plannedDuplicateKeyForReviewItem
} from "../../../seer/src/planned-registry";
import type { ReviewHandoffItem } from "../../../seer/src/contracts";

function reviewItem(overrides: Partial<ReviewHandoffItem> = {}): ReviewHandoffItem {
  return {
    objectType: "review_handoff_item",
    reviewItemId: "rh_boi_may",
    candidateMarketId: "cm_boi_may",
    intakeLane: "planned-event",
    recurringTemplateId: "boi-rate-decision-v1",
    category: "economy",
    headline: "BOI May",
    question: "החלטת בנק ישראל במאי?",
    marketForm: "multi-outcome",
    proposedOutcomes: [
      { label: "ירידה של 0.25%", kind: "named-outcome" },
      { label: "ללא שינוי", kind: "named-outcome" },
      { label: "עלייה של 0.25%", kind: "named-outcome" }
    ],
    whyNow: "Official schedule.",
    decisionSummary: "Ready.",
    maturity: "review-ready",
    confidence: "high",
    authorityReadiness: "high",
    lineageContext: "new-market",
    topSupport: "BOI schedule.",
    topRisks: ["grounding: event-date=May 25, 2026"],
    contract: {
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      measurement: "החלטת בנק ישראל במאי?",
      resolutionAuthorityType: "official",
      resolutionSource: {
        label: "Bank of Israel",
        url: "https://www.boi.org.il/",
        sourceIds: ["src_boi_announcements"]
      },
      resolutionRule: "Official BOI announcement settles this market.",
      timeline: {
        closeShape: "Close before May 25, 2026 at 16:00.",
        closeAt: "2026-05-25T16:00:00.000Z",
        timezone: "UTC"
      },
      outcomeMap: [],
      delayPolicy: "Wait for official publication.",
      payoutPolicy: "התשלום מתבצע רק לאחר פרסום תוצאה רשמית ואישור מפעיל.",
      reviewBlockers: []
    },
    recommendedAction: "approve",
    recommendedActionWhy: "Ready.",
    createdAt: "2026-05-01T00:00:00.000Z",
    lineageId: "lin_boi_rate_decisions",
    suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
    suggestedResolutionAnchor: "Bank of Israel: https://www.boi.org.il/",
    topSourceRefs: ["https://www.boi.org.il/"],
    topSourceIds: ["src_boi_announcements"],
    ...overrides
  };
}

describe("planned registry", () => {
  it("builds family/event/market bindings from source-confirmed planned review items", () => {
    const snapshot = buildPlannedRegistrySnapshotFromReviewItems(
      [
        reviewItem(),
        reviewItem({
          reviewItemId: "rh_live",
          candidateMarketId: "cm_live",
          intakeLane: "shock-discovery"
        })
      ],
      "2026-05-06T10:00:00.000Z"
    );

    expect(snapshot.familyCount).toBe(1);
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.bindingCount).toBe(1);
    expect(snapshot.families[0]?.familyId).toBe("family_boi_rate_decision_v1");
    expect(snapshot.events[0]?.status).toBe("confirmed");
    expect(snapshot.marketBindings[0]?.duplicateKey).toContain("boi-rate-decision-v1");
    expect(snapshot.marketBindings[0]?.resolutionAuthorityType).toBe("official");
  });

  it("uses the same planned duplicate key for same calendar event variants", () => {
    const first = reviewItem({
      candidateMarketId: "cm_boi_may_a",
      suggestedCloseShape: "Close before May 25, 2026 at 16:00."
    });
    const second = reviewItem({
      candidateMarketId: "cm_boi_may_b",
      question: "ריבית בנק ישראל: 25 במאי",
      suggestedCloseShape: "Close before May 25, 2026 at 13:00.",
      contract: {
        ...reviewItem().contract!,
        timeline: {
          closeShape: "Close before May 25, 2026 at 13:00.",
          closeAt: "2026-05-25T13:00:00.000Z",
          timezone: "UTC"
        }
      }
    });

    expect(plannedDuplicateKeyForReviewItem(first)).toBe(plannedDuplicateKeyForReviewItem(second));
  });
});
