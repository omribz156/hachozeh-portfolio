import { describe, expect, it, vi } from "vitest";

import {
  buildLayeredReviewQueueFromClusters,
  buildSeerClustersFromSignals
} from "../../../seer/src/pipeline";
import { buildReviewLearningMemoryFromData } from "../../../seer/src/review-memory";
import { seerTestSources } from "../../../seer/src/test-fixtures";
import type { SeerSignal } from "../../../seer/src/pipeline";

function goldenSignal(overrides: Partial<SeerSignal>): SeerSignal {
  return {
    signalId: "sig_golden",
    signalOrigin: "manual",
    sourceId: "src_boi_announcements",
    intakeLane: "planned-event",
    clusterKey: "golden",
    lineageLabel: "golden",
    title: "Golden market",
    summary: "Golden market fixture.",
    category: "economy",
    sourceCategory: "economy",
    inferredCategory: "economy",
    whyNow: "Useful production-readiness fixture.",
    observedAt: "2026-05-03T10:00:00.000Z",
    sourceClass: "authority",
    sourceRef: "https://example.test/source",
    sourceLabel: "Official source",
    keyEntities: ["Golden"],
    sourceSummary: "Official source summary.",
    topicKind: "market-shaped",
    marketability: "already-shaped",
    inferenceNotes: ["Signal already carries explicit market shape."],
    question: "Will the golden event happen?",
    marketAngle: "Golden event outcome.",
    marketForm: "binary",
    proposedOutcomes: [
      { label: "Yes", kind: "binary-side" },
      { label: "No", kind: "binary-side" }
    ],
    marketWorthiness: "Clean bounded market.",
    resolutionFeasibility: "Official result settles it.",
    suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
    suggestedResolutionAnchor: "Official source: https://example.test/source",
    sensitivityLevel: "normal",
    ...overrides
  };
}

describe("Seer golden market contract evals", () => {
  it("separates contract-ready recurring/planned markets from noisy now-happening shocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        goldenSignal({
          signalId: "sig_boi_may",
          clusterKey: "boi-may-golden",
          lineageLabel: "boi_rate_decisions",
          recurringTemplateId: "boi-rate-decision-v1",
          title: "BOI May decision",
          question: "החלטת בנק ישראל במאי?",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "ירידה של 0.25%", kind: "named-outcome" },
            { label: "ללא שינוי", kind: "named-outcome" },
            { label: "עלייה של 0.25%", kind: "named-outcome" }
          ],
          suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/"
        }),
        goldenSignal({
          signalId: "sig_hormuz",
          sourceId: "src_imf_news",
          intakeLane: "shock-discovery",
          clusterKey: "hormuz-golden",
          lineageLabel: "hormuz_traffic_recovery",
          title: "Hormuz traffic recovery",
          question: "מתי תחזור תנועת הספינות במצר הורמוז לרמה רגילה?",
          marketForm: "date-bucket",
          proposedOutcomes: [
            { label: "עד 31 במאי 2026", kind: "date-bucket" },
            { label: "עד 30 ביוני 2026", kind: "date-bucket" },
            { label: "עד 31 ביולי 2026", kind: "date-bucket" }
          ],
          suggestedCloseShape: "Close before July 31, 2026 at 23:59.",
          suggestedResolutionAnchor: "IMF PortWatch: https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730",
          sourceRef: "https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730"
        }),
        goldenSignal({
          signalId: "sig_winner",
          sourceId: "src_winner_league_fixtures",
          category: "sports",
          sourceCategory: "sports",
          inferredCategory: "sports",
          clusterKey: "winner-golden",
          lineageLabel: "winner_league_fixture",
          recurringTemplateId: "sports-match-winner-v1",
          title: "Winner League fixture",
          question: "מכבי ת״א נגד גליל עליון?",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "מכבי ת״א", kind: "named-outcome" },
            { label: "גליל עליון", kind: "named-outcome" }
          ],
          suggestedCloseShape: "Close before May 18, 2026 at 20:30.",
          suggestedResolutionAnchor: "Winner League official result: https://basket.co.il/"
        }),
        goldenSignal({
          signalId: "sig_knesset",
          sourceId: "src_knesset_official",
          category: "politics",
          sourceCategory: "politics",
          inferredCategory: "politics",
          clusterKey: "knesset-may-golden",
          lineageLabel: "knesset_dissolution_2026",
          recurringTemplateId: "knesset-dissolution-before-date-v1",
          title: "Knesset deadline",
          question: "האם הכנסת תתפזר עד 31 במאי 2026?",
          suggestedCloseShape: "Close before May 31, 2026 at 20:59.",
          suggestedResolutionAnchor: "הכנסת: https://main.knesset.gov.il/"
        }),
        goldenSignal({
          signalId: "sig_noisy_shock",
          sourceId: "src_google_trending_il",
          intakeLane: "shock-discovery",
          category: "economy",
          sourceCategory: "general",
          inferredCategory: "economy",
          sourceClass: "attention",
          sourceRef: "google-trends:noisy-now",
          sourceLabel: "Google Trending IL",
          clusterKey: "noisy-now-golden",
          lineageLabel: "noisy_now",
          title: "Noisy now-happening trend",
          question: "Will the noisy thing matter?",
          suggestedCloseShape: "",
          suggestedResolutionAnchor: "Unknown source"
        })
      ],
      learningMemory
    );

    const byQuestion = new Map(clusters.map((cluster) => [cluster.reviewItem?.question, cluster.reviewItem]));
    const boi = byQuestion.get("החלטת בנק ישראל במאי?")!;
    const hormuz = byQuestion.get("מתי תחזור תנועת הספינות במצר הורמוז לרמה רגילה?")!;
    const winner = byQuestion.get("מכבי ת״א נגד גליל עליון?")!;
    const knesset = byQuestion.get("האם הכנסת תתפזר עד 31 במאי 2026?")!;
    const noisy = byQuestion.get("Will the noisy thing matter?")!;
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(boi.contract?.reviewBlockers).toEqual([]);
    expect(boi.contract?.resolutionAuthorityType).toBe("official");
    expect(boi.contract?.resolutionSource.url).toBe("https://www.boi.org.il/");
    expect(boi.contract?.taxonomy).toMatchObject({
      visibleTags: ["כלכלה", "ריבית"],
      category: "economy",
      family: "interest-rates",
      entities: ["bank-of-israel"],
      aliases: expect.arrayContaining(["BOI", "Bank of Israel", "בנק ישראל", "ריבית"]),
      sourceIds: ["src_boi_announcements"]
    });
    expect(boi.marketShaping?.tier).toBe("review-ready");
    expect(hormuz.contract?.resolutionAuthorityType).toBe("canonical-data");
    expect(hormuz.contract?.dataRevisionPolicy).toContain("official data");
    expect(winner.contract?.outcomeMap.map((outcome) => outcome.outcomeLabel)).toEqual(["מכבי ת״א", "גליל עליון"]);
    expect(winner.contract?.displayHints).toMatchObject({
      binaryPresentation: "named_opponents",
      affirmativeLabel: "מכבי ת״א",
      negativeLabel: "גליל עליון"
    });
    expect(winner.contract?.outcomeMap.map((outcome) => outcome.resolutionPath)).toEqual([
      "התוצאה זוכה אם מכבי ת״א היא המנצחת הרשמית בתוצאה הסופית.",
      "התוצאה זוכה אם גליל עליון היא המנצחת הרשמית בתוצאה הסופית."
    ]);
    expect(knesset.contract?.timeline.closeAt).toBe("2026-05-31T20:59:00.000Z");
    expect(knesset.contract?.taxonomy).toMatchObject({
      visibleTags: ["פוליטיקה", "כנסת"],
      family: "knesset",
      entities: ["knesset"],
      aliases: expect.arrayContaining(["Knesset", "הכנסת", "חקיקה"])
    });

    expect(noisy.contract?.resolutionAuthorityType).toBe("platform-defined");
    expect(noisy.marketShaping?.tier).toBe("needs-grounding");
    expect(noisy.contract?.reviewBlockers).toEqual(
      expect.arrayContaining(["missing-close-shape", "missing-source-url"])
    );
    expect(sections.active.map((item) => item.question)).toEqual(
      expect.arrayContaining([
        "החלטת בנק ישראל במאי?",
        "מתי תחזור תנועת הספינות במצר הורמוז לרמה רגילה?",
        "מכבי ת״א נגד גליל עליון?",
        "האם הכנסת תתפזר עד 31 במאי 2026?"
      ])
    );
    expect(sections.rework.map((item) => item.question)).toContain("Will the noisy thing matter?");
  });

  it("treats Niké Liga official match pages as official and marks mixed-language outcome naming", () => {
    const clusters = buildSeerClustersFromSignals(
      [
        goldenSignal({
          signalId: "sig_nike_liga_pod_slo",
          sourceId: "src_nike_liga_official",
          intakeLane: "planned",
          category: "sports",
          sourceCategory: "sports",
          inferredCategory: "sports",
          sourceClass: "authority",
          sourceRef: "https://www.nikeliga.sk/zapas/2772-pod-slo",
          sourceLabel: "Niké Liga",
          clusterKey: "nike-liga-pod-slo",
          lineageLabel: "nike-liga-pod-slo",
          title: "FK Železiarne Podbrezová נגד ŠK Slovan Bratislava",
          question: "מה תהיה התוצאה בתום הזמן החוקי במשחק FK Železiarne Podbrezová נגד ŠK Slovan Bratislava?",
          marketAngle: "Official football match result.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "FK Železiarne Podbrezová", kind: "named-outcome" },
            { label: "תיקו", kind: "named-outcome" },
            { label: "ŠK Slovan Bratislava", kind: "named-outcome" }
          ],
          resolutionFeasibility: "Official Niké Liga result settles regulation-time result.",
          suggestedCloseShape: "Close before May 9, 2026 at 16:00 UTC.",
          suggestedResolutionAnchor: "Niké Liga official match page: https://www.nikeliga.sk/zapas/2772-pod-slo"
        })
      ],
      buildReviewLearningMemoryFromData(seerTestSources, [], [])
    );

    const item = clusters[0]?.reviewItem;

    expect(item?.contract?.resolutionAuthorityType).toBe("official");
    expect(item?.topRisks).toEqual(
      expect.arrayContaining([expect.stringContaining("hebrew-localization-needed: outcome labels need Hebrew display names")])
    );
    expect(item?.reviewHints).toEqual(
      expect.arrayContaining([expect.stringContaining("hebrew-localization-needed: outcome labels need Hebrew display names")])
    );
  });
});
