import { describe, expect, it } from "vitest";

import {
  buildMarketCreationDraftsFromData,
  buildMarketCreationReadinessFromData
} from "../../../seer/src/creation-drafts";
import {
  reviewMemoryFeedbackLog,
  reviewMemoryQueueHistory
} from "../../../seer/src/test-fixtures";
import type { SourceRegistryEntry } from "../../../seer/src/contracts";

describe("buildMarketCreationDraftsFromData", () => {
  it("builds a backend-ready draft from approved local review items", () => {
    const drafts = buildMarketCreationDraftsFromData(
      reviewMemoryFeedbackLog,
      reviewMemoryQueueHistory,
      "2026-03-29T10:00:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      candidateMarketId: "cm_boi_apr_followup",
      reviewItemId: "rh_boi_apr_followup",
      category: "economy",
      categoryKey: "economics",
      title: "האם בנק ישראל יוריד שוב את הריבית בהחלטת אפריל 2026?",
      closeAt: "2026-04-28T00:00:00.000Z",
      resolutionSource: "Bank of Israel April announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
      liquidityB: "75000.00000000",
      seedAmount: "51986.038542",
      eventId: expect.stringMatching(/^event-/),
      eventTitle: "BOI April follow-up",
      eventResolutionPolicy: "independent_children",
      eventChildLabel: "האם בנק ישראל יוריד שוב את הריבית בהחלטת אפריל 2026?",
      closeOnEventCompletion: true,
      eventCompletionCloseRequiresHumanApproval: true
    });
    expect(drafts[0]?.oracleSourcePolicy?.preferredSourceIds).toEqual([
      "src_boi_announcements",
      "src_google_trends_israel_interest_rate"
    ]);
    expect(drafts[0]?.oracleSourcePolicy?.contextSourceIds).toEqual([
      "src_boi_announcements",
      "src_google_trends_israel_interest_rate"
    ]);
    expect(drafts[0]?.oracleSourcePolicy?.notes).toEqual(
      expect.arrayContaining([
        "wake-role=Google Trends: Israel interest rate",
        "ground-role=Bank of Israel",
        "resolve-role=Bank of Israel April announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"
      ])
    );
    expect(drafts[0]?.outcomes.map((outcome) => outcome.label)).toEqual(["כן", "לא"]);
    expect(drafts[0]?.outcomes.map((outcome) => outcome.outcomeId)).toEqual([
      "disc-cm-boi-apr-followup-option-1",
      "disc-cm-boi-apr-followup-option-2"
    ]);
    expect(drafts[0]?.contract).toMatchObject({
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      marketKindId: "economy.central-bank-rate-decision",
      measurementKind: "rate_direction",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: "https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"
      },
      timeline: {
        closeAt: "2026-04-28T00:00:00.000Z"
      },
      image: {
        bucket: "entity",
        alt: "בנק ישראל",
        provenance: "entity:bank-of-israel"
      },
      reviewBlockers: []
    });
    expect(drafts[0]?.contract?.payoutPolicy).toContain("אין להסיק תשלום מזמן סגירת המסחר בלבד");
    expect(drafts[0]?.contract?.outcomeMap).toHaveLength(2);
    expect(drafts[0]?.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^creation-event-id=event-/),
        "creation-event-resolution-policy=independent_children"
      ])
    );
  });

  it("threads shared event identity across sibling creation drafts", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_match_winner",
          reviewItemId: "rh_match_winner",
          candidateMarketId: "cm_match_winner",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "winner child ready",
          reviewedAt: "2026-05-20T10:00:00.000Z"
        },
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_match_goals",
          reviewItemId: "rh_match_goals",
          candidateMarketId: "cm_match_goals",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "goals child ready",
          reviewedAt: "2026-05-20T10:01:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_match_bundle",
          generatedAt: "2026-05-20T09:59:00.000Z",
          itemCount: 2,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_match_winner",
              candidateMarketId: "cm_match_winner",
              intakeLane: "planned",
              lineageId: "lin_sports_match_maccabi_vs_hapoel",
              recurringTemplateId: "sports-regulation-3way-v1",
              category: "sports",
              headline: "Review: match result",
              question: "מה תהיה תוצאת המשחק?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "מכבי", kind: "named-outcome" },
                { label: "תיקו", kind: "named-outcome" },
                { label: "הפועל", kind: "named-outcome" }
              ],
              whyNow: "Official fixture.",
              decisionSummary: "Same match event.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "sibling-candidate",
              topSupport: "Official fixture.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["Official fixture"],
                ground: ["Official fixture"],
                resolve: ["Official fixture: https://example.com/match-1"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before May 21, 2026 at 19:00.",
              suggestedResolutionAnchor: "Official fixture: https://example.com/match-1",
              topSourceIds: ["src_ifa_fixtures_results"],
              sensitivityLevel: "normal",
              createdAt: "2026-05-20T09:58:00.000Z"
            },
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_match_goals",
              candidateMarketId: "cm_match_goals",
              intakeLane: "planned",
              lineageId: "lin_sports_match_maccabi_vs_hapoel",
              recurringTemplateId: "sports-regulation-3way-v1",
              category: "sports",
              headline: "Review: match goals",
              question: "מה תהיה תוצאת המחצית?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "מכבי", kind: "named-outcome" },
                { label: "תיקו", kind: "named-outcome" },
                { label: "הפועל", kind: "named-outcome" }
              ],
              whyNow: "Official fixture.",
              decisionSummary: "Same match event.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "sibling-candidate",
              topSupport: "Official fixture.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["Official fixture"],
                ground: ["Official fixture"],
                resolve: ["Official fixture: https://example.com/match-1"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before May 21, 2026 at 19:00.",
              suggestedResolutionAnchor: "Official fixture: https://example.com/match-1",
              topSourceIds: ["src_ifa_fixtures_results"],
              sensitivityLevel: "normal",
              createdAt: "2026-05-20T09:58:30.000Z"
            }
          ]
        }
      ],
      "2026-05-20T10:02:00.000Z"
    );

    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map((draft) => draft.eventId)).size).toBe(1);
    expect(drafts.map((draft) => draft.familyKey)).toEqual([
      "lin-sports-match-maccabi-vs-hapoel",
      "lin-sports-match-maccabi-vs-hapoel"
    ]);
    expect(new Set(drafts.map((draft) => draft.eventResolutionPolicy)).size).toBe(1);
    expect(drafts[0]?.eventResolutionPolicy).toBe("independent_children");
    expect(drafts.map((draft) => draft.eventChildLabel).sort()).toEqual([
      "מה תהיה תוצאת המחצית?",
      "מה תהיה תוצאת המשחק?"
    ]);
  });

  it("preserves the reviewed contract resolution rule in creation drafts", () => {
    const specificRule =
      "Resolve from the NBA official game page and official boxscore for game 0042500203. The team with the higher official final score wins.";
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_nba_rule",
          reviewItemId: "rh_nba_rule",
          candidateMarketId: "cm_nba_rule",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "specific rule is ready",
          reviewedAt: "2026-05-09T16:36:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_nba_rule",
          generatedAt: "2026-05-09T16:35:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_nba_rule",
              candidateMarketId: "cm_nba_rule",
              intakeLane: "planned",
              lineageId: "lin_nba_rule",
              category: "sports",
              headline: "Review: NBA official game",
              question: "מי תנצח במשחק ה-NBA הרשמי?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "Detroit Pistons / דטרויט פיסטונס", kind: "named-outcome" },
                { label: "Cleveland Cavaliers / קליבלנד קאבלירס", kind: "named-outcome" }
              ],
              whyNow: "Official near-window game.",
              decisionSummary: "Ready.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "NBA official game page.",
              topRisks: [],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["NBA official game page"],
                ground: ["NBA official game page"],
                resolve: ["NBA official game page: https://www.nba.com/game/det-vs-cle-0042500203"]
              },
              contract: {
                objectType: "market_contract_v1",
                version: "seer-contract-v1",
                measurement: "מי תנצח במשחק ה-NBA הרשמי?",
                resolutionAuthorityType: "official",
                resolutionSource: {
                  label: "NBA official game page",
                  url: "https://www.nba.com/game/det-vs-cle-0042500203",
                  sourceIds: ["src_nba_official_games"]
                },
                resolutionRule: specificRule,
                timeline: {
                  closeShape: "Close before May 9, 2026 at 19:00 UTC.",
                  closeAt: "2026-05-09T19:00:00.000Z",
                  timezone: "UTC"
                },
                outcomeMap: [
                  {
                    outcomeLabel: "Detroit Pistons / דטרויט פיסטונס",
                    outcomeKind: "named-outcome",
                    resolutionPath: "Wins if Detroit has the higher official final score."
                  },
                  {
                    outcomeLabel: "Cleveland Cavaliers / קליבלנד קאבלירס",
                    outcomeKind: "named-outcome",
                    resolutionPath: "Wins if Cleveland has the higher official final score."
                  }
                ],
                payoutPolicy:
                  "התשלום מתבצע רק לאחר פרסום תוצאה רשמית, אישור מפעיל, ועדכון השוק למצב נפתר. אין להסיק תשלום מזמן סגירת המסחר בלבד.",
                reviewBlockers: []
              },
              recommendedAction: "approve-with-edits",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before May 9, 2026 at 19:00 UTC.",
              suggestedResolutionAnchor:
                "NBA official game page: https://www.nba.com/game/det-vs-cle-0042500203",
              sensitivityLevel: "normal",
              topSourceRefs: ["https://www.nba.com/game/det-vs-cle-0042500203"],
              topSourceIds: ["src_nba_official_games"],
              createdAt: "2026-05-09T16:35:00.000Z"
            }
          ]
        }
      ],
      "2026-05-09T16:37:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.resolutionRules).toBe(specificRule);
    expect(drafts[0]?.contract.resolutionRule).toBe(specificRule);
    expect(drafts[0]?.contract).toMatchObject({
      measurementKind: "final_winner",
      resultShape: "home_away_winner",
      oracleCapability: "supported_full_cycle",
      resolutionSource: {
        sourceIds: ["src_nba_official_games"]
      }
    });
  });

  it("uses merged source registry lifecycle capabilities when compiling creation drafts", () => {
    const customRegistry: SourceRegistryEntry[] = [
      {
        objectType: "source_registry_entry",
        sourceId: "src_operator_rate_source",
        label: "Operator seeded official rate source",
        primaryClass: "authority",
        accessSurface: "html",
        status: "trusted",
        curationMode: "manual-seed",
        stageUsefulness: ["grounding", "review"],
        categoryFit: ["economy"],
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-10T10:00:00.000Z",
        lifecycleCapabilities: [
          {
            measurementKind: "rate_direction",
            resultShape: "cut_hold_hike",
            oracleCapability: "supported_final_only"
          }
        ]
      }
    ];
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_operator_rates",
          reviewItemId: "rh_operator_rates",
          candidateMarketId: "cm_operator_rates",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "operator seeded source is ready",
          reviewedAt: "2026-05-10T10:05:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_operator_rates",
          generatedAt: "2026-05-10T10:04:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_operator_rates",
              candidateMarketId: "cm_operator_rates",
              intakeLane: "planned",
              lineageId: "lin_operator_rates",
              category: "economy",
              headline: "Review: operator rate source",
              question: "מה תהיה החלטת הריבית הרשמית?",
              marketForm: "multi-outcome",
              recurringTemplateId: "boi-rate-decision-v1",
              proposedOutcomes: [
                { label: "ירידה", kind: "named-outcome" },
                { label: "ללא שינוי", kind: "named-outcome" },
                { label: "עלייה", kind: "named-outcome" }
              ],
              whyNow: "Official rate decision window.",
              decisionSummary: "Ready.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Official rate source.",
              topRisks: ["manual-resolution-required-until-eurovision-adapter-exists"],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["Operator source"],
                ground: ["Operator official rate source"],
                resolve: ["Operator official rate source: https://example.test/rates"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "official",
              suggestedCloseShape: "Close before May 25, 2026 at 13:00 UTC.",
              suggestedResolutionAnchor: "Operator official rate source: https://example.test/rates",
              sensitivityLevel: "normal",
              topSourceRefs: ["https://example.test/rates"],
              topSourceIds: ["src_operator_rate_source"],
              createdAt: "2026-05-10T10:04:00.000Z"
            }
          ]
        }
      ],
      "2026-05-10T10:06:00.000Z",
      {
        sourceRegistry: customRegistry
      }
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.contract).toMatchObject({
      marketKindId: "economy.central-bank-rate-decision",
      measurementKind: "rate_direction",
      resultShape: "cut_hold_hike",
      oracleCapability: "supported_final_only"
    });
    expect(drafts[0]?.oracleSourcePolicy?.notes).toContain("oracle-capability=supported_final_only");
  });

  it("builds an entertainment draft from the shared category registry", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_eurovision_top5",
          reviewItemId: "rh_eurovision_top5",
          candidateMarketId: "cm_eurovision_israel_top5_2026",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "official scoreboard, bounded close",
          reviewedAt: "2026-05-15T21:30:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_eurovision_top5",
          generatedAt: "2026-05-15T21:20:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_eurovision_top5",
              candidateMarketId: "cm_eurovision_israel_top5_2026",
              intakeLane: "operator",
              lineageId: "lin_eurovision_2026",
              category: "culture",
              headline: "Review: Eurovision Israel top 5",
              question: "האם ישראל תסיים בטופ 5 בגמר אירוויזיון 2026?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "כן", kind: "binary-side" },
                { label: "לא", kind: "binary-side" }
              ],
              whyNow: "גמר אירוויזיון 2026 מתקיים הערב ויש מקור רשמי לתוצאות.",
              decisionSummary: "Official scoreboard binary.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Eurovision official Grand Final page.",
              topRisks: [],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["Eurovision official schedule"],
                ground: ["Eurovision Grand Final page"],
                resolve: [
                  "Eurovision official Grand Final scoreboard: https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
                ]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean official source and Hebrew contract",
              suggestedCloseShape: "Close before May 16, 2026 at 19:00 UTC.",
              suggestedResolutionAnchor:
                "Eurovision official Grand Final scoreboard: https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
              topSourceRefs: [
                "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
              ],
              topSourceIds: ["src_eurovision_official"],
              sensitivityLevel: "normal",
              createdAt: "2026-05-15T21:20:00.000Z"
            }
          ]
        }
      ],
      "2026-05-15T21:35:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      candidateMarketId: "cm_eurovision_israel_top5_2026",
      category: "culture",
      categoryKey: "entertainment",
      closeAt: "2026-05-16T19:00:00.000Z",
      contract: {
        measurementKind: "final_winner",
        resultShape: "yes_no",
        oracleCapability: "supported_final_only",
        timeline: {
          expectedResolutionAt: "2026-05-16T23:00:00.000Z"
        },
        image: {
          bucket: "category-fallback",
          assetId: "bucket.entertainment.default.v1"
        }
      }
    });
    expect(drafts[0]?.resolutionRules).toContain("אם ישראל מופיעה במקום 1 עד 5");
    expect(drafts[0]?.resolutionRules).toContain("מקור ההכרעה: https://www.eurovision.com/");
    expect(drafts[0]?.contract?.ambiguityPolicy).toBeUndefined();
  });

  it("maps Eurovision multi-outcome countries to Hebrew paths and country evidence keys", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_eurovision_multi",
          reviewItemId: "rh_eurovision_multi",
          candidateMarketId: "cm_eurovision_2026_winner_multi",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "official scoreboard multi-outcome",
          reviewedAt: "2026-05-16T09:50:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_eurovision_multi",
          generatedAt: "2026-05-16T09:45:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_eurovision_multi",
              candidateMarketId: "cm_eurovision_2026_winner_multi",
              intakeLane: "planned",
              lineageId: "lin_eurovision_2026",
              category: "culture",
              headline: "Review: Eurovision winner",
              question: "מי תזכה באירוויזיון 2026?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "אלבניה", kind: "named-outcome" },
                { label: "ישראל", kind: "named-outcome" },
                { label: "בריטניה", kind: "named-outcome" }
              ],
              whyNow: "גמר אירוויזיון 2026 מתקיים הערב ויש מקור רשמי לתוצאות.",
              decisionSummary: "Official scoreboard multi-outcome.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Eurovision official Grand Final page.",
              topRisks: [],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["Eurovision official schedule"],
                ground: ["Eurovision Grand Final page"],
                resolve: [
                  "Eurovision official Grand Final scoreboard: https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
                ]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean official source and Hebrew contract",
              suggestedCloseShape: "Close before May 16, 2026 at 19:00 UTC.",
              suggestedResolutionAnchor:
                "Eurovision official Grand Final scoreboard: https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
              topSourceRefs: [
                "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
              ],
              topSourceIds: ["src_eurovision_official"],
              sensitivityLevel: "normal",
              createdAt: "2026-05-16T09:45:00.000Z"
            }
          ]
        }
      ],
      "2026-05-16T09:55:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.contract).toMatchObject({
      measurementKind: "official_value",
      resultShape: "multi_outcome",
      oracleCapability: "supported_final_only"
    });
    expect(drafts[0]?.contract?.outcomeMap.map((outcome) => outcome.evidenceKey)).toEqual([
      "country:albania",
      "country:israel",
      "country:united-kingdom"
    ]);
    expect(drafts[0]?.contract?.outcomeMap[0]?.resolutionPath).toContain("התוצאה הרשמית הסופית");
  });

  it("refuses creation drafts for non-local or still-ungrounded review items", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_noise",
          reviewItemId: "rh_noise",
          candidateMarketId: "cm_noise",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "fine",
          reviewedAt: "2026-03-29T09:35:00Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_noise",
          generatedAt: "2026-03-29T09:31:00Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_noise",
              candidateMarketId: "cm_noise",
              category: "unknown-noise",
              headline: "Review: noise",
              question: "Will a random global thing matter here?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "Yes", kind: "binary-side" },
                { label: "No", kind: "binary-side" }
              ],
              whyNow: "Because noise exists.",
              decisionSummary: "Still weak.",
              maturity: "grounded",
              confidence: "medium",
              authorityReadiness: "medium",
              lineageContext: "new-market",
              topSupport: "Weak source.",
              topRisks: [],
              fetchNeeds: ["exact-event-date"],
              sourceRolePlan: {
                wake: ["Random feed"],
                ground: ["unknown"],
                resolve: ["unknown"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "sure",
              suggestedCloseShape: "Close before April 10, 2026.",
              suggestedResolutionAnchor: "Unknown.",
              sensitivityLevel: "normal",
              createdAt: "2026-03-29T09:30:00Z"
            }
          ]
        }
      ],
      "2026-03-29T10:00:00.000Z"
    );

    expect(drafts).toEqual([]);
  });

  it("builds a non-generic official-source rule for sports winner markets", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_nba_game7",
          reviewItemId: "rh_nba_2026_05_03_raptors_cavaliers_game7",
          candidateMarketId: "cm_nba_2026_05_03_raptors_cavaliers_game7",
          action: "approve-with-edits",
          reasonCategory: "wording-needs-improvement",
          reasonSummary: "Localize mixed team names.",
          reviewedAt: "2026-05-03T18:20:00.000Z",
          editedQuestion: "מי תנצח במשחק 7: טורונטו ראפטורס או קליבלנד קאבלירס?",
          editedOutcomes: [
            { label: "טורונטו ראפטורס", kind: "named-outcome" },
            { label: "קליבלנד קאבלירס", kind: "named-outcome" }
          ]
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_nba_game7",
          generatedAt: "2026-05-03T18:19:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_nba_2026_05_03_raptors_cavaliers_game7",
              candidateMarketId: "cm_nba_2026_05_03_raptors_cavaliers_game7",
              intakeLane: "planned-event",
              recurringTemplateId: "sports-match-winner-v1",
              category: "sports",
              headline: "Review: NBA East First Round Game 7",
              question: "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "Toronto Raptors", kind: "named-outcome" },
                { label: "Cleveland Cavaliers", kind: "named-outcome" }
              ],
              whyNow: "Canonical closed-beta proof market.",
              decisionSummary: "Ready for human-gated publish.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "NBA official game page.",
              topRisks: [],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["NBA official games"],
                ground: ["NBA official game page"],
                resolve: [
                  "NBA official final game result: https://www.nba.com/game/tor-vs-cle-0042500137"
                ]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "Official source and close time are explicit.",
              suggestedCloseShape: "Close before May 3, 2026 at 23:30 UTC.",
              suggestedResolutionAnchor:
                "NBA official final game result: https://www.nba.com/game/tor-vs-cle-0042500137",
              sensitivityLevel: "normal",
              topSourceRefs: ["https://www.nba.com/game/tor-vs-cle-0042500137"],
              topSourceIds: ["src_nba_official_games"],
              createdAt: "2026-05-03T18:18:00.000Z"
            }
          ]
        }
      ],
      "2026-05-03T18:21:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.title).toBe("מי תנצח במשחק 7: טורונטו ראפטורס או קליבלנד קאבלירס?");
    expect(drafts[0]?.resolutionRules).toContain("מי תנצח במשחק 7");
    expect(drafts[0]?.resolutionRules).toContain("טורונטו ראפטורס / קליבלנד קאבלירס");
    expect(drafts[0]?.resolutionRules).not.toContain("Toronto Raptors");
    expect(drafts[0]?.resolutionRules).not.toContain("Cleveland Cavaliers");
    expect(drafts[0]?.resolutionRules).not.toContain("נדחה");
    expect(drafts[0]?.resolutionRules).not.toContain("הופסק");
    expect(drafts[0]?.resolutionRules).not.toContain("שוברי שוויון");
    expect(drafts[0]?.resolutionRules).toContain("https://www.nba.com/game/tor-vs-cle-0042500137");
    expect(drafts[0]?.resolutionRules).not.toBe("Resolves to the official winner of the named match or event.");
    expect(drafts[0]?.contract?.resolutionRule).toBe(drafts[0]?.resolutionRules);
    expect(drafts[0]?.contract?.delayPolicy).toContain("אם המשחק נדחה לפני תחילתו");
    expect(drafts[0]?.contract?.delayPolicy).toContain("אם המשחק התחיל");
    expect(drafts[0]?.contract?.payoutPolicy).toContain("אין להסיק תשלום מזמן סגירת המסחר בלבד");
    expect(drafts[0]?.contract).toMatchObject({
      marketKindId: "sports.game-winner",
      measurementKind: "final_winner",
      resultShape: "home_away_winner",
      oracleCapability: "supported_full_cycle",
      resolutionSource: {
        label: "אתר ה-NBA הרשמי"
      }
    });
  });

  it("explains why reviewed items did not cross into creation drafts", () => {
    const readiness = buildMarketCreationReadinessFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_noise",
          reviewItemId: "rh_noise",
          candidateMarketId: "cm_noise",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "fine",
          reviewedAt: "2026-03-29T09:35:00Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_noise",
          generatedAt: "2026-03-29T09:31:00Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_noise",
              candidateMarketId: "cm_noise",
              category: "unknown-noise",
              headline: "Review: noise",
              question: "Will a random global thing matter here?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "Yes", kind: "binary-side" },
                { label: "No", kind: "binary-side" }
              ],
              whyNow: "Because noise exists.",
              decisionSummary: "Still weak.",
              maturity: "grounded",
              confidence: "medium",
              authorityReadiness: "medium",
              lineageContext: "new-market",
              topSupport: "Weak source.",
              topRisks: [],
              fetchNeeds: ["exact-event-date"],
              sourceRolePlan: {
                wake: ["Random feed"],
                ground: ["unknown"],
                resolve: ["unknown"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "sure",
              suggestedCloseShape: "Close before April 10, 2026.",
              suggestedResolutionAnchor: "Unknown.",
              sensitivityLevel: "normal",
              createdAt: "2026-03-29T09:30:00Z"
            }
          ]
        }
      ]
    );

    expect(readiness).toHaveLength(1);
    expect(readiness[0]?.blockers).toEqual(
      expect.arrayContaining(["out-of-scope-category", "fetch-needs-open"])
    );
  });

  it("surfaces active queue items that still need explicit review feedback", () => {
    const readiness = buildMarketCreationReadinessFromData(
      [],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_unreviewed",
          generatedAt: "2026-04-20T07:50:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_unreviewed_boi",
              candidateMarketId: "cm_unreviewed_boi",
              intakeLane: "planned-event",
              recurringTemplateId: "boi-rate-decision-v1",
              category: "economy",
              headline: "Review: BOI upcoming",
              question: "החלטת בנק ישראל במאי?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "ירידה של 0.50%+", kind: "named-outcome" },
                { label: "ללא שינוי", kind: "named-outcome" }
              ],
              whyNow: "לוח החלטות ריבית רשמי.",
              decisionSummary: "מוכן לבדיקה.",
              maturity: "grounded",
              confidence: "medium",
              authorityReadiness: "high",
              lineageContext: "follow-up-branch",
              topSupport: "Bank of Israel official calendar.",
              topRisks: [],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["BOI calendar"],
                ground: ["Bank of Israel"],
                resolve: ["הודעת הריבית הרשמית של בנק ישראל."]
              },
              recommendedAction: "approve-with-edits",
              recommendedActionWhy: "clean recurring market, needs operator stamp",
              suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
              suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל.",
              sensitivityLevel: "normal",
              createdAt: "2026-04-20T07:49:00.000Z"
            }
          ]
        }
      ]
    );

    expect(readiness).toHaveLength(1);
    expect(readiness[0]).toMatchObject({
      candidateMarketId: "cm_unreviewed_boi",
      reviewItemId: "rh_unreviewed_boi",
      latestAction: "unreviewed",
      blockers: ["review-feedback-missing"],
      suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
      suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל.",
      reviewedAt: "2026-04-20T07:50:00.000Z"
    });
  });

  it("lets review feedback rescue category / close / resolution into creation", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_rescue",
          reviewItemId: "rh_rescue",
          candidateMarketId: "cm_rescue",
          action: "approve-with-edits",
          reasonCategory: "wording-needs-improvement",
          reasonSummary: "fix the create fields too",
          reviewedAt: "2026-03-29T09:35:00Z",
          editedCategory: "economy",
          editedCloseShape: "Close before April 30, 2026.",
          editedResolutionAnchor: "Bank of Israel official rate announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_rescue",
          generatedAt: "2026-03-29T09:31:00Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_rescue",
              candidateMarketId: "cm_rescue",
              category: "general",
              headline: "Review: rescue",
              question: "החלטת בנק ישראל באפריל?",
              marketForm: "multi-outcome",
              recurringTemplateId: "boi-rate-decision-v1",
              proposedOutcomes: [
                { label: "ירידה 0.25%", kind: "named-outcome" },
                { label: "ללא שינוי", kind: "named-outcome" }
              ],
              whyNow: "BOI meeting ahead.",
              decisionSummary: "good shape, missing metadata",
              maturity: "grounded",
              confidence: "medium",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "BOI source.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["BOI"],
                ground: ["BOI"],
                resolve: ["BOI"]
              },
              recommendedAction: "approve-with-edits",
              recommendedActionWhy: "fine",
              topSourceRefs: ["https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"],
              topSourceIds: ["src_boi_announcements"],
              createdAt: "2026-03-29T09:30:00Z"
            }
          ]
        }
      ],
      "2026-03-29T10:00:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      candidateMarketId: "cm_rescue",
      category: "economy",
      categoryKey: "economics",
      closeAt: "2026-04-30T00:00:00.000Z",
      resolutionSource: "Bank of Israel official rate announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"
    });
  });

  it("assigns explicit central-bank outcome ids and wide liquidity to BOI recurring drafts", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_boi_may",
          reviewItemId: "rh_boi_may",
          candidateMarketId: "cm_boi_rate_decision_may_25_2026",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean recurring series",
          reviewedAt: "2026-04-16T08:00:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_boi_may",
          generatedAt: "2026-04-16T07:50:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_boi_may",
              candidateMarketId: "cm_boi_rate_decision_may_25_2026",
              intakeLane: "planned-event",
              recurringTemplateId: "boi-rate-decision-v1",
              category: "economy",
              headline: "Review: BOI May",
              question: "החלטת בנק ישראל במאי?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "ירידה של 0.50%+", kind: "named-outcome" },
                { label: "ירידה של 0.25%", kind: "named-outcome" },
                { label: "ללא שינוי", kind: "named-outcome" },
                { label: "עלייה של 0.25%", kind: "named-outcome" },
                { label: "עלייה של 0.50%+", kind: "named-outcome" }
              ],
              whyNow: "לוח החלטות ריבית רשמי.",
              decisionSummary: "סדרה חוזרת נקייה.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Bank of Israel official calendar.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["BOI calendar"],
                ground: ["Bank of Israel"],
                resolve: ["הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
              suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
              sensitivityLevel: "normal",
              createdAt: "2026-04-16T07:49:00.000Z"
            }
          ]
        }
      ],
      "2026-04-16T08:05:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      familyKey: "boi-rate-decision-v1",
      liquidityB: "75000.00000000",
      seedAmount: "120707.843433"
    });
    expect(drafts[0]?.description).toContain("סדרה חוזרת: החלטת ריבית של בנק ישראל.");
    expect(drafts[0]?.description).toContain("מקור הכרעה: הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/");
    expect(drafts[0]?.outcomes.map((outcome) => outcome.outcomeId)).toEqual([
      "disc-cm-boi-rate-decision-may-25-2026-cut-050-plus",
      "disc-cm-boi-rate-decision-may-25-2026-cut-025",
      "disc-cm-boi-rate-decision-may-25-2026-hold",
      "disc-cm-boi-rate-decision-may-25-2026-hike-025",
      "disc-cm-boi-rate-decision-may-25-2026-hike-050-plus"
    ]);
    expect(drafts[0]?.contract).toMatchObject({
      measurementKind: "rate_direction",
      resultShape: "cut_hold_hike",
      oracleCapability: "manual_resolution_required"
    });
    expect(drafts[0]?.contract?.outcomeMap.map((outcome) => outcome.evidenceKey)).toEqual([
      "cut-050-plus",
      "cut-025",
      "hold",
      "hike-025",
      "hike-050-plus"
    ]);
  });

  it("blocks official-source families that do not have an Oracle consumption path yet", () => {
    const feedbackLog = [
      {
        objectType: "review_feedback_item" as const,
        reviewFeedbackId: "rf_fed_june",
        reviewItemId: "rh_fed_june",
        candidateMarketId: "cm_fed_rate_decision_june_2026",
        action: "approve" as const,
        reasonCategory: "good-as-is" as const,
        reasonSummary: "official source exists",
        reviewedAt: "2026-05-10T10:00:00.000Z"
      }
    ];
    const queueHistory = [
      {
        objectType: "review_queue_snapshot" as const,
        snapshotId: "rqs_fed_june",
        generatedAt: "2026-05-10T09:59:00.000Z",
        itemCount: 1,
        items: [
          {
            objectType: "review_handoff_item" as const,
            reviewItemId: "rh_fed_june",
            candidateMarketId: "cm_fed_rate_decision_june_2026",
            intakeLane: "planned" as const,
            recurringTemplateId: "fed-rate-decision-v1" as const,
            category: "economy",
            headline: "Review: Fed June",
            question: "מה תהיה החלטת הריבית של הפד ביוני?",
            marketForm: "multi-outcome" as const,
            proposedOutcomes: [
              { label: "ירידה", kind: "named-outcome" as const },
              { label: "ללא שינוי", kind: "named-outcome" as const },
              { label: "עלייה", kind: "named-outcome" as const }
            ],
            whyNow: "Official FOMC calendar.",
            decisionSummary: "Needs Oracle adapter.",
            maturity: "review-ready" as const,
            confidence: "high" as const,
            authorityReadiness: "high" as const,
            lineageContext: "new-market" as const,
            topSupport: "Federal Reserve official RSS.",
            topRisks: [],
            fetchNeeds: [],
            sourceRolePlan: {
              wake: ["Federal Reserve"],
              ground: ["Federal Reserve"],
              resolve: ["Federal Reserve official announcement: https://www.federalreserve.gov/feeds/feeds.htm"]
            },
            recommendedAction: "approve" as const,
            recommendedActionWhy: "official",
            suggestedCloseShape: "Close before June 17, 2026 at 18:00 UTC.",
            suggestedResolutionAnchor: "Federal Reserve official announcement: https://www.federalreserve.gov/feeds/feeds.htm",
            sensitivityLevel: "normal" as const,
            topSourceRefs: ["https://www.federalreserve.gov/feeds/feeds.htm"],
            topSourceIds: ["src_federal_reserve_rss"],
            createdAt: "2026-05-10T09:58:00.000Z"
          }
        ]
      }
    ];

    expect(buildMarketCreationDraftsFromData(feedbackLog, queueHistory, "2026-05-10T10:01:00.000Z")).toEqual([]);

    const readiness = buildMarketCreationReadinessFromData(feedbackLog, queueHistory);
    expect(readiness[0]?.blockers).toContain("oracle-capability-blocked");
    expect(readiness[0]?.contract).toMatchObject({
      marketKindId: "economy.central-bank-rate-decision",
      measurementKind: "rate_direction",
      resultShape: "cut_hold_hike",
      oracleCapability: "blocked"
    });
  });

  it("blocks otherwise-ready creation drafts when Oracle capability is unknown", () => {
    const feedbackLog = [
      {
        objectType: "review_feedback_item" as const,
        reviewFeedbackId: "rf_unknown_lifecycle",
        reviewItemId: "rh_unknown_lifecycle",
        candidateMarketId: "cm_unknown_lifecycle",
        action: "approve" as const,
        reasonCategory: "good-as-is" as const,
        reasonSummary: "looks ready except lifecycle",
        reviewedAt: "2026-05-10T11:00:00.000Z"
      }
    ];
    const queueHistory = [
      {
        objectType: "review_queue_snapshot" as const,
        snapshotId: "rqs_unknown_lifecycle",
        generatedAt: "2026-05-10T10:59:00.000Z",
        itemCount: 1,
        items: [
          {
            objectType: "review_handoff_item" as const,
            reviewItemId: "rh_unknown_lifecycle",
            candidateMarketId: "cm_unknown_lifecycle",
            intakeLane: "live" as const,
            lineageId: "lin_unknown_lifecycle",
            category: "sports",
            headline: "Review: unknown lifecycle",
            question: "האם הקבוצה הרשמית תנצח?",
            marketForm: "binary" as const,
            proposedOutcomes: [
              { label: "כן", kind: "binary-side" as const },
              { label: "לא", kind: "binary-side" as const }
            ],
            whyNow: "Bounded event.",
            decisionSummary: "Source/rule/timeline are present.",
            maturity: "review-ready" as const,
            confidence: "high" as const,
            authorityReadiness: "high" as const,
            lineageContext: "new-market" as const,
            topSupport: "Official source.",
            topRisks: [],
            fetchNeeds: [],
            sourceRolePlan: {
              wake: ["Unknown official source"],
              ground: ["Unknown official source"],
              resolve: ["Unknown official source: https://example.test/final"]
            },
            recommendedAction: "approve" as const,
            recommendedActionWhy: "official",
            suggestedCloseShape: "Close before May 12, 2026 at 19:00 UTC.",
            suggestedResolutionAnchor: "Unknown official source: https://example.test/final",
            sensitivityLevel: "normal" as const,
            topSourceRefs: ["https://example.test/final"],
            topSourceIds: ["src_unknown_official"],
            createdAt: "2026-05-10T10:59:00.000Z"
          }
        ]
      }
    ];

    expect(buildMarketCreationDraftsFromData(feedbackLog, queueHistory, "2026-05-10T11:01:00.000Z")).toEqual([]);

    const readiness = buildMarketCreationReadinessFromData(feedbackLog, queueHistory);
    expect(readiness[0]?.blockers).toContain("missing-oracle-capability");
  });

  it("keeps only one creation-ready copy of the same recurring decision event", () => {
    const feedbackLog = [
      {
        objectType: "review_feedback_item" as const,
        reviewFeedbackId: "rf_boi_may_old",
        reviewItemId: "rh_boi_may_old",
        candidateMarketId: "cm_boi_rate_decision_may_25_2026",
        action: "approve" as const,
        reasonCategory: "good-as-is" as const,
        reasonSummary: "older duplicate",
        reviewedAt: "2026-04-16T08:00:00.000Z"
      },
      {
        objectType: "review_feedback_item" as const,
        reviewFeedbackId: "rf_boi_may_v2",
        reviewItemId: "rh_boi_may_v2",
        candidateMarketId: "cm_boi_rate_decision_may_25_2026_contract_test_v2",
        action: "approve" as const,
        reasonCategory: "good-as-is" as const,
        reasonSummary: "newer wording",
        reviewedAt: "2026-04-16T09:00:00.000Z"
      }
    ];
    const queueHistory = [
      {
        objectType: "review_queue_snapshot" as const,
        snapshotId: "rqs_boi_may_duplicates",
        generatedAt: "2026-04-16T07:50:00.000Z",
        itemCount: 2,
        items: [
          {
            objectType: "review_handoff_item" as const,
            reviewItemId: "rh_boi_may_old",
            candidateMarketId: "cm_boi_rate_decision_may_25_2026",
            intakeLane: "planned-event" as const,
            recurringTemplateId: "boi-rate-decision-v1" as const,
            category: "economy",
            headline: "Review: BOI May",
            question: "החלטת בנק ישראל במאי?",
            marketForm: "multi-outcome" as const,
            proposedOutcomes: [
              { label: "ירידה של 0.25%", kind: "named-outcome" as const },
              { label: "ללא שינוי", kind: "named-outcome" as const },
              { label: "עלייה של 0.25%", kind: "named-outcome" as const }
            ],
            whyNow: "לוח החלטות ריבית רשמי.",
            decisionSummary: "סדרה חוזרת נקייה.",
            maturity: "review-ready" as const,
            confidence: "high" as const,
            authorityReadiness: "high" as const,
            lineageContext: "new-market" as const,
            topSupport: "Bank of Israel official calendar.",
            topRisks: [],
            fetchNeeds: [],
            sourceRolePlan: {
              wake: ["BOI calendar"],
              ground: ["Bank of Israel"],
              resolve: ["הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/"]
            },
            recommendedAction: "approve" as const,
            recommendedActionWhy: "clean",
            suggestedCloseShape: "Close before May 25, 2026 at 16:00.",
            suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/",
            sensitivityLevel: "normal" as const,
            createdAt: "2026-04-16T07:49:00.000Z"
          },
          {
            objectType: "review_handoff_item" as const,
            reviewItemId: "rh_boi_may_v2",
            candidateMarketId: "cm_boi_rate_decision_may_25_2026_contract_test_v2",
            intakeLane: "planned-event" as const,
            recurringTemplateId: "boi-rate-decision-v1" as const,
            category: "economy",
            headline: "Review: BOI May v2",
            question: "ריבית בנק ישראל: 25 במאי",
            marketForm: "multi-outcome" as const,
            proposedOutcomes: [
              { label: "ירידה של 0.25%", kind: "named-outcome" as const },
              { label: "ללא שינוי", kind: "named-outcome" as const },
              { label: "עלייה של 0.25%", kind: "named-outcome" as const }
            ],
            whyNow: "בדיקת full cycle נקייה.",
            decisionSummary: "סדרה חוזרת נקייה.",
            maturity: "review-ready" as const,
            confidence: "high" as const,
            authorityReadiness: "high" as const,
            lineageContext: "new-market" as const,
            topSupport: "Bank of Israel official calendar.",
            topRisks: [],
            fetchNeeds: [],
            sourceRolePlan: {
              wake: ["BOI calendar"],
              ground: ["Bank of Israel"],
              resolve: ["הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"]
            },
            recommendedAction: "approve" as const,
            recommendedActionWhy: "clean",
            suggestedCloseShape: "Close before May 25, 2026 at 13:00.",
            suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
            sensitivityLevel: "normal" as const,
            createdAt: "2026-04-16T07:50:00.000Z"
          }
        ]
      }
    ];

    const drafts = buildMarketCreationDraftsFromData(feedbackLog, queueHistory, "2026-04-16T09:05:00.000Z");
    const readiness = buildMarketCreationReadinessFromData(feedbackLog, queueHistory);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.candidateMarketId).toBe("cm_boi_rate_decision_may_25_2026_contract_test_v2");
    expect(readiness).toHaveLength(1);
    expect(readiness[0]?.candidateMarketId).toBe("cm_boi_rate_decision_may_25_2026_contract_test_v2");
  });

  it("keeps draw as an official final-result sports option", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_winner_sports",
          reviewItemId: "rh_winner_sports",
          candidateMarketId: "cm_winner_sports",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean sports winner card",
          reviewedAt: "2026-04-16T12:20:00.000Z"
        },
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_football_three_way",
          reviewItemId: "rh_football_three_way",
          candidateMarketId: "cm_football_three_way",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean football card",
          reviewedAt: "2026-04-16T12:21:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_sports_family",
          generatedAt: "2026-04-16T12:10:00.000Z",
          itemCount: 2,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_winner_sports",
              candidateMarketId: "cm_winner_sports",
              lineageId: "lin_sports_match_hapoel_jerusalem_vs_bnei_herzliya",
              recurringTemplateId: "sports-match-winner-v1",
              category: "sports",
              headline: "Review: basketball",
              question: "הפועל ירושלים נגד בני הרצליה?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "הפועל ירושלים", kind: "named-outcome" },
                { label: "בני הרצליה", kind: "named-outcome" }
              ],
              whyNow: "לוח משחקים רשמי.",
              decisionSummary: "משחק מקומי רשמי.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Winner League official feed.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["מנהלת ליגת Winner סל"],
                ground: ["מנהלת ליגת Winner סל"],
                resolve: ["תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before April 18, 2026 at 20:20.",
              suggestedResolutionAnchor: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/",
              sensitivityLevel: "normal",
              createdAt: "2026-04-16T12:09:00.000Z"
            },
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_football_three_way",
              candidateMarketId: "cm_football_three_way",
              lineageId: "lin_sports_match_barcelona_vs_espanyol",
              recurringTemplateId: "sports-regulation-3way-v1",
              category: "sports",
              headline: "Review: football",
              question: "ברצלונה נגד אספניול (לה ליגה, 18 באפריל)",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "ברצלונה", kind: "named-outcome" },
                { label: "תיקו", kind: "named-outcome" },
                { label: "אספניול", kind: "named-outcome" }
              ],
              whyNow: "דרבי רשמי.",
              decisionSummary: "כדורגל זמן רגיל.",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Official league listing.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["La Liga"],
                ground: ["La Liga"],
                resolve: ["Official La Liga match result: https://www.laliga.com/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before April 18, 2026 at 21:00.",
              suggestedResolutionAnchor: "Official La Liga match result: https://www.laliga.com/",
              sensitivityLevel: "normal",
              createdAt: "2026-04-16T12:09:30.000Z"
            }
          ]
        }
      ],
      "2026-04-16T12:25:00.000Z"
    );

    expect(drafts).toHaveLength(2);
    const winnerDraft = drafts.find((draft) => draft.candidateMarketId === "cm_winner_sports");
    const footballDraft = drafts.find((draft) => draft.candidateMarketId === "cm_football_three_way");

    expect(winnerDraft?.outcomes.map((outcome) => outcome.label)).toEqual(["הפועל ירושלים", "בני הרצליה"]);
    expect(winnerDraft?.familyKey).toBe("lin-sports-match-hapoel-jerusalem-vs-bnei-herzliya");
    expect(winnerDraft?.contract?.marketKindId).toBe("sports.game-winner");
    expect(winnerDraft?.resolutionRules).toContain("הפועל ירושלים נגד בני הרצליה");
    expect(winnerDraft?.resolutionRules).toContain("הפועל ירושלים / בני הרצליה");
    expect(winnerDraft?.resolutionRules).toContain("https://basket.co.il/");
    expect(winnerDraft?.resolutionRules).not.toBe("Resolves to the official winner of the named match or event.");

    expect(footballDraft?.outcomes.map((outcome) => outcome.label)).toEqual(["ברצלונה", "תיקו", "אספניול"]);
    expect(footballDraft?.familyKey).toBe("lin-sports-match-barcelona-vs-espanyol");
    expect(footballDraft?.resolutionRules).toContain("ברצלונה נגד אספניול");
    expect(footballDraft?.resolutionRules).toContain("ברצלונה / תיקו / אספניול");
    expect(footballDraft?.resolutionRules).toContain("https://www.laliga.com/");
    expect(footballDraft?.resolutionRules).toContain("התוצאה הרשמית הסופית");
    expect(footballDraft?.resolutionRules).toContain("אם המקור הרשמי מציג תיקו כתוצאה סופית");
    expect(footballDraft?.resolutionRules).not.toContain("הארכה");
    expect(footballDraft?.contract?.timeline.expectedResolutionAt).toBe("2026-04-19T00:00:00.000Z");
    expect(footballDraft?.resolutionRules).not.toBe(
      "Resolves to the official regulation-time result of the named match. Extra time, penalties, and shootouts do not count."
    );
  });

  it("normalizes non-ascii lineage families into backend-safe family keys", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_hebrew_family",
          reviewItemId: "rh_hebrew_family",
          candidateMarketId: "cm_hebrew_family",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean local sports card",
          reviewedAt: "2026-04-16T12:30:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_hebrew_family",
          generatedAt: "2026-04-16T12:20:00.000Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_hebrew_family",
              candidateMarketId: "cm_hebrew_family",
              lineageId: "lin_sports_match_בני_הרצליה_vs_הפועל_י_ם",
              recurringTemplateId: "sports-match-winner-v1",
              category: "sports",
              headline: "Review: local sports",
              question: "הפועל ירושלים נגד בני הרצליה?",
              marketForm: "multi-outcome",
              proposedOutcomes: [
                { label: "הפועל ירושלים", kind: "named-outcome" },
                { label: "בני הרצליה", kind: "named-outcome" }
              ],
              whyNow: "לוח משחקים רשמי.",
              decisionSummary: "clean",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "Winner League official feed.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["מנהלת ליגת Winner סל"],
                ground: ["מנהלת ליגת Winner סל"],
                resolve: ["תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before April 18, 2026 at 20:20.",
              suggestedResolutionAnchor: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/",
              sensitivityLevel: "normal",
              createdAt: "2026-04-16T12:19:00.000Z"
            }
          ]
        }
      ],
      "2026-04-16T12:35:00.000Z"
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.familyKey).toMatch(/^family-[a-f0-9]{12}$/);
    expect(drafts[0]?.familyKey).not.toBe("sports-match-winner-v1");
  });

  it("keeps bounded knesset dissolution siblings in one family", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_knesset_april",
          reviewItemId: "rh_knesset_april",
          candidateMarketId: "cm_knesset_april",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean politics family",
          reviewedAt: "2026-04-16T13:00:00.000Z"
        },
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_knesset_may",
          reviewItemId: "rh_knesset_may",
          candidateMarketId: "cm_knesset_may",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clean politics family",
          reviewedAt: "2026-04-16T13:01:00.000Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_knesset_family",
          generatedAt: "2026-04-16T12:55:00.000Z",
          itemCount: 2,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_knesset_april",
              candidateMarketId: "cm_knesset_april",
              lineageId: "lin_knesset_dissolution_2026",
              recurringTemplateId: "knesset-dissolution-before-date-v1",
              category: "politics",
              headline: "Review: knesset april",
              question: "האם הכנסת תתפזר עד 30 באפריל 2026?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "כן", kind: "binary-side" },
                { label: "לא", kind: "binary-side" }
              ],
              whyNow: "חלון פוליטי תחום בזמן.",
              decisionSummary: "clean",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "follow-up-branch",
              topSupport: "Knesset official.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["הכנסת"],
                ground: ["הכנסת"],
                resolve: ["הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before April 30, 2026 at 20:59.",
              suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/",
              sensitivityLevel: "elevated",
              createdAt: "2026-04-16T12:54:00.000Z"
            },
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_knesset_may",
              candidateMarketId: "cm_knesset_may",
              lineageId: "lin_knesset_dissolution_2026",
              recurringTemplateId: "knesset-dissolution-before-date-v1",
              category: "politics",
              headline: "Review: knesset may",
              question: "האם הכנסת תתפזר עד 31 במאי 2026?",
              marketForm: "binary",
              proposedOutcomes: [
                { label: "כן", kind: "binary-side" },
                { label: "לא", kind: "binary-side" }
              ],
              whyNow: "חלון פוליטי תחום בזמן.",
              decisionSummary: "clean",
              maturity: "review-ready",
              confidence: "high",
              authorityReadiness: "high",
              lineageContext: "follow-up-branch",
              topSupport: "Knesset official.",
              topRisks: [],
              sourceRolePlan: {
                wake: ["הכנסת"],
                ground: ["הכנסת"],
                resolve: ["הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "clean",
              suggestedCloseShape: "Close before May 31, 2026 at 20:59.",
              suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת: https://main.knesset.gov.il/",
              sensitivityLevel: "elevated",
              createdAt: "2026-04-16T12:54:30.000Z"
            }
          ]
        }
      ],
      "2026-04-16T13:05:00.000Z"
    );

    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.familyKey).toBe("lin-knesset-dissolution-2026");
    expect(drafts[1]?.familyKey).toBe("lin-knesset-dissolution-2026");
    expect(drafts[0]?.resolutionRules).toBe(
      "מוכרע לפי הצבעה רשמית על פיזור הכנסת או פרסום רשמי על פיזור הכנסת לפני מועד הסגירה. אם לא היה פיזור רשמי עד המועד, התוצאה היא 'לא'."
    );
  });

  it("keeps Hebrew date-bucket outcome ids unique when slugification loses month words", () => {
    const drafts = buildMarketCreationDraftsFromData(
      [
        {
          objectType: "review_feedback_item",
          reviewFeedbackId: "rf_hormuz",
          reviewItemId: "rh_hormuz",
          candidateMarketId: "cm_hormuz",
          action: "approve",
          reasonCategory: "good-as-is",
          reasonSummary: "clear date buckets",
          reviewedAt: "2026-04-20T07:07:51.084Z"
        }
      ],
      [
        {
          objectType: "review_queue_snapshot",
          snapshotId: "rqs_hormuz",
          generatedAt: "2026-04-20T07:07:39.550Z",
          itemCount: 1,
          items: [
            {
              objectType: "review_handoff_item",
              reviewItemId: "rh_hormuz",
              candidateMarketId: "cm_hormuz",
              intakeLane: "shock-discovery",
              lineageId: "lin_hormuz_traffic_recovery",
              category: "economy",
              headline: "Review: חזרת תנועת הספינות במצר הורמוז לרמה רגילה",
              question: "מתי תחזור תנועת הספינות במצר הורמוז לרמה רגילה?",
              marketForm: "date-bucket",
              proposedOutcomes: [
                { label: "עד 30 באפריל 2026", kind: "date-bucket" },
                { label: "עד 31 במאי 2026", kind: "date-bucket" },
                { label: "עד 30 ביוני 2026", kind: "date-bucket" },
                { label: "עד 31 ביולי 2026", kind: "date-bucket" },
                { label: "לא חזר לנורמה עד סוף יולי 2026", kind: "date-bucket" }
              ],
              whyNow: "Macro-shipping recovery window.",
              decisionSummary: "clear bounded date buckets",
              maturity: "grounded",
              confidence: "medium",
              authorityReadiness: "high",
              lineageContext: "new-market",
              topSupport: "IMF PortWatch source.",
              topRisks: [
                "יש להכריע לפי המועד הראשון שבו ערך הממוצע נע 7-יומי מגיע ל-60 או יותר, לא לפי כל ניסוח אחר של 'נורמה'.",
                "אם PortWatch יעדכן רטרואקטיבית נקודות בתוך חלון השוק, יש להסתמך על הנתונים שפורסמו עבור הימים עד סוף יולי 2026 בלבד."
              ],
              fetchNeeds: [],
              sourceRolePlan: {
                wake: ["IMF PortWatch"],
                ground: ["IMF PortWatch"],
                resolve: ["IMF PortWatch: https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730"]
              },
              recommendedAction: "approve",
              recommendedActionWhy: "bounded and source-anchored",
              suggestedCloseShape: "Close before July 31, 2026 at 23:59.",
              suggestedResolutionAnchor: "IMF PortWatch: https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730",
              sensitivityLevel: "normal",
              topSourceRefs: ["https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730"],
              topSourceIds: ["src_imf_portwatch_hormuz"],
              createdAt: "2026-04-20T07:10:00Z"
            }
          ]
        }
      ],
      "2026-04-20T07:07:51.110Z"
    );

    expect(drafts).toHaveLength(1);
    expect(new Set(drafts[0]?.outcomes.map((outcome) => outcome.outcomeId)).size).toBe(5);
    expect(drafts[0]?.resolutionRules).toContain("ממוצע נע 7-יומי");
    expect(drafts[0]?.resolutionRules).toContain("60 או יותר");
    expect(drafts[0]?.resolutionRules).toContain("31 ביולי 2026");
    expect(drafts[0]?.contract).toMatchObject({
      objectType: "market_contract_v1",
      resolutionSource: {
        url: "https://portwatch.imf.org/pages/cb5856222d5b4105adc6ee7e880d1730"
      },
      reviewBlockers: []
    });
    expect(drafts[0]?.contract?.dataRevisionPolicy).toContain("official data");
  });

  it("blocks publish when a market-reference URL is used as the resolution source", () => {
    const feedbackLog = [
      {
        objectType: "review_feedback_item" as const,
        reviewFeedbackId: "rf_reference_only_resolution",
        reviewItemId: "rh_reference_only_resolution",
        candidateMarketId: "cm_reference_only_resolution",
        action: "approve" as const,
        reasonCategory: "good-as-is" as const,
        reasonSummary: "operator approved before source guardrail",
        reviewedAt: "2026-05-09T16:00:00.000Z"
      }
    ];
    const queueHistory = [
      {
        objectType: "review_queue_snapshot" as const,
        snapshotId: "rqs_reference_only_resolution",
        generatedAt: "2026-05-09T15:55:00.000Z",
        itemCount: 1,
        items: [
          {
            objectType: "review_handoff_item" as const,
            reviewItemId: "rh_reference_only_resolution",
            candidateMarketId: "cm_reference_only_resolution",
            lineageId: "lin_reference_only_resolution",
            category: "sports",
            headline: "Review: reference-only sports market",
            question: "האם קבוצת אלפא תנצח את קבוצת בטא?",
            marketForm: "binary" as const,
            proposedOutcomes: [
              { label: "כן", kind: "yes" as const },
              { label: "לא", kind: "no" as const }
            ],
            whyNow: "Polymarket shape reference exists.",
            decisionSummary: "shape only, not resolution authority",
            maturity: "review-ready" as const,
            confidence: "medium" as const,
            authorityReadiness: "medium" as const,
            lineageContext: "new-market" as const,
            topSupport: "Polymarket reference page.",
            topRisks: ["External Polymarket reference is candidate input, not Navi settlement authority."],
            sourceRolePlan: {
              wake: ["Polymarket reference"],
              ground: ["trusted fixture / schedule source"],
              resolve: ["Polymarket reference: https://polymarket.com/event/example-reference-only"]
            },
            recommendedAction: "approve" as const,
            recommendedActionWhy: "operator approval is not enough without an authority source",
            suggestedCloseShape: "Close before May 10, 2026 at 18:00.",
            suggestedResolutionAnchor: "Polymarket reference: https://polymarket.com/event/example-reference-only",
            sensitivityLevel: "normal" as const,
            topSourceRefs: ["https://polymarket.com/event/example-reference-only"],
            topSourceIds: ["src_polymarket_market_reference"],
            createdAt: "2026-05-09T15:50:00.000Z"
          }
        ]
      }
    ];

    const drafts = buildMarketCreationDraftsFromData(feedbackLog, queueHistory, "2026-05-09T16:01:00.000Z");
    const readiness = buildMarketCreationReadinessFromData(feedbackLog, queueHistory);

    expect(drafts).toHaveLength(0);
    expect(readiness[0]?.blockers).toContain("reference-only-resolution-source");
  });
});
