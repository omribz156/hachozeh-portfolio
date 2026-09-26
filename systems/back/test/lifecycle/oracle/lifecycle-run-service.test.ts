import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { runOracleLifecycleRun } from "../../../../oracle/src/lifecycle-run-service";
import type { HorizonCloseSweepResult } from "../../../src/lifecycle/horizon/close-sweep-service";
import type { OracleOfficialFinalIntakeResult } from "../../../../oracle/src/official-final-intake-service";
import type { OracleResolveInboxResult } from "../../../../oracle/src/resolve-inbox-service";

function buildCloseSweepResult(
  overrides?: Partial<HorizonCloseSweepResult>
): HorizonCloseSweepResult {
  return {
    objectType: "horizon_close_sweep_result",
    evaluatedAt: "2026-05-06T10:00:00.000Z",
    dryRun: false,
    limit: 20,
    candidates: [],
    checks: [],
    executions: [],
    alerts: [],
    ...overrides
  };
}

function buildOfficialFinalResult(
  marketId: string
): OracleOfficialFinalIntakeResult {
  return {
    objectType: "oracle_official_final_intake_result",
    generatedAt: "2026-05-06T10:00:00.000Z",
    marketId,
    checkedMarketCount: 1,
    createdCaseCount: 1,
    skippedCount: 0,
    items: [
      {
        objectType: "oracle_official_final_intake_item",
        marketId,
        marketTitle: "מי תנצח?",
        action: "created_case",
        sourceUrl: "https://www.nba.com/game/phi-vs-nyk-0042500211",
        officialJsonUrl:
          "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_0042500211.json",
        officialStatus: "Final",
        winningOutcomeKey: `${marketId}-option-2`,
        winningOutcomeLabel: "ניו יורק ניקס",
        oracleCaseId: "orc_clean_case",
        evidencePacketId: "evp_clean_case",
        resolutionRecommendationId: "rrc_clean_case",
        approvalRequired: true,
        reason:
          "Official final result mapped to a market outcome and created a human-gated Oracle resolution case."
      }
    ],
    recommendations: []
  };
}

function buildOfficialNotFinalResult(
  marketId: string
): OracleOfficialFinalIntakeResult {
  return {
    objectType: "oracle_official_final_intake_result",
    generatedAt: "2026-05-06T10:00:00.000Z",
    marketId,
    checkedMarketCount: 1,
    createdCaseCount: 0,
    skippedCount: 1,
    items: [
      {
        objectType: "oracle_official_final_intake_item",
        marketId,
        marketTitle: "מה תהיה התוצאה?",
        action: "skipped_not_final",
        sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic",
        officialJsonUrl: null,
        officialStatus: "live",
        winningOutcomeKey: null,
        winningOutcomeLabel: null,
        approvalRequired: true,
        reason: "Official source status is not final yet."
      }
    ],
    recommendations: [
      "Some closed markets still need operator review before a resolution case can be trusted."
    ]
  };
}

function buildResolveInbox(
  overrides?: Partial<OracleResolveInboxResult>
): OracleResolveInboxResult {
  return {
    objectType: "oracle_resolve_inbox",
    generatedAt: "2026-05-06T10:00:00.000Z",
    marketId: null,
    missingCaseCount: 0,
    recommendedCaseCount: 0,
    reviewNeededCaseCount: 0,
    missingCases: [],
    recommendedCases: [],
    reviewNeededCases: [],
    ...overrides
  };
}

function createPool(options: {
  closedMarkets: Array<{
    id: string;
    title?: string;
    status?: "closed" | "resolved";
    closeAt?: Date;
    closedAt?: Date | null;
    resolvedAt?: Date | null;
  }>;
  closeAudits?: Array<{
    marketId: string;
    auditEventId?: string;
    triggerType?: "scheduled_time" | "oracle_confirmed_event_completion";
  }>;
  capabilityMarkets?: Array<{
    id: string;
    title?: string;
    status?: "open" | "closed" | "resolved";
    closeAt?: Date;
    marketContract?: unknown;
    oracleSourcePolicy?: unknown;
  }>;
}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
        return {
          rows: options.closedMarkets.map((market) => ({
            id: market.id,
            title: market.title ?? "מי תנצח?",
            status: market.status ?? "closed",
            close_at: market.closeAt ?? new Date("2026-05-06T09:00:00.000Z"),
            closed_at: market.closedAt ?? new Date("2026-05-06T09:00:01.000Z"),
            resolved_at: market.resolvedAt ?? null
          })),
          rowCount: options.closedMarkets.length
        };
      }

      if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
        return {
          rows: (options.capabilityMarkets ?? []).map((market) => ({
            id: market.id,
            title: market.title ?? "מי תנצח?",
            status: market.status ?? "closed",
            close_at: market.closeAt ?? new Date("2026-05-06T09:00:00.000Z"),
            close_on_event_completion: false,
            event_completion_close_requires_human_approval: true,
            resolution_source: "internal://oracle/credible-reporting",
            resolution_rules: "Resolve from credible reporting.",
            oracle_source_policy: market.oracleSourcePolicy ?? {},
            market_contract: market.marketContract ?? {}
          })),
          rowCount: options.capabilityMarkets?.length ?? 0
        };
      }

      if (sql.includes("from market_outcomes")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("from audit_events")) {
        return {
          rows: (options.closeAudits ?? []).map((audit) => ({
            market_id: audit.marketId,
            audit_event_id: audit.auditEventId ?? `audit_${audit.marketId}`,
            actor_id: "system:horizon-scheduler",
            payload: {
              command: {
                triggerType: audit.triggerType ?? "scheduled_time",
                sourceRef:
                  audit.triggerType === "oracle_confirmed_event_completion"
                    ? "https://www.nba.com/game/phi-vs-nyk-0042500211"
                    : undefined,
                notes: "Close provenance test receipt."
              },
              result: {
                status: "closed"
              }
            },
            created_at: new Date("2026-05-06T09:00:01.000Z")
          })),
          rowCount: options.closeAudits?.length ?? 0
        };
      }

      if (sql.includes("from lifecycle_events")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Pool;
}

describe("oracle lifecycle run service", () => {
  it("runs official final intake for a scheduled-EOL closed market with close provenance", async () => {
    const pool = createPool({
      closedMarkets: [
        {
          id: "disc-cm-nba-proof"
        }
      ],
      closeAudits: [
        {
          marketId: "disc-cm-nba-proof",
          triggerType: "scheduled_time"
        }
      ]
    });
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );
    const resolveInbox = vi
      .fn()
      .mockResolvedValueOnce(
        buildResolveInbox({
          missingCaseCount: 1,
          missingCases: [
            {
              itemType: "missing_case",
              marketId: "disc-cm-nba-proof",
              marketTitle: "מי תנצח?",
              marketStatus: "closed",
              closeAt: "2026-05-06T09:00:00.000Z",
              closedAt: "2026-05-06T09:00:01.000Z",
              ageHours: 1,
              resolutionSource: "https://www.nba.com/game/phi-vs-nyk-0042500211",
              resolutionRules: "Resolve from official final score.",
              nextAction: "create_resolution_case",
              suggestedCommand:
                "npm --prefix systems/back run oracle -- inspect-resolution --market disc-cm-nba-proof --json"
            }
          ]
        })
      )
      .mockResolvedValueOnce(buildResolveInbox());
    const fetchJson = vi.fn();
    const fetchText = vi.fn();

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake,
      resolveInbox,
      fetchJson,
      fetchText
    });

    expect(result.status).toBe("completed_with_actions");
    expect(result.phases.closeProvenance).toMatchObject({
      checkedMarketCount: 1,
      confirmedCount: 1,
      missingCount: 0
    });
    expect(result.phases.evidenceIntake).toMatchObject({
      eligibleMarketCount: 1,
      skippedForMissingProvenanceCount: 0
    });
    expect(officialFinalIntake).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId: "disc-cm-nba-proof",
        limit: 1,
        fetchJson,
        fetchText
      })
    );
    expect(resolveInbox).toHaveBeenCalledTimes(2);
    expect(result.phases.inbox.missingCaseCount).toBe(0);
    expect(
      result.actions.some((action) => action.actionType === "create_resolution_case")
    ).toBe(false);
  });

  it("routes closed credible-reporting markets through the evaluator instead of official final intake", async () => {
    const pool = createPool({
      closedMarkets: [
        {
          id: "disc-cm-credible-proof"
        }
      ],
      capabilityMarkets: [
        {
          id: "disc-cm-credible-proof",
          marketContract: {
            objectType: "market_contract_v1",
            measurementKind: "reported_claim",
            resultShape: "yes_no",
            oracleCapability: "credible_reporting",
            resolutionAuthorityType: "credible-reporting",
            resolutionSource: {
              url: "internal://oracle/credible-reporting",
              sourceIds: ["src_credible_reporting_bundle"]
            }
          }
        }
      ],
      closeAudits: [
        {
          marketId: "disc-cm-credible-proof",
          triggerType: "scheduled_time"
        }
      ]
    });
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );
    const credibleReportingEvaluate = vi.fn(async (_dbPool, options) => ({
      objectType: "credible_reporting_evaluation_result" as const,
      marketId: options.marketId,
      marketTitle: "דיווח אמין",
      action: "created_case" as const,
      minimumIndependentSources: 2,
      approvedSourceIds: ["src_reuters", "src_ap"],
      consideredSourceCount: 2,
      independentSourceCount: 2,
      winningOutcomeId: "out_yes",
      winningOutcomeLabel: "כן",
      oracleCaseId: "orc_credible_case",
      evidencePacketId: "evp_credible_case",
      reason: "Two independent sources agree."
    }));

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake,
      credibleReportingEvaluate,
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(officialFinalIntake).not.toHaveBeenCalled();
    expect(credibleReportingEvaluate).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId: "disc-cm-credible-proof"
      })
    );
    expect(result.phases.evidenceIntake.credibleReportingResults).toHaveLength(1);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "approve_resolution_case",
          oracleCaseId: "orc_credible_case",
          requiresExplicitApproval: true
        })
      ])
    );
  });

  it("captures a TradingView FX snapshot before final intake for closed live-FX markets", async () => {
    const marketId = "disc-cm-live-fx-usdils-2-82-2026-06-02-b75k";
    const closeAt = "2026-06-02T20:59:00.000Z";
    const machineResolutionEndpoint = `hachozeh://oracle/tradingview-fx-snapshot?market=${marketId}&symbol=USDILS&at=2026-06-02T20%3A59%3A00.000Z`;
    const marketContract = {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: "https://www.tradingview.com/symbols/USDILS/",
        sourceIds: ["src_tradingview_fx"]
      },
      trustDisplayUrl: "https://www.tradingview.com/symbols/USDILS/",
      machineResolutionEndpoint,
      resolutionRule: "Resolve from TradingView USDILS snapshot. yes if USD/ILS >= 2.82.",
      timeline: {
        closeAt,
        maxCloseLagMinutes: 15
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ]
    };
    const pool = createPool({
      closedMarkets: [
        {
          id: marketId,
          closeAt: new Date(closeAt),
          closedAt: new Date("2026-06-02T20:59:01.000Z")
        }
      ],
      capabilityMarkets: [
        {
          id: marketId,
          status: "closed",
          closeAt: new Date(closeAt),
          marketContract,
          oracleSourcePolicy: {
            resolutionSourceIds: ["src_tradingview_fx"]
          }
        }
      ],
      closeAudits: [
        {
          marketId,
          triggerType: "scheduled_time"
        }
      ]
    });
    const captureFxSnapshot = vi.fn(async () => ({
      objectType: "oracle_tradingview_fx_snapshot_capture_result" as const,
      marketId,
      lifecycleEventId: "lifevt_fx_snapshot",
      deduped: false,
      machineResolutionEndpoint,
      snapshot: {
        objectType: "tradingview_fx_snapshot_v1" as const,
        sourceFamily: "tradingview_fx" as const,
        provider: "tradingview_scanner" as const,
        symbol: "USDILS",
        ticker: "FX_IDC:USDILS",
        sourceUrl: "https://www.tradingview.com/symbols/USDILS/",
        scannerUrl: "https://scanner.tradingview.com/forex/scan",
        observedAt: closeAt,
        fetchedAt: "2026-06-02T20:59:05.000Z",
        status: "final" as const,
        price: 2.821,
        close: 2.821,
        bid: 2.8209,
        ask: 2.8211,
        currency: "ILS",
        updateMode: "streaming",
        description: "U.S. DOLLAR / ISRAELI SHEKEL",
        rawHash: "hash_fx",
        rawPayload: {}
      }
    }));
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-06-02T20:59:05.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      captureFxSnapshot,
      officialFinalIntake,
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(captureFxSnapshot).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId,
        symbol: "USDILS",
        observedAt: new Date(closeAt),
        idempotencyKey: `${marketId}:USDILS:${closeAt}`
      })
    );
    expect(officialFinalIntake).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId,
        limit: 1
      })
    );
    expect(result.phases.sourceSnapshots).toMatchObject({
      checkedMarketCount: 1,
      capturedCount: 1,
      skippedExistingCount: 0,
      items: [
        {
          marketId,
          action: "captured",
          symbol: "USDILS",
          lifecycleEventId: "lifevt_fx_snapshot"
        }
      ]
    });
    expect(result.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receiptType: "source_snapshot_captured",
          marketId,
          id: "lifevt_fx_snapshot"
        }),
        expect.objectContaining({
          receiptType: "resolution_case_created",
          marketId
        })
      ])
    );
  });

  it("captures TradingView FX observations for open windowed crossing markets", async () => {
    const marketId = "disc-cm-live-fx-usdils-window-below-2-75";
    const closeAt = "2026-11-18T21:59:00.000Z";
    const marketContract = {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: "https://www.tradingview.com/symbols/USDILS/",
        sourceIds: ["src_tradingview_fx"]
      },
      trustDisplayUrl: "https://www.tradingview.com/symbols/USDILS/",
      machineResolutionEndpoint:
        `hachozeh://oracle/tradingview-fx-snapshot?market=${marketId}&symbol=USDILS&from=2026-06-30T00%3A00%3A00.000Z&to=2026-11-18T21%3A59%3A00.000Z`,
      resolutionRule: "כן אם USD/ILS ירד מתחת ל-2.75 לפני מועד הסיום.",
      timeline: {
        closeAt,
        fxObservationMode: "window",
        fxObservationCadenceMinutes: 60
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ]
    };
    const pool = createPool({
      closedMarkets: [],
      capabilityMarkets: [
        {
          id: marketId,
          status: "open",
          closeAt: new Date(closeAt),
          marketContract
        }
      ]
    });
    const captureFxSnapshot = vi.fn(async () => ({
      objectType: "oracle_tradingview_fx_snapshot_capture_result" as const,
      marketId,
      lifecycleEventId: "lifevt_fx_window_snapshot",
      deduped: false,
      machineResolutionEndpoint:
        `hachozeh://oracle/tradingview-fx-snapshot?market=${marketId}&symbol=USDILS&at=2026-07-01T10%3A00%3A00.000Z`,
      snapshot: {
        objectType: "tradingview_fx_snapshot_v1" as const,
        sourceFamily: "tradingview_fx" as const,
        provider: "tradingview_scanner" as const,
        symbol: "USDILS",
        ticker: "FX_IDC:USDILS",
        sourceUrl: "https://www.tradingview.com/symbols/USDILS/",
        scannerUrl: "https://scanner.tradingview.com/forex/scan",
        observedAt: "2026-07-01T10:00:00.000Z",
        fetchedAt: "2026-07-01T10:00:00.000Z",
        status: "final" as const,
        price: 2.76,
        close: 2.76,
        bid: 2.759,
        ask: 2.761,
        currency: "ILS",
        updateMode: "streaming",
        description: "U.S. DOLLAR / ISRAELI SHEKEL",
        rawHash: "hash_fx_window",
        rawPayload: {}
      }
    }));

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-07-01T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      captureFxSnapshot,
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(captureFxSnapshot).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId,
        symbol: "USDILS",
        observedAt: new Date("2026-07-01T10:00:00.000Z"),
        idempotencyKey: `${marketId}:USDILS:window:2026-07-01T10:00:00.000Z`
      })
    );
    expect(result.phases.sourceSnapshots).toMatchObject({
      checkedMarketCount: 1,
      capturedCount: 1,
      items: [
        {
          marketId,
          action: "captured",
          symbol: "USDILS",
          lifecycleEventId: "lifevt_fx_window_snapshot"
        }
      ]
    });
  });

  it("runs official final intake for an early-closed market only when Oracle close provenance exists", async () => {
    const pool = createPool({
      closedMarkets: [
        {
          id: "disc-cm-nba-early-close",
          closeAt: new Date("2026-05-06T12:00:00.000Z"),
          closedAt: new Date("2026-05-06T10:00:00.000Z")
        }
      ],
      closeAudits: [
        {
          marketId: "disc-cm-nba-early-close",
          triggerType: "oracle_confirmed_event_completion"
        }
      ]
    });
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T13:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake,
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.blockers).toHaveLength(0);
    expect(result.phases.closeProvenance.items[0]).toMatchObject({
      marketId: "disc-cm-nba-early-close",
      provenanceStatus: "confirmed",
      triggerType: "oracle_confirmed_event_completion"
    });
    expect(officialFinalIntake).toHaveBeenCalledTimes(1);
  });

  it("treats official source lag as warning instead of unsafe manual action", async () => {
    const marketId = "disc-cm-source-lag-proof";
    const pool = createPool({
      closedMarkets: [{ id: marketId }],
      closeAudits: [
        {
          marketId,
          triggerType: "scheduled_time"
        }
      ]
    });
    const recordEventUpdates = vi.fn(async () => ({
      objectType: "source_lag_event_update_result" as const,
      generatedAt: "2026-05-06T10:00:00.000Z",
      upsertedCount: 1,
      skippedCount: 0,
      items: [
        {
          objectType: "market_event_update_receipt" as const,
          id: "meu_source_lag",
          marketId,
          eventType: "official_source_not_ready" as const,
          tier: "system_status" as const,
          dedupeKey: "https://www.nikeliga.sk/zapas/2774-slo-mic",
          sourceUrl: "https://www.nikeliga.sk/zapas/2774-slo-mic",
          observedAt: "2026-05-06T10:00:00.000Z",
          summary: "Official source is not final yet after the expected resolution time."
        }
      ]
    }));

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialNotFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () =>
        buildResolveInbox({
          missingCaseCount: 1,
          missingCases: [
            {
              itemType: "missing_case",
              marketId,
              marketTitle: "מה תהיה התוצאה?",
              marketStatus: "closed",
              closeAt: "2026-05-06T09:00:00.000Z",
              closedAt: "2026-05-06T09:00:01.000Z",
              ageHours: 1,
              resolutionSource: "https://www.nikeliga.sk/zapas/2774-slo-mic",
              resolutionRules: "Resolve from official final score.",
              nextAction: "create_resolution_case",
              suggestedCommand:
                "npm --prefix systems/back run oracle -- inspect-resolution --market disc-cm-source-lag-proof --json"
            }
          ]
        })
      ),
      recordEventUpdates
    });

    expect(result.status).toBe("completed_with_warnings");
    expect(result.warnings[0]).toMatchObject({
      warningCode: "final_source_not_ready",
      marketId
    });
    expect(
      result.actions.some((action) => action.actionType === "create_resolution_case")
    ).toBe(false);
    expect(recordEventUpdates).toHaveBeenCalledOnce();
    expect(result.phases.eventUpdates).toMatchObject({
      upsertedCount: 1,
      items: [
        {
          id: "meu_source_lag",
          eventType: "official_source_not_ready"
        }
      ]
    });
  });

  it("blocks resolution intake when a closed market has no close provenance", async () => {
    const pool = createPool({
      closedMarkets: [
        {
          id: "disc-cm-nba-dirty-close"
        }
      ],
      closeAudits: []
    });
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake,
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers[0]).toMatchObject({
      blockerCode: "blocked_missing_close_provenance",
      marketId: "disc-cm-nba-dirty-close",
      safeToAutoExecute: false,
      riskLevel: "dangerous_manual_only"
    });
    expect(result.phases.evidenceIntake).toMatchObject({
      eligibleMarketCount: 0,
      skippedForMissingProvenanceCount: 1
    });
    expect(officialFinalIntake).not.toHaveBeenCalled();
  });

  it("blocks resolution intake when scheduled close provenance predates close_at", async () => {
    const pool = createPool({
      closedMarkets: [
        {
          id: "disc-cm-boi-early-scheduled-close",
          closeAt: new Date("2026-05-25T16:00:00.000Z"),
          closedAt: new Date("2026-04-16T11:55:05.000Z")
        }
      ],
      closeAudits: [
        {
          marketId: "disc-cm-boi-early-scheduled-close",
          triggerType: "scheduled_time"
        }
      ]
    });
    const officialFinalIntake = vi.fn(async (_dbPool, options) =>
      buildOfficialFinalResult(options?.marketId ?? "unknown")
    );

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake,
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers[0]).toMatchObject({
      blockerCode: "blocked_invalid_close_provenance",
      marketId: "disc-cm-boi-early-scheduled-close"
    });
    expect(result.phases.closeProvenance.items[0]).toMatchObject({
      provenanceStatus: "invalid",
      triggerType: "scheduled_time"
    });
    expect(officialFinalIntake).not.toHaveBeenCalled();
  });

  it("marks approval commands as unsafe for harness auto-execution", async () => {
    const pool = createPool({
      closedMarkets: [],
      closeAudits: []
    });

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () =>
        buildResolveInbox({
          recommendedCaseCount: 1,
          recommendedCases: [
            {
              itemType: "recommended_case",
              marketId: "disc-cm-nba-proof",
              marketTitle: "מי תנצח?",
              oracleCaseId: "orc_clean_case",
              caseStatus: "recommended",
              ambiguityLevel: "medium",
              winningOutcomeId: "disc-cm-nba-proof-option-2",
              winningOutcomeLabel: "ניו יורק ניקס",
              evidencePacketId: "evp_clean_case",
              evidenceSummary: "Knicks won.",
              sourceCount: 1,
              nextAction: "approve_reject_or_request_more_evidence",
              suggestedApproveCommand:
                "npm --prefix systems/back run oracle -- approve-resolution-case --case orc_clean_case --json",
              suggestedRejectCommand:
                "npm --prefix systems/back run oracle -- reject-case --case orc_clean_case --json",
              suggestedMoreEvidenceCommand:
                "npm --prefix systems/back run oracle -- request-more-evidence --case orc_clean_case --json"
            }
          ]
        })
      )
    });

    const approvalAction = result.actions.find(
      (action) => action.actionType === "approve_resolution_case"
    );

    expect(approvalAction).toMatchObject({
      riskLevel: "approval_required",
      safeToAutoExecute: false,
      requiresExplicitApproval: true,
      oracleCaseId: "orc_clean_case"
    });
  });

  it("scopes Horizon scheduled close sweep to the requested market", async () => {
    const pool = createPool({
      closedMarkets: [],
      closeAudits: []
    });
    const closeSweep = vi.fn(async () => buildCloseSweepResult());

    await runOracleLifecycleRun(pool, {
      marketId: "disc-cm-target-market",
      now: new Date("2026-05-06T10:00:00.000Z"),
      closeSweep,
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(closeSweep).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        marketId: "disc-cm-target-market"
      })
    );
  });

  it("surfaces unsupported open-market source families as lifecycle blockers", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from audit_events")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
          return {
            rows: [
              {
                id: "disc-cm-unknown-source",
                title: "מה יקרה?",
                status: "open",
                close_at: new Date("2026-05-09T16:00:00.000Z"),
                close_on_event_completion: true,
                event_completion_close_requires_human_approval: true,
                resolution_source: "https://official.example.invalid/event/1",
                resolution_rules: "Resolve from official source.",
                oracle_source_policy: null
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                id: "disc-cm-unknown-source-yes",
                label: "כן"
              },
              {
                id: "disc-cm-unknown-source-no",
                label: "לא"
              }
            ],
            rowCount: 2
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-09T15:30:00.000Z"),
      dryRun: true,
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("blocked");
    expect(result.phases.capability).toMatchObject({
      checkedMarketCount: 1,
      unsupportedCount: 1,
      items: [
        {
          marketId: "disc-cm-unknown-source",
          classification: "unsupported_source_family"
        }
      ]
    });
    expect(result.blockers[0]).toMatchObject({
      blockerCode: "blocked_lifecycle_capability",
      marketId: "disc-cm-unknown-source",
      reason: expect.stringContaining("unsupported")
    });
  });

  it("surfaces missing adapter credentials as lifecycle blockers before resolution time", async () => {
    const originalImsToken = process.env.IMS_API_TOKEN;
    delete process.env.IMS_API_TOKEN;

    const pool = createPool({
      closedMarkets: [],
      closeAudits: [],
      capabilityMarkets: [
        {
          id: "disc-weather-test",
          title: "הטמפרטורה הגבוהה ביותר",
          status: "open",
          marketContract: {
            objectType: "market_contract_v1",
            measurementKind: "official_value",
            resultShape: "multi_outcome",
            oracleCapability: "supported_final_only",
            resolutionSource: {
              url: "https://ims.gov.il/en/data_gov",
              sourceIds: ["src_ims_daily_observations"]
            }
          }
        }
      ]
    });

    try {
      const result = await runOracleLifecycleRun(pool, {
        now: new Date("2026-05-09T15:30:00.000Z"),
        dryRun: true,
        closeSweep: vi.fn(async () => buildCloseSweepResult()),
        officialFinalIntake: vi.fn(async (_dbPool, options) =>
          buildOfficialFinalResult(options?.marketId ?? "unknown")
        ),
        resolveInbox: vi.fn(async () => buildResolveInbox())
      });

      expect(result.status).toBe("blocked");
      expect(result.phases.capability).toMatchObject({
        checkedMarketCount: 1,
        items: [
          {
            marketId: "disc-weather-test",
            classification: "registered_no_credentials",
            resolution: {
              supported: false,
              sourceFamily: "ims_daily_observations"
            }
          }
        ]
      });
      expect(result.blockers[0]).toMatchObject({
        blockerCode: "blocked_lifecycle_capability",
        marketId: "disc-weather-test",
        reason: expect.stringContaining("registered_no_credentials")
      });
    } finally {
      if (originalImsToken == null) {
        delete process.env.IMS_API_TOKEN;
      } else {
        process.env.IMS_API_TOKEN = originalImsToken;
      }
    }
  });

  it("does not treat resolved markets as active lifecycle capability blockers", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from audit_events")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from market_outcomes")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-09T15:30:00.000Z"),
      dryRun: true,
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("completed_clean");
    expect(result.phases.capability).toMatchObject({
      checkedMarketCount: 0,
      unsupportedCount: 0
    });
    expect(result.blockers).toHaveLength(0);
  });

  it("honors Seer market_contract blocked capability as lifecycle blocker", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from audit_events")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
          return {
            rows: [
              {
                id: "disc-cm-ecb-rate-proof",
                title: "מה תעשה ה-ECB?",
                status: "open",
                close_at: new Date("2026-06-04T12:00:00.000Z"),
                close_on_event_completion: true,
                event_completion_close_requires_human_approval: true,
                resolution_source: null,
                resolution_rules: null,
                oracle_source_policy: null,
                market_contract: {
                  objectType: "market_contract_v1",
                  measurementKind: "rate_direction",
                  resultShape: "cut_hold_hike",
                  oracleCapability: "blocked",
                  resolutionSource: {
                    url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
                    sourceIds: ["src_ecb_rss"]
                  },
                  resolutionRule: "Resolve from ECB official source."
                }
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                market_id: "disc-cm-ecb-rate-proof",
                id: "disc-cm-ecb-rate-proof-hold",
                label: "ללא שינוי"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-09T15:30:00.000Z"),
      dryRun: true,
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("blocked");
    expect(result.phases.capability).toMatchObject({
      checkedMarketCount: 1,
      blockedByContractCount: 1,
      items: [
        {
          marketId: "disc-cm-ecb-rate-proof",
          classification: "blocked_by_contract"
        }
      ]
    });
    expect(result.phases.closeCondition.items[0]).toMatchObject({
      marketId: "disc-cm-ecb-rate-proof",
      action: "skipped_not_supported",
      reason: expect.stringContaining("oracleCapability=blocked")
    });
    expect(result.blockers[0]).toMatchObject({
      blockerCode: "blocked_lifecycle_capability",
      marketId: "disc-cm-ecb-rate-proof",
      reason: expect.stringContaining("blocked_by_contract")
    });
  });

  it("parks future open manual-resolution markets without blocking the worker", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from audit_events")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
          return {
            rows: [
              {
                id: "disc-cm-manual-future",
                title: "האם הכנסת תתפזר עד סוף יולי?",
                status: "open",
                close_at: new Date("2026-07-31T20:59:00.000Z"),
                close_on_event_completion: false,
                event_completion_close_requires_human_approval: true,
                resolution_source: "https://main.knesset.gov.il/",
                resolution_rules: "Resolve manually from official Knesset publications.",
                oracle_source_policy: null,
                market_contract: {
                  objectType: "market_contract_v1",
                  measurementKind: "official_event",
                  resultShape: "yes_no",
                  oracleCapability: "manual_resolution_required",
                  resolutionSource: {
                    url: "https://main.knesset.gov.il/",
                    sourceIds: ["src_knesset_official"]
                  },
                  resolutionRule: "Resolve manually from official Knesset publications."
                }
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                market_id: "disc-cm-manual-future",
                id: "disc-cm-manual-future-yes",
                label: "כן"
              },
              {
                market_id: "disc-cm-manual-future",
                id: "disc-cm-manual-future-no",
                label: "לא"
              }
            ],
            rowCount: 2
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-19T10:00:00.000Z"),
      dryRun: true,
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("completed_clean");
    expect(result.phases.capability).toMatchObject({
      checkedMarketCount: 1,
      manualResolutionRequiredCount: 1,
      items: [
        {
          marketId: "disc-cm-manual-future",
          classification: "manual_resolution_required"
        }
      ]
    });
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("reports a close-condition case action when a supported open market source has started", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets m") && sql.includes("status = 'closed'")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from audit_events")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from markets m") && sql.includes("status in ('open', 'closed')")) {
          return {
            rows: [
              {
                id: "disc-cm-nike-liga-proof",
                title: "מה תהיה התוצאה הרשמית?",
                status: "open",
                close_at: new Date("2026-05-09T16:00:00.000Z"),
                close_on_event_completion: true,
                event_completion_close_requires_human_approval: true,
                resolution_source: "https://www.nikeliga.sk/zapas/2772-pod-slo",
                resolution_rules: "Resolve from official source.",
                oracle_source_policy: null
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                market_id: "disc-cm-nike-liga-proof",
                id: "disc-cm-nike-liga-proof-home",
                label: "פודברזובה"
              },
              {
                market_id: "disc-cm-nike-liga-proof",
                id: "disc-cm-nike-liga-proof-draw",
                label: "תיקו"
              },
              {
                market_id: "disc-cm-nike-liga-proof",
                id: "disc-cm-nike-liga-proof-away",
                label: "סלובן ברטיסלבה"
              }
            ],
            rowCount: 3
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const result = await runOracleLifecycleRun(pool, {
      now: new Date("2026-05-09T16:05:00.000Z"),
      dryRun: true,
      fetchText: async () => `
        <div class="game__scoreboard">
          <div class="game__scoreboard__team game__scoreboard__team--home">
            <span class="hidden-xs">FK Železiarne Podbrezová</span>
          </div>
          <div class="game__scoreboard__score"><strong>0:0</strong></div>
          <div class="game__scoreboard__team game__scoreboard__team--away">
            <span class="hidden-xs">ŠK Slovan Bratislava</span>
          </div>
        </div>
      `,
      closeSweep: vi.fn(async () => buildCloseSweepResult()),
      officialFinalIntake: vi.fn(async (_dbPool, options) =>
        buildOfficialFinalResult(options?.marketId ?? "unknown")
      ),
      resolveInbox: vi.fn(async () => buildResolveInbox())
    });

    expect(result.status).toBe("completed_with_actions");
    expect(result.phases.closeCondition.items[0]).toMatchObject({
      marketId: "disc-cm-nike-liga-proof",
      action: "would_create_case",
      status: "live",
      closeConditionSatisfied: true
    });
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "create_close_condition_case",
          marketId: "disc-cm-nike-liga-proof",
          riskLevel: "state_mutating_low_risk",
          safeToAutoExecute: true,
          requiresExplicitApproval: false
        })
      ])
    );
  });
});
