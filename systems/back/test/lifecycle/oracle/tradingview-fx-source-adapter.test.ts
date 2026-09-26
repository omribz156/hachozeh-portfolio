import { describe, expect, it } from "vitest";

import {
  extractTradingViewFxSpec,
  TRADINGVIEW_FX_SOURCE_ADAPTER
} from "../../../../oracle/src/adapters/tradingview-fx-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-live-fx-eurusd-above-1-16-2026-06-02",
    marketTitle: "האם EUR/USD יהיה מעל 1.16 בסגירת 2 ביוני לפי TradingView?",
    marketStatus: "closed",
    closeAt: "2026-06-02T20:59:00.000Z",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: false,
    resolutionSource: "TradingView EURUSD: https://www.tradingview.com/symbols/EURUSD/",
    resolutionRules:
      "מוכרע לפי snapshot timestamped של TradingView עבור EURUSD סביב 2026-06-02T20:59:00Z. כן אם EUR/USD מעל 1.16.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_tradingview_fx"],
      resolutionSourceIds: ["src_tradingview_fx"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      trustDisplayUrl: "https://www.tradingview.com/symbols/EURUSD/",
      machineResolutionEndpoint: "https://example.test/tradingview/fx?symbol=EURUSD&at=2026-06-02T20:59:00Z",
      resolutionSource: {
        url: "https://www.tradingview.com/symbols/EURUSD/",
        sourceIds: ["src_tradingview_fx"]
      },
      timeline: {
        closeAt: "2026-06-02T20:59:00.000Z",
        maxCloseLagMinutes: 15
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ]
    },
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ],
    ...overrides
  };
}

describe("TradingView FX source adapter", () => {
  it("extracts symbol, close time, and machine endpoint from the contract", () => {
    expect(extractTradingViewFxSpec(context())).toEqual({
      symbol: "EURUSD",
      closeAt: "2026-06-02T20:59:00.000Z",
      machineResolutionEndpoint: "https://example.test/tradingview/fx?symbol=EURUSD&at=2026-06-02T20:59:00Z",
      maxCloseLagMinutes: 15
    });
  });

  it("resolves threshold markets from timestamped FX snapshots", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-06-02T21:05:00.000Z"),
      fetchJson: async () => ({
        symbol: "EURUSD",
        price: 1.1623,
        observedAt: "2026-06-02T21:00:00.000Z"
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "tradingview_fx",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      confidence: "high",
      blockers: []
    });
  });

  it("resolves below-threshold markets from timestamped FX snapshots", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-cm-live-fx-usdils-below-2-75-2026-06-02",
        marketTitle: "האם USD/ILS יהיה מתחת ל-2.75 בסגירת 2 ביוני לפי TradingView?",
        resolutionSource: "TradingView USDILS: https://www.tradingview.com/symbols/USDILS/",
        resolutionRules:
          "מוכרע לפי snapshot timestamped של TradingView עבור USDILS סביב 2026-06-02T20:59:00Z. כן אם USD/ILS מתחת ל-2.75.",
        marketContract: {
          ...context().marketContract!,
          trustDisplayUrl: "https://www.tradingview.com/symbols/USDILS/",
          machineResolutionEndpoint: "https://example.test/tradingview/fx?symbol=USDILS&at=2026-06-02T20:59:00Z",
          resolutionSource: {
            url: "https://www.tradingview.com/symbols/USDILS/",
            sourceIds: ["src_tradingview_fx"]
          }
        }
      }),
      {
        now: new Date("2026-06-02T21:05:00.000Z"),
        fetchJson: async () => ({
          symbol: "USDILS",
          price: 2.742,
          observedAt: "2026-06-02T21:00:00.000Z"
        })
      }
    );

    expect(inspection).toMatchObject({
      sourceFamily: "tradingview_fx",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      normalizedSnapshot: {
        threshold: 2.75,
        operator: "<"
      },
      blockers: []
    });
  });

  it("resolves windowed crossing markets from stored FX observations", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-cm-live-fx-usdils-window-below-2-75-2026-11-18",
        marketTitle: "האם הדולר ירד מתחת ל-2.75 ש\"ח לפני GTA VI?",
        closeAt: "2026-11-18T21:59:00.000Z",
        resolutionSource: "TradingView USDILS: https://www.tradingview.com/symbols/USDILS/",
        resolutionRules:
          "כן אם USD/ILS ירד מתחת ל-2.75 לפני מועד הסיום.",
        marketContract: {
          ...context().marketContract!,
          trustDisplayUrl: "https://www.tradingview.com/symbols/USDILS/",
          machineResolutionEndpoint:
            "hachozeh://oracle/tradingview-fx-snapshot?market=disc-cm-live-fx-usdils-window-below-2-75-2026-11-18&symbol=USDILS&from=2026-06-30T00%3A00%3A00.000Z&to=2026-11-18T21%3A59%3A00.000Z",
          resolutionSource: {
            url: "https://www.tradingview.com/symbols/USDILS/",
            sourceIds: ["src_tradingview_fx"]
          },
          timeline: {
            closeAt: "2026-11-18T21:59:00.000Z",
            fxObservationMode: "window",
            fxObservationCadenceMinutes: 60
          }
        }
      }),
      {
        now: new Date("2026-11-18T22:05:00.000Z"),
        fetchJson: async () => [
          {
            symbol: "USDILS",
            price: 2.76,
            observedAt: "2026-07-01T10:00:00.000Z",
            status: "final"
          },
          {
            symbol: "USDILS",
            price: 2.742,
            observedAt: "2026-08-03T11:00:00.000Z",
            status: "final"
          }
        ]
      }
    );

    expect(inspection).toMatchObject({
      sourceFamily: "tradingview_fx",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      normalizedSnapshot: {
        threshold: 2.75,
        operator: "<",
        observationCount: 2,
        matchingObservation: {
          price: 2.742,
          observedAt: "2026-08-03T11:00:00.000Z"
        }
      },
      blockers: []
    });
  });

  it("resolves windowed crossing markets to no when stored observations never match", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "האם הדולר ירד מתחת ל-2.75 ש\"ח לפני GTA VI?",
        closeAt: "2026-11-18T21:59:00.000Z",
        resolutionRules:
          "כן אם USD/ILS ירד מתחת ל-2.75 לפני מועד הסיום.",
        marketContract: {
          ...context().marketContract!,
          machineResolutionEndpoint:
            "hachozeh://oracle/tradingview-fx-snapshot?market=disc-cm-live-fx-usdils-window&symbol=USDILS&from=2026-06-30T00%3A00%3A00.000Z&to=2026-11-18T21%3A59%3A00.000Z",
          timeline: {
            closeAt: "2026-11-18T21:59:00.000Z",
            fxObservationMode: "window"
          }
        }
      }),
      {
        now: new Date("2026-11-18T22:05:00.000Z"),
        fetchJson: async () => [
          {
            symbol: "USDILS",
            price: 2.76,
            observedAt: "2026-07-01T10:00:00.000Z",
            status: "final"
          },
          {
            symbol: "USDILS",
            price: 2.751,
            observedAt: "2026-08-03T11:00:00.000Z",
            status: "final"
          }
        ]
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerLabel: "לא",
      normalizedSnapshot: {
        observationCount: 2,
        matchingObservation: null
      },
      blockers: []
    });
  });

  it("blocks snapshots without a source timestamp", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-06-02T21:05:00.000Z"),
      fetchJson: async () => ({
        symbol: "EURUSD",
        price: 1.1623
      })
    });

    expect(inspection).toMatchObject({
      status: "live",
      resolutionAvailable: false,
      blockers: ["tradingview_fx_timestamp_missing"]
    });
  });

  it("rejects unsafe machine resolution endpoints before fetch", async () => {
    const unsafeContext = context({
      marketContract: {
        ...context().marketContract!,
        machineResolutionEndpoint: "http://127.0.0.1:3001/health/diagnostics"
      }
    });

    await expect(
      TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(unsafeContext, {
        now: new Date("2026-06-02T21:05:00.000Z")
      })
    ).rejects.toThrow(/must use https/);
  });

  it("maps range markets to the matching outcome bucket", async () => {
    const inspection = await TRADINGVIEW_FX_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-cm-live-fx-eurils-range-2026-06-02",
        marketTitle: "באיזה טווח EUR/ILS יהיה בסגירת 2 ביוני לפי TradingView?",
        resolutionSource: "TradingView EURILS: https://www.tradingview.com/symbols/EURILS/",
        resolutionRules: "מוכרע לפי snapshot timestamped של TradingView עבור EURILS.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          trustDisplayUrl: "https://www.tradingview.com/symbols/EURILS/",
          machineResolutionEndpoint: "https://example.test/tradingview/fx?symbol=EURILS&at=2026-06-02T20:59:00Z",
          resolutionSource: {
            url: "https://www.tradingview.com/symbols/EURILS/",
            sourceIds: ["src_tradingview_fx"]
          },
          timeline: {
            closeAt: "2026-06-02T20:59:00.000Z"
          },
          outcomeMap: [
            { outcomeLabel: "מתחת ל-3.80", evidenceKey: "below-3.80" },
            { outcomeLabel: "3.80 עד 3.90", evidenceKey: "range-3.80-3.90" },
            { outcomeLabel: "מעל 3.90", evidenceKey: "above-3.90" }
          ]
        },
        outcomes: [
          { outcomeId: "below", outcomeKey: "below", label: "מתחת ל-3.80" },
          { outcomeId: "range", outcomeKey: "range", label: "3.80 עד 3.90" },
          { outcomeId: "above", outcomeKey: "above", label: "מעל 3.90" }
        ]
      }),
      {
        now: new Date("2026-06-02T21:05:00.000Z"),
        fetchJson: async () => ({
          symbol: "EURILS",
          price: 3.842,
          observedAt: "2026-06-02T21:01:00.000Z"
        })
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "range-3.80-3.90",
      winnerLabel: "3.80 עד 3.90",
      blockers: []
    });
  });
});
