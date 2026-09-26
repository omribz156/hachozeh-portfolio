import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  approveOracleCloseConditionCase,
  approveOracleResolutionCase,
  OracleReviewActionError,
  rejectOracleCase,
  requestMoreEvidenceForOracleCase
} from "../../../../oracle/src/review-action-service";

const {
  closeMarketMock,
  readOracleCaseDetailMock,
  resolveMarketMock
} = vi.hoisted(() => ({
  closeMarketMock: vi.fn(),
  readOracleCaseDetailMock: vi.fn(),
  resolveMarketMock: vi.fn()
}));

vi.mock("../../../src/lifecycle/horizon/close-market-service", () => ({
  closeMarket: closeMarketMock
}));

vi.mock("../../../../oracle/src/review-queue-service", () => ({
  readOracleCaseDetail: readOracleCaseDetailMock
}));

vi.mock("../../../../oracle/src/resolve-market-service", () => ({
  resolveMarket: resolveMarketMock
}));

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

type ReviewRow = {
  id: string;
  oracle_case_id: string;
  market_id: string;
  review_action: string;
  result_status: "attempted" | "completed" | "failed";
  actor_id: string;
  actor_role: string;
  review_note: string | null;
  idempotency_key: string;
  resolution_id: string | null;
  resolve_response_snapshot: Record<string, unknown> | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
};

function createDbPool(options?: {
  reviews?: ReviewRow[];
  dependentTriggerRows?: Record<string, unknown>[];
  dependentCandidateRows?: Record<string, unknown>[];
}) {

  const reviews: ReviewRow[] = [...(options?.reviews ?? [])];

  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from oracle_case_reviews") && sql.includes("where oracle_case_id = $1")) {
        const [oracleCaseId, reviewAction, idempotencyKey] = params;
        return {
          rows: reviews.filter(
            (review) =>
              review.oracle_case_id === oracleCaseId &&
              review.review_action === reviewAction &&
              review.idempotency_key === idempotencyKey
          ),
          rowCount: 1
        };
      }

      if (sql.includes("insert into oracle_case_reviews")) {
        reviews.push({
          id: params[0] as string,
          oracle_case_id: params[1] as string,
          market_id: params[2] as string,
          review_action: params[3] as string,
          result_status: params[4] as "attempted" | "completed" | "failed",
          actor_id: params[5] as string,
          actor_role: params[6] as string,
          review_note: params[7] as string | null,
          idempotency_key: params[8] as string,
          resolution_id: params[9] as string | null,
          resolve_response_snapshot: params[10]
            ? JSON.parse(params[10] as string)
            : null,
          failure_code: params[11] as string | null,
          failure_message: params[12] as string | null,
          created_at: params[13] as string,
          completed_at: params[14] as string | null,
          failed_at: params[15] as string | null
        });

        return {
          rows: [],
          rowCount: 1
        };
      }

      if (sql.includes("update oracle_case_reviews")) {
        const review = reviews.find((candidate) => candidate.id === params[0]);
        if (review) {
          review.result_status = params[1] as "attempted" | "completed" | "failed";
          review.review_note = params[2] as string | null;
          review.resolution_id = params[3] as string | null;
          review.resolve_response_snapshot = params[4]
            ? JSON.parse(params[4] as string)
            : null;
          review.failure_code = params[5] as string | null;
          review.failure_message = params[6] as string | null;
          review.completed_at = params[7] as string | null;
          review.failed_at = params[8] as string | null;
        }

        return {
          rows: [],
          rowCount: review ? 1 : 0
        };
      }

      if (sql.includes("select event_id") && sql.includes("from markets")) {
        return {
          rows: [{ event_id: null }],
          rowCount: 1
        };
      }

      if (sql.includes("where m.id = $1") && sql.includes("m.market_contract")) {
        return {
          rows: options?.dependentTriggerRows ?? [],
          rowCount: options?.dependentTriggerRows?.length ?? 0
        };
      }

      if (sql.includes("where m.id <> $1") && sql.includes("m.market_contract")) {
        return {
          rows: options?.dependentCandidateRows ?? [],
          rowCount: options?.dependentCandidateRows?.length ?? 0
        };
      }

      return {
        rows: [],
        rowCount: 1
      };
    })
  } as unknown as Pool;
}

function createCloseConditionCaseDetail() {
  return {
    objectType: "oracle_case_detail",
    item: {
      oracleCaseId: "orc_close_in_10_min_early",
      marketId: "oracle_dummy_close_in_10_min",
      marketTitle: "will this market close in 10 min",
      caseType: "close_condition_check",
      marketStatus: "open",
      caseStatus: "recommended",
      ambiguityLevel: "low",
      summary: "External context confirms event completion before scheduled close.",
      scheduledCloseAt: "2026-05-03T12:10:00.000Z",
      createdAt: "2026-05-03T12:04:00.000Z",
      updatedAt: "2026-05-03T12:04:00.000Z",
      winningOutcomeId: null,
      winningOutcomeLabel: null,
      sourcePolicy: {
        closeConditionSourceIds: ["src_dummy_context"]
      },
      contractHints: {
        sourceRolePlan: {
          wake: [],
          ground: ["Dummy context source"],
          resolve: [],
          integrity: []
        },
        fetchNeeds: [],
        policyNotes: []
      },
      evidencePacket: {
        evidencePacketId: "evp_close_in_10_min",
        evidenceSummary: "Dummy source confirms this market should close early.",
        capturedAt: "2026-05-03T12:04:00.000Z",
        sourceCount: 1,
        closeConditionSatisfied: true
      },
      output: {
        outputId: "ecr_close_in_10_min",
        outputType: "early_close_recommendation",
        snapshot: {
          reasonSummary: "Dummy context confirms the close condition before the 10-minute EOL."
        }
      }
    },
    evidenceSources: [
      {
        sourceId: "src_dummy_context",
        sourceUrl: "https://example.com/oracle/dummy-close-before-eol",
        sourceLabel: "Dummy context source",
        sourceType: "official",
        capturedAt: "2026-05-03T12:04:00.000Z",
        claimSummary: "Close condition satisfied before scheduled EOL."
      }
    ],
    outputSnapshot: {
      objectType: "early_close_recommendation",
      reasonSummary: "Dummy context confirms the close condition before the 10-minute EOL."
    },
    reviewHistory: []
  };
}

function createResolutionCaseDetail() {
  return {
    objectType: "oracle_case_detail",
    item: {
      oracleCaseId: "orc_case_1",
      marketId: "market_seed_next_prime_minister",
      marketTitle: "מי יהיה ראש הממשלה הבא?",
      caseType: "resolution_check",
      marketStatus: "closed",
      caseStatus: "recommended",
      ambiguityLevel: "low",
      summary: "Winner maps cleanly.",
      scheduledCloseAt: "2026-06-22T20:00:00.000Z",
      createdAt: "2026-06-22T18:12:00.000Z",
      updatedAt: "2026-06-22T18:12:00.000Z",
      winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
      winningOutcomeLabel: "מועמד א'",
      sourcePolicy: {
        resolutionSourceIds: ["src_gov_il_news"]
      },
      contractHints: {
        sourceRolePlan: {
          wake: [],
          ground: [],
          resolve: [],
          integrity: []
        },
        fetchNeeds: [],
        policyNotes: []
      },
      evidencePacket: {
        evidencePacketId: "evp_case_1",
        evidenceSummary: "Gov.il names Candidate A.",
        capturedAt: "2026-06-22T18:11:00.000Z",
        sourceCount: 1,
        closeConditionSatisfied: null
      },
      output: {
        outputId: "rrc_case_1",
        outputType: "resolution_recommendation",
        snapshot: {
          winningOutcomeKey: "option-a"
        }
      }
    },
    evidenceSources: [
      {
        sourceId: "src_gov_il_news",
        sourceUrl: "https://www.gov.il/en/departments/news",
        sourceLabel: "Gov.il",
        sourceType: "official",
        capturedAt: "2026-06-22T18:11:00.000Z",
        claimSummary: "Gov.il names Candidate A."
      }
    ],
    outputSnapshot: {
      objectType: "resolution_recommendation",
      reasonSummary: "Gov.il names Candidate A."
    }
  };
}

describe("oracle review action service", () => {
  beforeEach(() => {
    closeMarketMock.mockReset();
    readOracleCaseDetailMock.mockReset();
    resolveMarketMock.mockReset();
  });

  it("approves a close-condition Oracle case into Horizon close before scheduled EOL", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_close_in_10_min_early",
        marketId: "oracle_dummy_close_in_10_min",
        marketTitle: "will this market close in 10 min",
        caseType: "close_condition_check",
        marketStatus: "open",
        caseStatus: "recommended",
        ambiguityLevel: "low",
        summary: "External context confirms event completion before scheduled close.",
        scheduledCloseAt: "2026-05-03T12:10:00.000Z",
        createdAt: "2026-05-03T12:04:00.000Z",
        updatedAt: "2026-05-03T12:04:00.000Z",
        winningOutcomeId: null,
        winningOutcomeLabel: null,
        sourcePolicy: {
          closeConditionSourceIds: ["src_dummy_context"]
        },
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: ["Dummy context source"],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: {
          evidencePacketId: "evp_close_in_10_min",
          evidenceSummary: "Dummy source confirms this market should close early.",
          capturedAt: "2026-05-03T12:04:00.000Z",
          sourceCount: 1,
          closeConditionSatisfied: true
        },
        output: {
          outputId: "ecr_close_in_10_min",
          outputType: "early_close_recommendation",
          snapshot: {
            reasonSummary: "Dummy context confirms the close condition before the 10-minute EOL."
          }
        }
      },
      evidenceSources: [
        {
          sourceId: "src_dummy_context",
          sourceUrl: "https://example.com/oracle/dummy-close-before-eol",
          sourceLabel: "Dummy context source",
          sourceType: "official",
          capturedAt: "2026-05-03T12:04:00.000Z",
          claimSummary: "Close condition satisfied before scheduled EOL."
        }
      ],
      outputSnapshot: {
        objectType: "early_close_recommendation",
        reasonSummary: "Dummy context confirms the close condition before the 10-minute EOL."
      },
      reviewHistory: []
    });

    closeMarketMock.mockResolvedValue({
      marketId: "oracle_dummy_close_in_10_min",
      status: "closed",
      closedAt: "2026-05-03T12:04:30.000Z",
      triggerType: "oracle_confirmed_event_completion",
      auditEventId: "audit_oracle_close_1"
    });

    const result = await approveOracleCloseConditionCase(
      dbPool,
      "orc_close_in_10_min_early",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-close-before-eol-1",
        reviewNote: "Human reviewed dummy early-close evidence."
      }
    );

    expect(closeMarketMock).toHaveBeenCalledWith(
      dbPool,
      "oracle_dummy_close_in_10_min",
      expect.objectContaining({
        triggerType: "oracle_confirmed_event_completion",
        sourceUrl: "https://example.com/oracle/dummy-close-before-eol",
        oracleCaseId: "orc_close_in_10_min_early",
        triggeredByOracleId: "oracle",
        approvedByHumanId: "user_admin_1",
        idempotencyKey: "oracle-close-before-eol-1"
      }),
      ADMIN_ACTOR
    );
    expect(resolveMarketMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      objectType: "oracle_case_review_result",
      outcome: "approved_close_condition",
      review: {
        oracleCaseId: "orc_close_in_10_min_early",
        reviewAction: "approve_close_condition",
        resultStatus: "completed"
      },
      close: {
        marketId: "oracle_dummy_close_in_10_min",
        status: "closed",
        triggerType: "oracle_confirmed_event_completion"
      },
      resolution: null
    });
  });

  it("replays duplicate close-condition approval without closing twice", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue(createCloseConditionCaseDetail());

    closeMarketMock.mockResolvedValue({
      marketId: "oracle_dummy_close_in_10_min",
      status: "closed",
      closedAt: "2026-05-03T12:04:30.000Z",
      triggerType: "oracle_confirmed_event_completion",
      auditEventId: "audit_oracle_close_1"
    });

    const first = await approveOracleCloseConditionCase(
      dbPool,
      "orc_close_in_10_min_early",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-close-before-eol-retry",
        reviewNote: "Human reviewed dummy early-close evidence."
      }
    );

    const replay = await approveOracleCloseConditionCase(
      dbPool,
      "orc_close_in_10_min_early",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-close-before-eol-retry",
        reviewNote: "Duplicate click."
      }
    );

    expect(closeMarketMock).toHaveBeenCalledTimes(1);
    expect(replay).toMatchObject({
      outcome: "approved_close_condition",
      review: {
        reviewId: first.review.reviewId,
        resultStatus: "completed"
      },
      close: {
        marketId: "oracle_dummy_close_in_10_min",
        triggerType: "oracle_confirmed_event_completion"
      }
    });
  });

  it.each(["javascript:alert(1)", "http://example.com/oracle/dummy-close-before-eol"])(
    "rejects close-condition approval with unsafe evidence URL %s",
    async (sourceUrl) => {
      const dbPool = createDbPool();
      const caseDetail = createCloseConditionCaseDetail();

      readOracleCaseDetailMock.mockResolvedValue({
        ...caseDetail,
        evidenceSources: [
          {
            ...caseDetail.evidenceSources[0],
            sourceUrl
          }
        ]
      });

      await expect(
        approveOracleCloseConditionCase(
          dbPool,
          "orc_close_in_10_min_early",
          ADMIN_ACTOR,
          {
            idempotencyKey: `oracle-close-unsafe-url-${sourceUrl}`
          }
        )
      ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
        code: "oracle_case_not_approvable",
        message: "Oracle case evidence source URL must be an HTTPS URL."
      });

      expect(closeMarketMock).not.toHaveBeenCalled();
    }
  );

  it("approves a persisted Oracle resolution case into trusted resolve", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_case_1",
        marketId: "market_seed_next_prime_minister",
        marketTitle: "מי יהיה ראש הממשלה הבא?",
        caseType: "resolution_check",
        marketStatus: "closed",
        caseStatus: "recommended",
        ambiguityLevel: "low",
        summary: "Winner maps cleanly.",
        scheduledCloseAt: "2026-06-22T20:00:00.000Z",
        createdAt: "2026-06-22T18:12:00.000Z",
        updatedAt: "2026-06-22T18:12:00.000Z",
        winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
        winningOutcomeLabel: "מועמד א'",
        sourcePolicy: {
          resolutionSourceIds: ["src_gov_il_news"]
        },
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: {
          evidencePacketId: "evp_case_1",
          evidenceSummary: "Gov.il names Candidate A.",
          capturedAt: "2026-06-22T18:11:00.000Z",
          sourceCount: 1,
          closeConditionSatisfied: null
        },
        output: {
          outputId: "rrc_case_1",
          outputType: "resolution_recommendation",
          snapshot: {
            winningOutcomeKey: "option-a"
          }
        }
      },
      evidenceSources: [
        {
          sourceId: "src_gov_il_news",
          sourceUrl: "https://www.gov.il/en/departments/news",
          sourceLabel: "Gov.il",
          sourceType: "official",
          capturedAt: "2026-06-22T18:11:00.000Z",
          claimSummary: "Gov.il names Candidate A."
        }
      ],
      outputSnapshot: {
        objectType: "resolution_recommendation",
        reasonSummary: "Gov.il names Candidate A."
      }
    });

    resolveMarketMock.mockResolvedValue({
      marketId: "market_seed_next_prime_minister",
      status: "resolved",
      winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
      resolutionId: "resolution_1",
      resolvedAt: "2026-06-22T18:13:00.000Z",
      settlementStatus: "completed",
      auditEventId: "audit_1"
    });

    const result = await approveOracleResolutionCase(
      dbPool,
      "orc_case_1",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-approve-1",
        reviewNote: "Human reviewed and approved."
      }
    );

    expect(resolveMarketMock).toHaveBeenCalledWith(
      dbPool,
      "market_seed_next_prime_minister",
      expect.objectContaining({
        winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
        triggerType: "human_reviewed_oracle_resolution",
        oracleCaseId: "orc_case_1",
        approvedByHumanId: "user_admin_1",
        idempotencyKey: "oracle-approve-1"
      }),
      ADMIN_ACTOR
    );
    expect(result).toMatchObject({
      objectType: "oracle_case_review_result",
      review: {
        oracleCaseId: "orc_case_1",
        reviewAction: "approve_resolution",
        resultStatus: "completed",
        actorId: "user_admin_1"
      },
      resolution: {
        resolutionId: "resolution_1",
        status: "resolved"
      }
    });
  });

  it("closes and resolves dependent tournament-winner children after an approved elimination result", async () => {
    const triggerMarketId = "disc-fifa-portugal-spain-2026-07-06-winner";
    const winnerOutcomeId = `${triggerMarketId}-spain`;
    const dependentMarketId = "disc-fifa-world-cup-2026-winner-portugal";
    const dependentNoOutcomeId = `${dependentMarketId}-no`;
    const fifaMatchContract = {
      objectType: "market_contract_v1",
      marketKindId: "sports.game-winner",
      resultShape: "home_away_winner",
      resolutionSource: { sourceIds: ["src_fifa_match_centre"] },
      outcomeMap: [
        { outcomeLabel: "פורטוגל", resolutionPath: "Portugal is the FIFA official match winner." },
        { outcomeLabel: "ספרד", resolutionPath: "Spain is the FIFA official match winner." }
      ],
      operational: {
        eventPack: "fifa-world-cup-2026-semifinals",
        dependentEventId: "evt-fifa-world-cup-2026-winner"
      },
      dependentResolution: { emitFact: "entity_eliminated" }
    };
    const tournamentContract = {
      objectType: "market_contract_v1",
      marketKindId: "sports.tournament-winner",
      resultShape: "yes_no",
      timeline: { targetEntity: "פורטוגל" },
      taxonomy: { entities: ["portugal", "פורטוגל"], aliases: ["Portugal", "פורטוגל"] },
      operational: {
        eventPack: "fifa-world-cup-2026-winner",
        earlyEliminationClose: true
      },
      dependencyResolution: {
        acceptFact: "entity_eliminated",
        entityKey: "portugal",
        entityLabel: "פורטוגל"
      }
    };
    const dbPool = createDbPool({
      dependentTriggerRows: [
        {
          market_id: triggerMarketId,
          market_status: "resolved",
          market_title: "פורטוגל נגד ספרד",
          market_contract: fifaMatchContract,
          outcome_id: `${triggerMarketId}-portugal`,
          outcome_label: "פורטוגל",
          sort_order: 0
        },
        {
          market_id: triggerMarketId,
          market_status: "resolved",
          market_title: "פורטוגל נגד ספרד",
          market_contract: fifaMatchContract,
          outcome_id: winnerOutcomeId,
          outcome_label: "ספרד",
          sort_order: 1
        }
      ],
      dependentCandidateRows: [
        {
          event_id: "evt-fifa-world-cup-2026-winner",
          market_id: dependentMarketId,
          market_status: "open",
          market_title: "האם פורטוגל תזכה במונדיאל 2026?",
          market_contract: tournamentContract,
          winning_outcome_id: null,
          outcome_id: `${dependentMarketId}-yes`,
          outcome_label: "כן",
          sort_order: 0
        },
        {
          event_id: "evt-fifa-world-cup-2026-winner",
          market_id: dependentMarketId,
          market_status: "open",
          market_title: "האם פורטוגל תזכה במונדיאל 2026?",
          market_contract: tournamentContract,
          winning_outcome_id: null,
          outcome_id: dependentNoOutcomeId,
          outcome_label: "לא",
          sort_order: 1
        }
      ]
    });
    const caseDetail = createResolutionCaseDetail();

    readOracleCaseDetailMock.mockResolvedValue({
      ...caseDetail,
      item: {
        ...caseDetail.item,
        oracleCaseId: "orc_fifa_resolution",
        marketId: triggerMarketId,
        marketTitle: "פורטוגל נגד ספרד",
        winningOutcomeId: winnerOutcomeId,
        winningOutcomeLabel: "ספרד"
      },
      evidenceSources: [
        {
          ...caseDetail.evidenceSources[0],
          sourceId: "src_fifa_match_centre",
          sourceUrl: "https://www.fifa.com/en/match-centre/match/17/285023/289288/400021529",
          sourceLabel: "פיפ״א, עמוד המשחק הרשמי",
          claimSummary: "FIFA names Spain as winner."
        }
      ],
      outputSnapshot: {
        objectType: "resolution_recommendation",
        reasonSummary: "FIFA official source names Spain as winner."
      }
    });

    resolveMarketMock
      .mockResolvedValueOnce({
        marketId: triggerMarketId,
        status: "resolved",
        winningOutcomeId: winnerOutcomeId,
        resolutionId: "resolution_trigger",
        resolvedAt: "2026-07-06T22:30:00.000Z",
        settlementStatus: "completed",
        auditEventId: "audit_trigger"
      })
      .mockResolvedValueOnce({
        marketId: dependentMarketId,
        status: "resolved",
        winningOutcomeId: dependentNoOutcomeId,
        resolutionId: "resolution_dependent",
        resolvedAt: "2026-07-06T22:31:00.000Z",
        settlementStatus: "completed",
        auditEventId: "audit_dependent"
      });
    closeMarketMock.mockResolvedValue({
      marketId: dependentMarketId,
      status: "closed",
      closedAt: "2026-07-06T22:30:30.000Z",
      auditEventId: "audit_close"
    });

    const result = await approveOracleResolutionCase(
      dbPool,
      "orc_fifa_resolution",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-approve-fifa-elimination",
        reviewNote: "Human reviewed FIFA result."
      }
    );

    expect(closeMarketMock).toHaveBeenCalledWith(
      dbPool,
      dependentMarketId,
      expect.objectContaining({
        idempotencyKey: `oracle-approve-fifa-elimination:dependent-cascade-close:${dependentMarketId}`
      }),
      ADMIN_ACTOR
    );
    expect(resolveMarketMock).toHaveBeenLastCalledWith(
      dbPool,
      dependentMarketId,
      expect.objectContaining({
        winningOutcomeId: dependentNoOutcomeId,
        idempotencyKey: `oracle-approve-fifa-elimination:dependent-cascade-resolve-no:${dependentMarketId}`
      }),
      ADMIN_ACTOR
    );
    expect(result.dependentResolutionCascade).toMatchObject({
      objectType: "dependent_resolution_cascade_execution",
      plan: {
        action: "resolve_dependents_no"
      },
      resolvedDependents: [
        {
          marketId: dependentMarketId,
          noOutcomeId: dependentNoOutcomeId,
          resolutionId: "resolution_dependent",
          closedFirst: true
        }
      ],
      failedDependents: []
    });
    expect(dbPool.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into lifecycle_events"),
      expect.arrayContaining(["resolution_cascade_completed"])
    );
  });

  it("replays duplicate resolution approval without resolving twice", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue(createResolutionCaseDetail());

    resolveMarketMock.mockResolvedValue({
      marketId: "market_seed_next_prime_minister",
      status: "resolved",
      winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
      resolutionId: "resolution_1",
      resolvedAt: "2026-06-22T18:13:00.000Z",
      settlementStatus: "completed",
      auditEventId: "audit_1"
    });

    const first = await approveOracleResolutionCase(
      dbPool,
      "orc_case_1",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-approve-retry",
        reviewNote: "Human reviewed and approved."
      }
    );

    const replay = await approveOracleResolutionCase(
      dbPool,
      "orc_case_1",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-approve-retry",
        reviewNote: "Duplicate click."
      }
    );

    expect(resolveMarketMock).toHaveBeenCalledTimes(1);
    expect(replay).toMatchObject({
      outcome: "approved_resolution",
      review: {
        reviewId: first.review.reviewId,
        resultStatus: "completed"
      },
      resolution: {
        resolutionId: "resolution_1",
        status: "resolved"
      }
    });
  });

  it.each(["javascript:alert(1)", "http://www.gov.il/en/departments/news"])(
    "rejects resolution approval with unsafe evidence URL %s",
    async (sourceUrl) => {
      const dbPool = createDbPool();
      const caseDetail = createResolutionCaseDetail();

      readOracleCaseDetailMock.mockResolvedValue({
        ...caseDetail,
        evidenceSources: [
          {
            ...caseDetail.evidenceSources[0],
            sourceUrl
          }
        ]
      });

      await expect(
        approveOracleResolutionCase(
          dbPool,
          "orc_case_1",
          ADMIN_ACTOR,
          {
            idempotencyKey: `oracle-approve-unsafe-url-${sourceUrl}`
          }
        )
      ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
        code: "oracle_case_not_approvable",
        message: "Oracle case evidence source URL must be an HTTPS URL."
      });

      expect(resolveMarketMock).not.toHaveBeenCalled();
    }
  );

  it("rejects close-condition approval when Oracle did not confirm EOL", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_close_in_10_min_not_ready",
        marketId: "oracle_dummy_close_in_10_min",
        marketTitle: "will this market close in 10 min",
        caseType: "close_condition_check",
        marketStatus: "open",
        caseStatus: "recommended",
        ambiguityLevel: "low",
        summary: "Close condition not satisfied yet.",
        scheduledCloseAt: "2026-05-03T12:10:00.000Z",
        createdAt: "2026-05-03T12:03:00.000Z",
        updatedAt: "2026-05-03T12:03:00.000Z",
        winningOutcomeId: null,
        winningOutcomeLabel: null,
        sourcePolicy: null,
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: {
          evidencePacketId: "evp_not_ready",
          evidenceSummary: "Dummy source says wait.",
          capturedAt: "2026-05-03T12:03:00.000Z",
          sourceCount: 1,
          closeConditionSatisfied: false
        },
        output: {
          outputId: "ecr_not_ready",
          outputType: "early_close_recommendation",
          snapshot: {}
        }
      },
      evidenceSources: [
        {
          sourceUrl: "https://example.com/oracle/not-ready",
          sourceLabel: "Dummy source",
          sourceType: "official",
          capturedAt: "2026-05-03T12:03:00.000Z",
          claimSummary: "Close condition is not satisfied."
        }
      ],
      outputSnapshot: {
        objectType: "early_close_recommendation"
      },
      reviewHistory: []
    });

    await expect(
      approveOracleCloseConditionCase(
        dbPool,
        "orc_close_in_10_min_not_ready",
        ADMIN_ACTOR,
        {
          idempotencyKey: "oracle-close-not-ready"
        }
      )
    ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
      code: "oracle_case_not_approvable"
    });

    expect(closeMarketMock).not.toHaveBeenCalled();
  });

  it("rejects approval when the market is not closed yet", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_case_open",
        marketId: "market_seed_next_prime_minister",
        marketTitle: "מי יהיה ראש הממשלה הבא?",
        caseType: "resolution_check",
        marketStatus: "open",
        caseStatus: "recommended",
        ambiguityLevel: "low",
        summary: "Winner maps cleanly.",
        scheduledCloseAt: "2026-06-22T20:00:00.000Z",
        createdAt: "2026-06-22T18:12:00.000Z",
        updatedAt: "2026-06-22T18:12:00.000Z",
        winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
        winningOutcomeLabel: "מועמד א'",
        sourcePolicy: null,
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: null,
        output: {
          outputId: "rrc_case_open",
          outputType: "resolution_recommendation",
          snapshot: {}
        }
      },
      evidenceSources: [
        {
          sourceUrl: "https://www.gov.il/en/departments/news",
          sourceLabel: "Gov.il",
          sourceType: "official",
          capturedAt: "2026-06-22T18:11:00.000Z",
          claimSummary: "Gov.il names Candidate A."
        }
      ],
      outputSnapshot: {
        objectType: "resolution_recommendation"
      }
    });

    await expect(
      approveOracleResolutionCase(
        dbPool,
        "orc_case_open",
        ADMIN_ACTOR,
        {
          idempotencyKey: "oracle-approve-open"
        }
      )
    ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
      code: "oracle_case_not_approvable"
    });

    expect(resolveMarketMock).not.toHaveBeenCalled();
  });

  it("records a reject review action without trusted resolve", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_case_reject",
        marketId: "market_seed_next_prime_minister",
        marketTitle: "מי יהיה ראש הממשלה הבא?",
        caseType: "resolution_check",
        marketStatus: "closed",
        caseStatus: "recommended",
        ambiguityLevel: "medium",
        summary: "Conflicting winner mapping.",
        scheduledCloseAt: "2026-06-22T20:00:00.000Z",
        createdAt: "2026-06-22T18:12:00.000Z",
        updatedAt: "2026-06-22T18:12:00.000Z",
        winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
        winningOutcomeLabel: "מועמד א'",
        sourcePolicy: null,
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: null,
        output: {
          outputId: "rrc_case_reject",
          outputType: "resolution_recommendation",
          snapshot: {}
        }
      },
      evidenceSources: [],
      outputSnapshot: {
        objectType: "resolution_recommendation"
      },
      reviewHistory: []
    });

    const result = await rejectOracleCase(
      dbPool,
      "orc_case_reject",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-reject-1",
        reviewNote: "This winner mapping is not convincing enough yet."
      }
    );

    expect(resolveMarketMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      objectType: "oracle_case_review_result",
      outcome: "rejected_case",
      review: {
        oracleCaseId: "orc_case_reject",
        reviewAction: "reject_case",
        resultStatus: "completed"
      }
    });
  });

  it("replays duplicate audit-only review action without inserting twice", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      ...createResolutionCaseDetail(),
      item: {
        ...createResolutionCaseDetail().item,
        oracleCaseId: "orc_case_reject",
        caseStatus: "recommended"
      }
    });

    const first = await rejectOracleCase(
      dbPool,
      "orc_case_reject",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-reject-retry",
        reviewNote: "Reject once."
      }
    );

    const replay = await rejectOracleCase(
      dbPool,
      "orc_case_reject",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-reject-retry",
        reviewNote: "Duplicate reject."
      }
    );

    expect(replay).toMatchObject({
      outcome: "rejected_case",
      review: {
        reviewId: first.review.reviewId,
        resultStatus: "completed"
      }
    });
  });

  it("returns a clean in-progress error for duplicate attempted review action", async () => {
    const dbPool = createDbPool({
      reviews: [
        {
          id: "ocr_attempted_1",
          oracle_case_id: "orc_case_1",
          market_id: "market_seed_next_prime_minister",
          review_action: "approve_resolution",
          result_status: "attempted",
          actor_id: "user_admin_1",
          actor_role: "admin",
          review_note: "Started.",
          idempotency_key: "oracle-approve-in-progress",
          resolution_id: null,
          resolve_response_snapshot: null,
          failure_code: null,
          failure_message: null,
          created_at: "2026-06-22T18:12:00.000Z",
          completed_at: null,
          failed_at: null
        }
      ]
    });

    readOracleCaseDetailMock.mockResolvedValue(createResolutionCaseDetail());

    await expect(
      approveOracleResolutionCase(
        dbPool,
        "orc_case_1",
        ADMIN_ACTOR,
        {
          idempotencyKey: "oracle-approve-in-progress"
        }
      )
    ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
      code: "oracle_review_action_in_progress"
    });

    expect(resolveMarketMock).not.toHaveBeenCalled();
  });

  it("returns a clean failed error for duplicate failed review action", async () => {
    const dbPool = createDbPool({
      reviews: [
        {
          id: "ocr_failed_1",
          oracle_case_id: "orc_case_1",
          market_id: "market_seed_next_prime_minister",
          review_action: "approve_resolution",
          result_status: "failed",
          actor_id: "user_admin_1",
          actor_role: "admin",
          review_note: "Started.",
          idempotency_key: "oracle-approve-failed",
          resolution_id: null,
          resolve_response_snapshot: null,
          failure_code: "resolve_failed",
          failure_message: "Resolve failed.",
          created_at: "2026-06-22T18:12:00.000Z",
          completed_at: null,
          failed_at: "2026-06-22T18:13:00.000Z"
        }
      ]
    });

    readOracleCaseDetailMock.mockResolvedValue(createResolutionCaseDetail());

    await expect(
      approveOracleResolutionCase(
        dbPool,
        "orc_case_1",
        ADMIN_ACTOR,
        {
          idempotencyKey: "oracle-approve-failed"
        }
      )
    ).rejects.toMatchObject<Partial<OracleReviewActionError>>({
      code: "oracle_review_action_failed"
    });

    expect(resolveMarketMock).not.toHaveBeenCalled();
  });

  it("records a request-more-evidence action without trusted resolve", async () => {
    const dbPool = createDbPool();

    readOracleCaseDetailMock.mockResolvedValue({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_case_more_evidence",
        marketId: "market_seed_next_prime_minister",
        marketTitle: "מי יהיה ראש הממשלה הבא?",
        caseType: "close_condition_check",
        marketStatus: "open",
        caseStatus: "review_needed",
        ambiguityLevel: "high",
        summary: "Need one more official confirmation.",
        scheduledCloseAt: "2026-06-22T20:00:00.000Z",
        createdAt: "2026-06-22T18:12:00.000Z",
        updatedAt: "2026-06-22T18:12:00.000Z",
        winningOutcomeId: null,
        winningOutcomeLabel: null,
        sourcePolicy: null,
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: [],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        },
        evidencePacket: null,
        output: {
          outputId: "ors_case_more_evidence",
          outputType: "oracle_review_signal",
          snapshot: {}
        }
      },
      evidenceSources: [],
      outputSnapshot: {
        objectType: "oracle_review_signal"
      },
      reviewHistory: []
    });

    const result = await requestMoreEvidenceForOracleCase(
      dbPool,
      "orc_case_more_evidence",
      ADMIN_ACTOR,
      {
        idempotencyKey: "oracle-more-evidence-1",
        reviewNote: "Need one more authoritative source before acting."
      }
    );

    expect(resolveMarketMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      objectType: "oracle_case_review_result",
      outcome: "requested_more_evidence",
      review: {
        oracleCaseId: "orc_case_more_evidence",
        reviewAction: "request_more_evidence",
        resultStatus: "completed"
      }
    });
  });
});
