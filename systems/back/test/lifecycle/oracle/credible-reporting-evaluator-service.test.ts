import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

import {
  evaluateCredibleReportingEvidence
} from "../../../../oracle/src/credible-reporting-evaluator-service";

const { inspectOracleMarketMock } = vi.hoisted(() => ({
  inspectOracleMarketMock: vi.fn()
}));

vi.mock("../../../../oracle/src/inspect-market-service", async () => {
  const actual = await vi.importActual<typeof import("../../../../oracle/src/inspect-market-service")>(
    "../../../../oracle/src/inspect-market-service"
  );

  return {
    ...actual,
    inspectOracleMarket: inspectOracleMarketMock
  };
});

const SOURCE_REGISTRY = [
  {
    objectType: "source_registry_entry" as const,
    sourceId: "src_reuters",
    label: "Reuters",
    primaryClass: "authority" as const,
    accessSurface: "html" as const,
    status: "seeded" as const,
    curationMode: "manual-seed" as const,
    stageUsefulness: ["review" as const],
    categoryFit: ["general"],
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ownerLabel: "Reuters",
    independentGroupId: "reuters",
    credibleReporting: {
      allowed: true as const,
      tier: "primary" as const
    }
  },
  {
    objectType: "source_registry_entry" as const,
    sourceId: "src_ap",
    label: "Associated Press",
    primaryClass: "authority" as const,
    accessSurface: "html" as const,
    status: "seeded" as const,
    curationMode: "manual-seed" as const,
    stageUsefulness: ["review" as const],
    categoryFit: ["general"],
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ownerLabel: "AP",
    independentGroupId: "ap",
    credibleReporting: {
      allowed: true as const,
      tier: "primary" as const
    }
  },
  {
    objectType: "source_registry_entry" as const,
    sourceId: "src_same_group",
    label: "Same Group News",
    primaryClass: "authority" as const,
    accessSurface: "html" as const,
    status: "seeded" as const,
    curationMode: "manual-seed" as const,
    stageUsefulness: ["review" as const],
    categoryFit: ["general"],
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ownerLabel: "Reuters",
    independentGroupId: "reuters",
    credibleReporting: {
      allowed: true as const,
      tier: "supporting" as const
    }
  }
];

function createDb(evidenceRows: unknown[], options?: {
  minimumIndependentSources?: number;
  allowSingleSourceEvidence?: boolean;
}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from markets")) {
        return {
          rows: [
            {
              id: "market_credible_1",
              title: "האם הדיווח אושר?",
              status: "closed",
              oracle_source_policy: {
                resolutionSourceIds: ["src_credible_reporting_bundle"],
                credibleReporting: {
                  minimumIndependentSources: options?.minimumIndependentSources ?? 2,
                  approvedSourceIds: ["src_reuters", "src_ap", "src_same_group"],
                  conflictPolicy: "If approved sources disagree, request human review.",
                  correctionWindow: "Until operator approval."
                }
              },
              market_contract: {
                objectType: "market_contract_v1",
                oracleCapability: "credible_reporting",
                resolutionAuthorityType: "credible-reporting",
                resolutionSource: {
                  sourceIds: ["src_credible_reporting_bundle"]
                },
                credibleReporting: {
                  minimumIndependentSources: options?.minimumIndependentSources,
                  allowSingleSourceEvidence: options?.allowSingleSourceEvidence
                }
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_evidence_packets")) {
        return {
          rows: evidenceRows,
          rowCount: evidenceRows.length
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Pool;
}

function evidenceRow(input: {
  packetId: string;
  outcomeId: string;
  outcomeLabel: string;
  sourceId: string;
  label: string;
  sourceUrl?: string;
}) {
  return {
    evidence_packet_id: input.packetId,
    winning_outcome_id: input.outcomeId,
    winning_outcome_label: input.outcomeLabel,
    captured_at: new Date("2026-05-22T06:00:00.000Z"),
    sources_snapshot: [
      {
        sourceId: input.sourceId,
        sourceUrl: input.sourceUrl ?? `https://example.com/${input.packetId}`,
        sourceLabel: input.label,
        sourceType: "news",
        claimSummary: `${input.label} supports ${input.outcomeLabel}.`,
        capturedAt: "2026-05-22T06:00:00.000Z"
      }
    ]
  };
}

describe("credible reporting evaluator", () => {
  beforeEach(() => {
    inspectOracleMarketMock.mockReset();
    inspectOracleMarketMock.mockResolvedValue({
      objectType: "oracle_inspection_result",
      oracleCase: {
        oracleCaseId: "orc_credible_1"
      },
      evidencePacket: {
        evidencePacketId: "evp_credible_1"
      }
    });
  });

  it("creates a human-gated recommendation when two independent approved sources agree", async () => {
    const db = createDb([
      evidenceRow({
        packetId: "evp_reuters",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_reuters",
        label: "Reuters"
      }),
      evidenceRow({
        packetId: "evp_ap",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_ap",
        label: "AP"
      })
    ]);

    const result = await evaluateCredibleReportingEvidence(db, {
      marketId: "market_credible_1",
      sourceRegistry: SOURCE_REGISTRY
    });

    expect(result).toMatchObject({
      action: "created_case",
      independentSourceCount: 2,
      winningOutcomeId: "out_yes",
      oracleCaseId: "orc_credible_1"
    });
    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        caseType: "resolution_check",
        winningOutcomeId: "out_yes",
        requiresHumanReview: true,
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: "src_reuters",
            sourceType: "credible_reporting",
            independentGroupId: "reuters"
          }),
          expect.objectContaining({
            sourceId: "src_ap",
            sourceType: "credible_reporting",
            independentGroupId: "ap"
          })
        ])
      }),
      {
        persistResult: true
      }
    );
  });

  it("does not count two sources from the same independent group twice", async () => {
    const db = createDb([
      evidenceRow({
        packetId: "evp_reuters",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_reuters",
        label: "Reuters"
      }),
      evidenceRow({
        packetId: "evp_same_group",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_same_group",
        label: "Same Group News"
      })
    ]);

    const result = await evaluateCredibleReportingEvidence(db, {
      marketId: "market_credible_1",
      sourceRegistry: SOURCE_REGISTRY
    });

    expect(result).toMatchObject({
      action: "created_insufficient_evidence_review",
      independentSourceCount: 1,
      winningOutcomeId: null
    });
    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        reviewType: "insufficient_evidence",
        sources: [
          expect.objectContaining({
            sourceId: "src_reuters",
            independentGroupId: "reuters"
          })
        ]
      }),
      {
        persistResult: true
      }
    );
  });

  it("allows one approved source only when the contract explicitly opts into single-source evidence", async () => {
    const db = createDb(
      [
        evidenceRow({
          packetId: "evp_reuters",
          outcomeId: "out_yes",
          outcomeLabel: "כן",
          sourceId: "src_reuters",
          label: "Reuters"
        })
      ],
      {
        minimumIndependentSources: 1,
        allowSingleSourceEvidence: true
      }
    );

    const result = await evaluateCredibleReportingEvidence(db, {
      marketId: "market_credible_1",
      sourceRegistry: SOURCE_REGISTRY
    });

    expect(result).toMatchObject({
      action: "created_case",
      minimumIndependentSources: 1,
      independentSourceCount: 1,
      winningOutcomeId: "out_yes",
      oracleCaseId: "orc_credible_1"
    });
  });

  it("ignores historical credible-reporting evidence with unsafe source URLs", async () => {
    const db = createDb([
      evidenceRow({
        packetId: "evp_reuters",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_reuters",
        label: "Reuters",
        sourceUrl: "javascript:alert(1)"
      }),
      evidenceRow({
        packetId: "evp_ap",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_ap",
        label: "AP"
      })
    ]);

    const result = await evaluateCredibleReportingEvidence(db, {
      marketId: "market_credible_1",
      sourceRegistry: SOURCE_REGISTRY
    });

    expect(result).toMatchObject({
      action: "created_insufficient_evidence_review",
      independentSourceCount: 1,
      winningOutcomeId: null
    });
    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        reviewType: "insufficient_evidence",
        sources: [
          expect.objectContaining({
            sourceId: "src_ap",
            sourceUrl: "https://example.com/evp_ap"
          })
        ]
      }),
      {
        persistResult: true
      }
    );
  });

  it("creates a conflict review when approved sources point to different outcomes", async () => {
    const db = createDb([
      evidenceRow({
        packetId: "evp_reuters",
        outcomeId: "out_yes",
        outcomeLabel: "כן",
        sourceId: "src_reuters",
        label: "Reuters"
      }),
      evidenceRow({
        packetId: "evp_ap",
        outcomeId: "out_no",
        outcomeLabel: "לא",
        sourceId: "src_ap",
        label: "AP"
      })
    ]);

    const result = await evaluateCredibleReportingEvidence(db, {
      marketId: "market_credible_1",
      sourceRegistry: SOURCE_REGISTRY
    });

    expect(result).toMatchObject({
      action: "created_conflict_review",
      winningOutcomeId: null
    });
    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        reviewType: "conflicting_sources"
      }),
      {
        persistResult: true
      }
    );
  });
});
