import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSeerClustersFromSignals,
  buildLayeredReviewQueueFromClusters,
  buildReviewQueueFromClusters
} from "../../../seer/src/pipeline";
import { buildReviewLearningMemoryFromData } from "../../../seer/src/review-memory";
import {
  seerTestSources,
  duplicatePressureSignals,
  reviewMemoryFeedbackLog,
  reviewMemoryQueueHistory
} from "../../../seer/src/test-fixtures";
import type { SeerSignal } from "../../../seer/src/pipeline";

function enrichmentDraftSignal(index: number, overrides: Partial<SeerSignal> = {}): SeerSignal {
  return {
    signalId: `sig_auto_draft_${index}`,
    signalOrigin: "manual",
    sourceId: "src_google_trends_israel_interest_rate",
    intakeLane: "shock-discovery",
    clusterKey: `auto-draft-${index}`,
    lineageLabel: `auto-draft-${index}`,
    title: `Auto draft ${index}`,
    summary: "Auto-drafted signal fixture.",
    category: "sports",
    sourceCategory: "general",
    inferredCategory: "sports",
    whyNow: "Fixture signal is current.",
    observedAt: `2026-04-0${index}T10:00:00Z`,
    sourceClass: "attention",
    sourceRef: `https://fixtures.example.test/matches/${index}`,
    sourceLabel: "Fixture",
    keyEntities: [`Team ${index}`, `Team ${index + 1}`],
    sourceSummary: "Fixture source summary.",
    topicKind: "team-or-competition-buzz",
    marketability: "draft-ready",
    inferenceNotes: ["Draft market shape inferred for team-or-competition-buzz."],
    question: `Who will win Team ${index} vs Team ${index + 1}?`,
    marketAngle: "Fixture sports winner market.",
    marketForm: "multi-outcome",
    proposedOutcomes: [
      { label: `Team ${index}`, kind: "named-outcome" },
      { label: `Team ${index + 1}`, kind: "named-outcome" }
    ],
    marketWorthiness: "Fixture market worthiness.",
    resolutionFeasibility: "Official result settles this fixture.",
    suggestedCloseShape: `Close before May ${10 + index}, 2026 at 19:00.`,
    suggestedResolutionAnchor: `Official result: https://fixtures.example.test/matches/${index}`,
    draftedByEnrichment: true,
    ...overrides
  };
}

describe("buildSeerClustersFromSignals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("distinguishes duplicate pressure from a real follow-up branch", () => {
    const learningMemory = buildReviewLearningMemoryFromData(
      seerTestSources,
      reviewMemoryFeedbackLog,
      reviewMemoryQueueHistory
    );
    const clusters = buildSeerClustersFromSignals(duplicatePressureSignals, learningMemory);
    const marchDuplicate = clusters.find((cluster) => cluster.clusterKey === "boi-mar-duplicate");
    const aprilFollowup = clusters.find((cluster) => cluster.clusterKey === "boi-apr-followup");

    expect(marchDuplicate?.candidateMarket?.duplicateAssessment).toBe("likely-duplicate");
    expect(marchDuplicate?.reviewItem?.recommendedAction).toBe("merge");

    expect(aprilFollowup?.candidateMarket?.duplicateAssessment).toBe("follow-up-branch");
    expect(aprilFollowup?.reviewItem?.lineageContext).toBe("follow-up-branch");
    expect(aprilFollowup?.reviewItem?.reviewHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prior positive review actions"),
        expect.stringContaining("duplicate pressure already showed up")
      ])
    );
  });

  it("does not double-prefix lineage ids when operator input already includes lin_", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          lineageLabel: "lin_nba_west_finals_game_2",
          sourceId: "src_nba_official_games",
          sourceClass: "authority",
          sourceLabel: "NBA",
          sourceRef: "https://www.nba.com/game/sas-vs-okc-0042500312"
        })
      ],
      learningMemory
    );

    expect(clusters[0]?.candidateMarket?.lineageId).toBe("lin_nba_west_finals_game_2");
  });

  it("keeps rework items selectable while hiding fully reviewed items", () => {
    const learningMemory = buildReviewLearningMemoryFromData(
      seerTestSources,
      reviewMemoryFeedbackLog,
      reviewMemoryQueueHistory
    );
    const clusters = buildSeerClustersFromSignals(duplicatePressureSignals, learningMemory);
    const reviewQueue = buildReviewQueueFromClusters(clusters, learningMemory);

    expect(reviewQueue.map((item) => item.candidateMarketId)).toContain("cm_boi_apr_followup");
    expect(reviewQueue.map((item) => item.candidateMarketId)).not.toContain("cm_boi_mar_duplicate");
  });

  it("adds live-event understanding while accepting legacy shock-discovery lane input", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals([enrichmentDraftSignal(1)], learningMemory);
    const event = clusters[0]?.trackedEvent;
    const candidate = clusters[0]?.candidateMarket;

    expect(event?.eventLane).toBe("live");
    expect(event?.liveEvent).toMatchObject({
      objectType: "live_event_understanding_v0",
      nextGate: "ground-sources",
      marketability: "draft-ready"
    });
    expect(event?.liveEvent?.evidenceRefs).toEqual(["https://fixtures.example.test/matches/1"]);
    expect(event?.liveEvent?.groundingNeeds).toContain("credible-or-official-grounding-source");
    expect(candidate?.intakeLane).toBe("live");
  });

  it("splits review queue into active, rework, and reviewed sections", () => {
    const learningMemory = buildReviewLearningMemoryFromData(
      seerTestSources,
      reviewMemoryFeedbackLog,
      reviewMemoryQueueHistory
    );
    const clusters = buildSeerClustersFromSignals(duplicatePressureSignals, learningMemory);
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.candidateMarketId)).toEqual(["cm_boi_mar_primary"]);
    expect(sections.rework.map((item) => item.candidateMarketId)).toEqual(["cm_boi_apr_followup"]);
    expect(sections.reviewed.map((item) => item.candidateMarketId)).toEqual(["cm_boi_mar_duplicate"]);
  });

  it("caps active enrichment drafts and parks overflow in rework backlog", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [1, 2, 3, 4, 5, 6].map((index) => enrichmentDraftSignal(index)),
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active).toHaveLength(2);
    expect(sections.active.every((item) => item.draftedByEnrichment)).toBe(true);
    expect(sections.rework).toHaveLength(4);
    expect(sections.rework.every((item) => item.recommendedAction === "hold")).toBe(true);
    expect(sections.rework.some((item) => (item.reviewHints ?? []).some((hint) => hint.includes("Live cap")))).toBe(
      true
    );
  });

  it("keeps planned rails wide while capping live active slots", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        {
          signalId: "sig_boi_may_schedule",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-rate-decision-may-2026",
          lineageLabel: "boi_rate_decisions",
          title: "BOI May",
          summary: "Official BOI schedule.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "Scheduled.",
          observedAt: "2026-05-25T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "boi:may",
          sourceLabel: "Bank of Israel",
          keyEntities: ["BOI"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in May?",
          marketAngle: "Scheduled central-bank decision.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness: "Clean planned-event economy market.",
          resolutionFeasibility: "Official announcement.",
          suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: ["grounding: event-date=May 25, 2026", "grounding: publication-time=16:00"]
        },
        {
          signalId: "sig_knesset_april",
          signalOrigin: "seed",
          sourceId: "src_knesset_official",
          intakeLane: "planned-event",
          recurringTemplateId: "knesset-dissolution-before-date-v1",
          clusterKey: "knesset-dissolution-april",
          lineageLabel: "knesset-dissolution-2026",
          title: "Knesset dissolution before April 30",
          summary: "Seeded politics family.",
          category: "politics",
          sourceCategory: "politics",
          inferredCategory: "politics",
          whyNow: "Bounded local politics market.",
          observedAt: "2026-04-16T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "knesset:april",
          sourceLabel: "הכנסת",
          keyEntities: ["הכנסת"],
          sourceSummary: "Official Knesset source.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "האם הכנסת תתפזר עד 30 באפריל 2026?",
          marketAngle: "Bounded political deadline market.",
          marketForm: "binary",
          proposedOutcomes: [
            { label: "כן", kind: "binary-side" },
            { label: "לא", kind: "binary-side" }
          ],
          marketWorthiness: "Clean planned-event politics market.",
          resolutionFeasibility: "Official Knesset action.",
          suggestedCloseShape: "Close before April 30, 2026 at 20:59.",
          suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/",
          ambiguityNotes: ["grounding: event-date=April 30, 2026"]
        },
        enrichmentDraftSignal(1, {
          clusterKey: "shock-1",
          lineageLabel: "shock-1",
          question: "Shock 1"
        }),
        enrichmentDraftSignal(2, {
          clusterKey: "shock-2",
          lineageLabel: "shock-2",
          question: "Shock 2"
        }),
        enrichmentDraftSignal(3, {
          clusterKey: "shock-3",
          lineageLabel: "shock-3",
          question: "Shock 3"
        }),
        enrichmentDraftSignal(4, {
          clusterKey: "shock-4",
          lineageLabel: "shock-4",
          question: "Shock 4"
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual([
      "Bank of Israel decision in May?",
      "האם הכנסת תתפזר עד 30 באפריל 2026?",
      "Shock 4",
      "Shock 3"
    ]);
    expect(sections.rework.map((item) => item.question)).toEqual(expect.arrayContaining(["Shock 2", "Shock 1"]));
    expect(sections.rework.some((item) => (item.reviewHints ?? []).some((hint) => hint.includes("Live cap")))).toBe(true);
  });

  it("caps active sibling count inside one recurring planned-event family", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        {
          signalId: "sig_boi_1",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-1",
          lineageLabel: "boi_rate_decisions",
          title: "BOI 1",
          summary: "Official BOI schedule.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "Scheduled.",
          observedAt: "2026-05-25T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "boi:1",
          sourceLabel: "Bank of Israel",
          keyEntities: ["BOI"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in May?",
          marketAngle: "Scheduled central-bank decision.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness: "Clean planned-event economy market.",
          resolutionFeasibility: "Official announcement.",
          suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: ["grounding: event-date=May 25, 2026", "grounding: publication-time=16:00"]
        },
        {
          signalId: "sig_boi_2",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-2",
          lineageLabel: "boi_rate_decisions",
          title: "BOI 2",
          summary: "Official BOI schedule.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "Scheduled.",
          observedAt: "2026-07-06T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "boi:2",
          sourceLabel: "Bank of Israel",
          keyEntities: ["BOI"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in July?",
          marketAngle: "Scheduled central-bank decision.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness: "Clean planned-event economy market.",
          resolutionFeasibility: "Official announcement.",
          suggestedCloseShape: "Close before July 6, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: ["grounding: event-date=July 6, 2026", "grounding: publication-time=16:00"]
        },
        {
          signalId: "sig_boi_3",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-3",
          lineageLabel: "boi_rate_decisions",
          title: "BOI 3",
          summary: "Official BOI schedule.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "Scheduled.",
          observedAt: "2026-08-24T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "boi:3",
          sourceLabel: "Bank of Israel",
          keyEntities: ["BOI"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in August?",
          marketAngle: "Scheduled central-bank decision.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness: "Clean planned-event economy market.",
          resolutionFeasibility: "Official announcement.",
          suggestedCloseShape: "Close before August 24, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: ["grounding: event-date=August 24, 2026", "grounding: publication-time=16:00"]
        },
        {
          signalId: "sig_boi_4",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-4",
          lineageLabel: "boi_rate_decisions",
          title: "BOI 4",
          summary: "Official BOI schedule.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "Scheduled.",
          observedAt: "2026-10-05T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef: "boi:4",
          sourceLabel: "Bank of Israel",
          keyEntities: ["BOI"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in October?",
          marketAngle: "Scheduled central-bank decision.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness: "Clean planned-event economy market.",
          resolutionFeasibility: "Official announcement.",
          suggestedCloseShape: "Close before October 5, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: ["grounding: event-date=October 5, 2026", "grounding: publication-time=16:00"]
        }
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual([
      "Bank of Israel decision in October?",
      "Bank of Israel decision in August?",
      "Bank of Israel decision in July?"
    ]);
    expect(sections.rework.map((item) => item.question)).toContain("Bank of Israel decision in May?");
    expect(sections.rework.some((item) => (item.reviewHints ?? []).some((hint) => hint.includes("Recurring family cap")))).toBe(true);
  });

  it("prioritizes stronger grounded sports cards ahead of provisional ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "sports-explicit-date",
          lineageLabel: "sports-explicit-date",
          title: "Barcelona vs Espanyol",
          question: "Barcelona vs Espanyol (La Liga, Apr 11)",
          proposedOutcomes: [
            { label: "Barcelona", kind: "named-outcome" },
            { label: "Draw", kind: "named-outcome" },
            { label: "Espanyol", kind: "named-outcome" }
          ],
          ambiguityNotes: [
            "grounding: competition=La Liga",
            "grounding: event-date=April 11, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        }),
        enrichmentDraftSignal(2, {
          clusterKey: "sports-provisional-date-with-competition",
          lineageLabel: "sports-provisional-date-with-competition",
          title: "LSG vs GT",
          question: "LSG vs GT (IPL, Apr 12)",
          ambiguityNotes: [
            "Event date inferred from trend timing and fixture-page context; verify exact date before publish.",
            "grounding: competition=IPL",
            "grounding: event-date=observed-trend-window:April 12, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        }),
        enrichmentDraftSignal(3, {
          clusterKey: "sports-provisional-date-no-competition",
          lineageLabel: "sports-provisional-date-no-competition",
          title: "Heracles vs Ajax",
          question: "Heracles vs Ajax (Apr 11)",
          proposedOutcomes: [
            { label: "Heracles", kind: "named-outcome" },
            { label: "Draw", kind: "named-outcome" },
            { label: "Ajax", kind: "named-outcome" }
          ],
          ambiguityNotes: [
            "Event date inferred from trend timing and fixture-page context; verify exact date before publish.",
            "grounding: event-date=observed-trend-window:April 11, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual([
      "Barcelona vs Espanyol (La Liga, Apr 11)",
      "LSG vs GT (IPL, Apr 12)"
    ]);
    expect(sections.rework.map((item) => item.question)).toContain("Heracles vs Ajax (Apr 11)");
  });

  it("prioritizes planned official BOI decisions ahead of sports cards with fetch debt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "sports-fetch-debt",
          lineageLabel: "sports-fetch-debt",
          title: "Arsenal vs Sporting",
          question: "Arsenal vs Sporting (Champions League, Apr 15)",
          proposedOutcomes: [
            { label: "Arsenal", kind: "named-outcome" },
            { label: "Draw", kind: "named-outcome" },
            { label: "Sporting", kind: "named-outcome" }
          ],
          ambiguityNotes: [
            "grounding: competition=Champions League",
            "grounding: event-date=April 15, 2026",
            "grounding: fixture-context=coverage-match-page",
            "fetch-needed=regulation-settlement-rule"
          ]
        }),
        {
          signalId: "sig_boi_may_schedule",
          signalOrigin: "manual",
          sourceId: "src_boi_announcements",
          intakeLane: "planned-event",
          recurringTemplateId: "boi-rate-decision-v1",
          clusterKey: "boi-rate-decision-may-2026",
          lineageLabel: "boi_rate_decisions",
          title: "Bank of Israel interest rate decision schedule - May 25, 2026",
          summary: "Bank of Israel official schedule shows the next Monetary Committee publication date as May 25, 2026 at 16:00.",
          category: "economy",
          sourceCategory: "economy",
          inferredCategory: "economy",
          whyNow: "The next Bank of Israel interest rate decision is scheduled for May 25, 2026.",
          observedAt: "2026-05-25T00:00:00.000Z",
          sourceClass: "authority",
          sourceRef:
            "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/",
          sourceLabel: "Bank of Israel",
          keyEntities: ["Bank of Israel", "Monetary Committee", "May 25, 2026"],
          sourceSummary: "Official BOI schedule page.",
          topicKind: "market-shaped",
          marketability: "draft-ready",
          inferenceNotes: ["Signal already carries explicit market shape."],
          question: "Bank of Israel decision in May?",
          marketAngle: "Scheduled central-bank decision shaped into explicit basis-point change buckets.",
          marketForm: "multi-outcome",
          proposedOutcomes: [
            { label: "50+ bps decrease", kind: "named-outcome" },
            { label: "25 bps decrease", kind: "named-outcome" },
            { label: "No change", kind: "named-outcome" },
            { label: "25 bps increase", kind: "named-outcome" },
            { label: "50+ bps increase", kind: "named-outcome" }
          ],
          marketWorthiness:
            "A scheduled rate decision with explicit bps buckets and a clear date anchor can become a clean planned-event economy market.",
          resolutionFeasibility: "Needs Bank of Israel official announcement before publish.",
          suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
          suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
          ambiguityNotes: [
            "grounding: event-date=May 25, 2026",
            "grounding: publication-time=16:00"
          ]
        }
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual(["Bank of Israel decision in May?"]);
    expect(sections.rework.map((item) => item.question)).toContain("Arsenal vs Sporting (Champions League, Apr 15)");
  });

  it("suppresses stale sports matchups from the live review queue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "sports-stale",
          lineageLabel: "sports-stale",
          title: "Trail Blazers vs Spurs",
          question: "Trail Blazers vs Spurs (NBA, Apr 8)",
          suggestedCloseShape: "Close before April 8, 2026 at 19:00.",
          ambiguityNotes: [
            "grounding: competition=NBA",
            "grounding: event-date=April 8, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        }),
        enrichmentDraftSignal(2, {
          clusterKey: "sports-current",
          lineageLabel: "sports-current",
          title: "LSG vs GT",
          question: "LSG vs GT (IPL, Apr 12)",
          suggestedCloseShape: "Close before April 12, 2026 at 19:00.",
          ambiguityNotes: [
            "grounding: competition=IPL",
            "grounding: event-date=April 12, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual(["LSG vs GT (IPL, Apr 12)"]);
    expect(sections.reviewed.map((item) => item.question)).not.toContain("Trail Blazers vs Spurs (NBA, Apr 8)");
  });

  it("surfaces fetch-needs separately from top risks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "sports-fetch-needs",
          lineageLabel: "sports-fetch-needs",
          title: "Chelsea vs Manchester City",
          question: "Chelsea vs Manchester City (Premier League, Apr 12)",
          ambiguityNotes: [
            "Needs human check for exact competition/date and explicit regulation-time settlement wording.",
            "fetch-needed=exact-event-date",
            "fetch-needed=regulation-settlement-rule",
            "grounding: competition=Premier League",
            "grounding: event-date=observed-trend-window:April 12, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);
    const item = sections.rework[0]!;

    expect(item.fetchNeeds).toEqual(["exact-event-date", "regulation-settlement-rule"]);
    expect(item.sourceRolePlan).toEqual(
      expect.objectContaining({
        wake: ["Fixture"],
        ground: expect.arrayContaining(["trusted fixture / schedule source"]),
        resolve: expect.arrayContaining(["Official result: https://fixtures.example.test/matches/1"])
      })
    );
    expect(item.topRisks).not.toEqual(expect.arrayContaining(["fetch-needed=exact-event-date"]));
    expect(item.topRisks).toEqual(
      expect.arrayContaining(["Needs human check for exact competition/date and explicit regulation-time settlement wording."])
    );
  });

  it("prefers the strongest grounded sibling instead of carrying weaker fetch baggage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "sports_match_april_12_2026_chelsea_vs_manchester_city",
          lineageLabel: "sports_match_chelsea_vs_manchester_city",
          title: "Chelsea vs Manchester City",
          question: "Chelsea vs Manchester City (Premier League, Apr 12)",
          ambiguityNotes: [
            "Needs human check for exact competition/date and explicit regulation-time settlement wording.",
            "fetch-needed=regulation-settlement-rule",
            "grounding: competition=Premier League",
            "grounding: event-date=April 12, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        }),
        enrichmentDraftSignal(2, {
          signalId: "sig_auto_draft_2b",
          sourceRef: "fixture:2b",
          clusterKey: "sports_match_april_12_2026_chelsea_vs_manchester_city",
          lineageLabel: "sports_match_chelsea_vs_manchester_city",
          title: "צ'לסי נגד מנצ'סטר סיטי",
          question: "Manchester City vs Chelsea (Apr 12)",
          ambiguityNotes: [
            "Needs human check for exact competition/date and explicit regulation-time settlement wording.",
            "fetch-needed=exact-event-date",
            "fetch-needed=competition-name",
            "fetch-needed=regulation-settlement-rule",
            "grounding: canonical-sides=Chelsea|Manchester City",
            "grounding: event-date=observed-trend-window:April 12, 2026",
            "grounding: fixture-context=coverage-match-page"
          ]
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);
    const item = sections.rework[0]!;

    expect(item.question).toBe("Chelsea vs Manchester City (Premier League, Apr 12)");
    expect(item.fetchNeeds).toEqual(["regulation-settlement-rule"]);
    expect(item.topRisks).not.toEqual(
      expect.arrayContaining(["grounding: event-date=observed-trend-window:April 12, 2026"])
    );
  });

  it("keeps non-priority security follow-ups out of the live review queue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00Z"));

    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        enrichmentDraftSignal(1, {
          clusterKey: "security-stale",
          lineageLabel: "security-stale",
          category: "security",
          sourceCategory: "security",
          inferredCategory: "security",
          title: "Update - Home Front Command Defensive Policy",
          question: "Will Home Front Command extend the current defensive policy beyond April 10, 2026 at 18:00?",
          marketForm: "binary",
          proposedOutcomes: [
            { label: "Yes", kind: "binary-side" },
            { label: "No", kind: "binary-side" }
          ],
          suggestedCloseShape: "Close before April 10, 2026 at 18:00.",
          sourceClass: "authority"
        }),
        enrichmentDraftSignal(2, {
          clusterKey: "security-live",
          lineageLabel: "security-live",
          category: "security",
          sourceCategory: "security",
          inferredCategory: "security",
          title: "Update - Home Front Command Defensive Policy",
          question: "Will Home Front Command extend the current defensive policy beyond April 13, 2026 at 18:00?",
          marketForm: "binary",
          proposedOutcomes: [
            { label: "Yes", kind: "binary-side" },
            { label: "No", kind: "binary-side" }
          ],
          suggestedCloseShape: "Close before April 13, 2026 at 18:00.",
          sourceClass: "authority"
        })
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active.map((item) => item.question)).toEqual([]);
    expect(sections.reviewed.map((item) => item.question)).not.toContain(
      "Will Home Front Command extend the current defensive policy beyond April 10, 2026 at 18:00?"
    );
  });

  it("carries recurring planned-event templates through candidate and review objects", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        {
          ...enrichmentDraftSignal(1, {
            clusterKey: "boi-rate-template",
            lineageLabel: "boi_rate_decisions",
            category: "economy",
            sourceCategory: "economy",
            inferredCategory: "economy",
            sourceId: "src_boi_announcements",
            sourceLabel: "Bank of Israel",
            sourceClass: "authority",
            title: "Publication dates of interest rate decisions - May 2026",
            question: "Bank of Israel decision in May?",
            marketAngle: "Scheduled central-bank decision shaped into explicit basis-point change buckets.",
            proposedOutcomes: [
              { label: "50+ bps decrease", kind: "named-outcome" },
              { label: "25 bps decrease", kind: "named-outcome" },
              { label: "No change", kind: "named-outcome" },
              { label: "25 bps increase", kind: "named-outcome" },
              { label: "50+ bps increase", kind: "named-outcome" }
            ],
            suggestedCloseShape: "Close before May 25, 2026.",
            suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
            ambiguityNotes: ["grounding: event-date=May 25, 2026"],
            recurringTemplateId: "boi-rate-decision-v1"
          })
        }
      ],
      learningMemory
    );
    const item = buildLayeredReviewQueueFromClusters(clusters, learningMemory).active[0]!;
    const candidate = clusters[0]?.candidateMarket;

    expect(candidate?.recurringTemplateId).toBe("boi-rate-decision-v1");
    expect(item.recurringTemplateId).toBe("boi-rate-decision-v1");
    expect(item.reviewHints).toEqual(expect.arrayContaining(["Recurring template: BOI rate decision v1."]));
  });

  it("parks duplicate recurring calendar events instead of keeping two active copies", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        {
          ...enrichmentDraftSignal(1, {
            clusterKey: "boi-may-primary",
            lineageLabel: "boi_rate_decisions",
            category: "economy",
            sourceCategory: "economy",
            inferredCategory: "economy",
            intakeLane: "planned-event",
            sourceId: "src_boi_announcements",
            sourceLabel: "Bank of Israel",
            sourceClass: "authority",
            title: "Publication dates of interest rate decisions - May 2026",
            question: "החלטת בנק ישראל במאי?",
            marketForm: "multi-outcome",
            proposedOutcomes: [
              { label: "ירידה של 0.25%", kind: "named-outcome" },
              { label: "ללא שינוי", kind: "named-outcome" },
              { label: "עלייה של 0.25%", kind: "named-outcome" }
            ],
            suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
            suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/",
            recurringTemplateId: "boi-rate-decision-v1"
          })
        },
        {
          ...enrichmentDraftSignal(2, {
            clusterKey: "boi-may-v2",
            lineageLabel: "boi_rate_decisions",
            category: "economy",
            sourceCategory: "economy",
            inferredCategory: "economy",
            intakeLane: "planned-event",
            sourceId: "src_boi_announcements",
            sourceLabel: "Bank of Israel",
            sourceClass: "authority",
            title: "BOI May decision duplicate wording",
            question: "ריבית בנק ישראל: 25 במאי",
            marketForm: "multi-outcome",
            proposedOutcomes: [
              { label: "ירידה של 0.25%", kind: "named-outcome" },
              { label: "ללא שינוי", kind: "named-outcome" },
              { label: "עלייה של 0.25%", kind: "named-outcome" }
            ],
            suggestedCloseShape: "Close before May 25, 2026 at 13:00.",
            suggestedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
            recurringTemplateId: "boi-rate-decision-v1"
          })
        }
      ],
      learningMemory
    );
    const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);

    expect(sections.active).toHaveLength(1);
    expect(sections.rework).toHaveLength(1);
    expect(sections.rework[0]?.reviewHints).toEqual(
      expect.arrayContaining([expect.stringContaining("Duplicate contract guard")])
    );
  });

  it("treats recurring sibling deadlines as family branches, not duplicates", () => {
    const learningMemory = buildReviewLearningMemoryFromData(seerTestSources, [], []);
    const clusters = buildSeerClustersFromSignals(
      [
        {
          ...enrichmentDraftSignal(1, {
            clusterKey: "knesset-april",
            lineageLabel: "knesset_dissolution_2026",
            category: "politics",
            sourceCategory: "politics",
            inferredCategory: "politics",
            intakeLane: "planned-event",
            sourceId: "src_knesset_official",
            sourceLabel: "הכנסת",
            sourceClass: "authority",
            title: "Knesset dissolution before end of April 2026",
            question: "האם הכנסת תתפזר עד 30 באפריל 2026?",
            marketForm: "binary",
            proposedOutcomes: [
              { label: "כן", kind: "binary-side" },
              { label: "לא", kind: "binary-side" }
            ],
            suggestedCloseShape: "Close before April 30, 2026 at 20:59.",
            suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/",
            recurringTemplateId: "knesset-dissolution-before-date-v1"
          })
        },
        {
          ...enrichmentDraftSignal(2, {
            clusterKey: "knesset-may",
            lineageLabel: "knesset_dissolution_2026",
            category: "politics",
            sourceCategory: "politics",
            inferredCategory: "politics",
            intakeLane: "planned-event",
            sourceId: "src_knesset_official",
            sourceLabel: "הכנסת",
            sourceClass: "authority",
            title: "Knesset dissolution before end of May 2026",
            question: "האם הכנסת תתפזר עד 31 במאי 2026?",
            marketForm: "binary",
            proposedOutcomes: [
              { label: "כן", kind: "binary-side" },
              { label: "לא", kind: "binary-side" }
            ],
            suggestedCloseShape: "Close before May 31, 2026 at 20:59.",
            suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/",
            recurringTemplateId: "knesset-dissolution-before-date-v1"
          })
        }
      ],
      learningMemory
    );

    expect(clusters.map((cluster) => cluster.candidateMarket?.duplicateAssessment)).toEqual([
      "follow-up-branch",
      "follow-up-branch"
    ]);
    expect(clusters.map((cluster) => cluster.reviewItem?.recommendedAction)).not.toContain("merge");
  });
});
