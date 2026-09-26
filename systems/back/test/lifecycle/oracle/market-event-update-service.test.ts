import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { upsertSourceLagEventUpdates } from "../../../../oracle/src/market-event-update-service";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-source-lag",
  marketTitle: "מה תהיה התוצאה?",
  marketStatus: "closed",
  closeAt: "2026-05-06T09:00:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.nikeliga.sk/zapas/2774-slo-mic",
  resolutionRules: "Resolve from official final score.",
  oracleSourcePolicy: null,
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "three_way_result",
    oracleCapability: "supported_final_only",
    timeline: {
      closeAt: "2026-05-06T09:00:00.000Z",
      expectedResolutionAt: "2026-05-06T09:30:00.000Z"
    },
    resolutionSource: {
      url: "https://www.nikeliga.sk/zapas/2774-slo-mic",
      sourceIds: ["src_nike_liga_official"]
    }
  },
  outcomes: []
};

describe("market event update service", () => {
  it("upserts one source-lag event after expected resolution time", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "lifevt_source_lag"
        }
      ],
      rowCount: 1
    }));
    const db = { query } as unknown as Pool;

    const result = await upsertSourceLagEventUpdates(db, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      contextsByMarketId: new Map([[CONTEXT.marketId, CONTEXT]]),
      intakeResults: [
        {
          objectType: "oracle_official_final_intake_result",
          generatedAt: "2026-05-06T10:00:00.000Z",
          marketId: CONTEXT.marketId,
          checkedMarketCount: 1,
          createdCaseCount: 0,
          skippedCount: 1,
          recommendations: [],
          items: [
            {
              objectType: "oracle_official_final_intake_item",
              marketId: CONTEXT.marketId,
              marketTitle: CONTEXT.marketTitle,
              action: "skipped_not_final",
              sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic",
              officialJsonUrl: null,
              officialStatus: "live",
              sourceFetchedAt: "2026-05-06T10:00:00.000Z",
              sourceRawHash: "abc123",
              sourceSnapshot: { status: "live" },
              winningOutcomeKey: null,
              winningOutcomeLabel: null,
              approvalRequired: true,
              reason: "Official source status is not final yet."
            }
          ]
        }
      ]
    });

    expect(result).toMatchObject({
      objectType: "source_lag_event_update_result",
      upsertedCount: 1,
      items: [
        {
          id: "lifevt_source_lag",
          marketId: CONTEXT.marketId,
          eventType: "official_source_not_ready",
          tier: "system_status",
          sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic"
        }
      ]
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into lifecycle_events"),
      expect.arrayContaining([
        CONTEXT.marketId,
        "official_source_not_ready",
        "oracle"
      ])
    );
    expect(JSON.parse(String(query.mock.calls[0]?.[1]?.[11]))).toMatchObject({
      expectedResolutionAt: "2026-05-06T09:30:00.000Z",
      sourceRawHash: "abc123",
      officialStatus: "live",
      sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic"
    });
  });

  it("does not create source-lag events before expected resolution time", async () => {
    const query = vi.fn();
    const db = { query } as unknown as Pool;

    const result = await upsertSourceLagEventUpdates(db, {
      now: new Date("2026-05-06T09:10:00.000Z"),
      contextsByMarketId: new Map([[CONTEXT.marketId, CONTEXT]]),
      intakeResults: [
        {
          objectType: "oracle_official_final_intake_result",
          generatedAt: "2026-05-06T09:10:00.000Z",
          marketId: CONTEXT.marketId,
          checkedMarketCount: 1,
          createdCaseCount: 0,
          skippedCount: 1,
          recommendations: [],
          items: [
            {
              objectType: "oracle_official_final_intake_item",
              marketId: CONTEXT.marketId,
              marketTitle: CONTEXT.marketTitle,
              action: "skipped_not_final",
              sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic",
              officialJsonUrl: null,
              officialStatus: "live",
              winningOutcomeKey: null,
              winningOutcomeLabel: null,
              approvalRequired: true,
              reason: "Official source status is not final yet."
            }
          ]
        }
      ]
    });

    expect(result.upsertedCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
