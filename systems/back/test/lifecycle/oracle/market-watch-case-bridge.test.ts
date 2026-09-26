import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  isMarketWatchCloseConditionKeyword,
  promoteMarketWatchSignalToOracleCase
} from "../../../../oracle/src/market-watch-case-bridge";
import type { OracleInspectionResult } from "../../../../oracle/src/contracts";

function inspectionResult(caseId: string): OracleInspectionResult {
  return {
    objectType: "oracle_inspection_result",
    market: {
      marketId: "market_power_couple_odeya_elior",
      title: "האם אודיה ואליאור יהיו הפאוור קאפל?",
      marketStatus: "open",
      scheduledCloseAt: "2026-12-31T21:59:00.000Z",
      resolutionSource: "רשת 13",
      resolutionRules: "Official result.",
      oracleSourcePolicy: null,
      contractHints: {
        sourceRolePlan: { wake: [], ground: [], resolve: [], integrity: [] },
        fetchNeeds: [],
        policyNotes: []
      },
      outcomes: []
    },
    oracleCase: {
      objectType: "oracle_case",
      oracleCaseId: caseId,
      marketId: "market_power_couple_odeya_elior",
      marketStatus: "open",
      caseType: "close_condition_check",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z"
    },
    evidencePacket: {
      objectType: "evidence_packet",
      evidencePacketId: "evp_watch",
      oracleCaseId: caseId,
      marketId: "market_power_couple_odeya_elior",
      evidenceSummary: "Official show page reports elimination.",
      sources: [],
      capturedAt: "2026-07-13T10:00:00.000Z"
    },
    output: {
      objectType: "early_close_recommendation",
      earlyCloseRecommendationId: "ecr_watch",
      oracleCaseId: caseId,
      marketId: "market_power_couple_odeya_elior",
      triggerType: "oracle_confirmed_event_completion",
      recommendedAction: "review_first",
      reasonSummary: "Official show page reports elimination.",
      evidencePacketId: "evp_watch",
      requiresHumanReview: true,
      createdAt: "2026-07-13T10:00:00.000Z"
    }
  };
}

describe("market watch Oracle case bridge", () => {
  it("only promotes explicit elimination or withdrawal keywords", () => {
    expect(isMarketWatchCloseConditionKeyword("הודחו")).toBe(true);
    expect(isMarketWatchCloseConditionKeyword("פרשה")).toBe(true);
    expect(isMarketWatchCloseConditionKeyword("הזוכה")).toBe(false);
    expect(isMarketWatchCloseConditionKeyword("הגמר")).toBe(false);
  });

  it("maps one signal to one open child and persists a human-gated close case", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from markets m")) {
        return {
          rows: [
            {
              id: "market_power_couple_odeya_elior",
              status: "open",
              title: "האם אודיה ואליאור יהיו הפאוור קאפל?",
              resolution_source: "רשת 13",
              market_contract: {
                objectType: "market_contract_v1",
                resolutionSource: {
                  label: "רשת 13, עמוד התוכנית הרשמי",
                  sourceIds: ["src_show_official"]
                },
                timeline: { targetEntity: "אודיה פינטו ואליאור סופר" },
                taxonomy: { aliases: ["אודיה ואליאור"] }
              }
            },
            {
              id: "market_power_couple_other",
              status: "open",
              title: "האם זוג אחר יזכה?",
              resolution_source: "רשת 13",
              market_contract: {
                objectType: "market_contract_v1",
                timeline: { targetEntity: "זוג אחר" },
                taxonomy: { aliases: ["אחרים"] }
              }
            }
          ],
          rowCount: 2
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const inspect = vi.fn(async () => inspectionResult("orc_watch_case"));

    const result = await promoteMarketWatchSignalToOracleCase(
      { query } as unknown as Pool,
      {
        signalId: "mws_watch",
        plan: {
          marketId: null,
          eventId: "evt_power_couple"
        },
        signal: {
          matchedEntity: "אודיה ואליאור",
          matchedKeyword: "הודחו",
          sourceUrl: "https://13tv.co.il/shows/power-couple/",
          sourceTitle: "פאוור קאפל",
          summary: "Possible elimination.",
          observedAt: "2026-07-13T10:00:00.000Z",
          payload: { snippet: "אודיה ואליאור הודחו מהתחרות" }
        }
      },
      { inspectOracleMarket: inspect }
    );

    expect(result).toEqual({
      status: "promoted",
      marketId: "market_power_couple_odeya_elior",
      oracleCaseId: "orc_watch_case"
    });
    expect(inspect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        marketId: "market_power_couple_odeya_elior",
        caseType: "close_condition_check",
        closeConditionSatisfied: true,
        requiresHumanReview: true,
        sources: [
          expect.objectContaining({
            sourceId: "src_show_official",
            sourceLabel: "רשת 13, עמוד התוכנית הרשמי",
            sourceType: "official_show_watch"
          })
        ]
      }),
      { persistResult: true }
    );
  });

  it("blocks promotion when aliases match more than one open child", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "market_a",
          status: "open",
          title: "A",
          resolution_source: "Official",
          market_contract: {
            objectType: "market_contract_v1",
            timeline: { targetEntity: "נועה" }
          }
        },
        {
          id: "market_b",
          status: "open",
          title: "B",
          resolution_source: "Official",
          market_contract: {
            objectType: "market_contract_v1",
            taxonomy: { aliases: ["נועה"] }
          }
        }
      ],
      rowCount: 2
    }));
    const inspect = vi.fn();

    const result = await promoteMarketWatchSignalToOracleCase(
      { query } as unknown as Pool,
      {
        signalId: "mws_ambiguous",
        plan: { marketId: null, eventId: "evt_show" },
        signal: {
          matchedEntity: "נועה",
          matchedKeyword: "הודחה",
          sourceUrl: "https://example.test/show",
          sourceTitle: null,
          summary: "Possible elimination.",
          observedAt: "2026-07-13T10:00:00.000Z",
          payload: { snippet: "נועה הודחה" }
        }
      },
      { inspectOracleMarket: inspect }
    );

    expect(result).toMatchObject({
      status: "blocked",
      code: "ambiguous_open_child_match"
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("does not open another case after the matching child has already closed", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        id: "market_closed",
        status: "closed",
        title: "Closed child",
        resolution_source: "Official",
        market_contract: {
          objectType: "market_contract_v1",
          timeline: { targetEntity: "נועה" }
        }
      }],
      rowCount: 1
    }));
    const inspect = vi.fn();

    const result = await promoteMarketWatchSignalToOracleCase(
      { query } as unknown as Pool,
      {
        signalId: "mws_closed",
        plan: { marketId: null, eventId: "evt_show" },
        signal: {
          matchedEntity: "נועה",
          matchedKeyword: "הודחה",
          sourceUrl: "https://example.test/show",
          sourceTitle: null,
          summary: "Possible elimination.",
          observedAt: "2026-07-13T10:00:00.000Z",
          payload: { snippet: "נועה הודחה" }
        }
      },
      { inspectOracleMarket: inspect }
    );

    expect(result).toEqual({
      status: "not_actionable",
      code: "market_not_open"
    });
    expect(inspect).not.toHaveBeenCalled();
  });
});
