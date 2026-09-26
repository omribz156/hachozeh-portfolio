import { afterEach, describe, expect, it, vi } from "vitest";

import { assessMarketWorthiness } from "../../../seer/src/market-worthiness";

afterEach(() => {
  vi.useRealTimers();
});

describe("assessMarketWorthiness", () => {
  it("flags weak candidates with explicit failure reasons", () => {
    const assessment = assessMarketWorthiness({
      observedAt: "2025-01-01T00:00:00Z",
      signalCount: 1,
      question: "Will people keep caring about this?",
      marketAngle: "",
      marketForm: "binary",
      proposedOutcomes: [{ label: "Yes", kind: "binary-side" }],
      resolutionFeasibility: "",
      suggestedResolutionAnchor: "",
      suggestedCloseShape: "",
      sourceClassesSeen: ["attention"],
      category: "culture",
      duplicateAssessment: "likely-duplicate",
      sensitivityLevel: "high",
      ambiguities: ["Question is vague."],
      riskFlags: []
    });

    expect(assessment.reviewReadiness).toBe("low");
    expect(assessment.marketShaping.tier).toBe("reject");
    expect(assessment.failureReasons).toEqual(
      expect.arrayContaining([
        "stale-window",
        "outcomes-not-clean",
        "resolution-path-weak",
        "likely-duplicate",
        "sensitivity-escalation"
      ])
    );
  });

  it("uses external reference shapes by category first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T00:00:00.000Z"));

    const assessment = assessMarketWorthiness({
      observedAt: "2026-04-08T00:00:00Z",
      signalCount: 2,
      question: "Will Israel win Eurovision 2026?",
      marketAngle: "Local-interest winner framing around Eurovision.",
      marketForm: "binary",
      proposedOutcomes: [
        { label: "Yes", kind: "binary-side" },
        { label: "No", kind: "binary-side" }
      ],
      resolutionFeasibility: "Official Eurovision final result settles this cleanly.",
      suggestedResolutionAnchor: "eurovision.tv final results",
      suggestedCloseShape: "Close before May 16, 2026 at 20:00.",
      sourceClassesSeen: ["authority", "attention"],
      category: "culture",
      platformShapeExamples: [
        {
          objectType: "platform_shape_example",
          platform: "kalshi",
          exampleId: "kalshi_pope",
          title: "Who will the next Pope be?",
          category: "elections",
          marketForm: "multi-outcome",
          sourceRef: "kalshi:event"
        },
        {
          objectType: "platform_shape_example",
          platform: "polymarket",
          exampleId: "poly_music",
          title: "Will Artist X release an album before June 2026?",
          category: "culture",
          marketForm: "binary",
          sourceRef: "polymarket:event"
        }
      ],
      duplicateAssessment: "distinct",
      sensitivityLevel: "normal",
      ambiguities: [],
      riskFlags: []
    });

    expect(assessment.marketShape.label).toBe("high");
    expect(assessment.marketShape.note).toContain("this category");
    expect(assessment.marketShaping.tier).toBe("publish-ready");
  });
});
