import { describe, expect, it } from "vitest";

import {
  COINBASE_CANDLES_SOURCE_ADAPTER,
  extractCoinbaseCandleSpec
} from "../../../../oracle/src/adapters/coinbase-candles-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12",
    marketTitle: "האם ביטקוין יסגור מעל 80,000 דולר ב-12 במאי לפי Coinbase?",
    marketStatus: "closed",
    closeAt: "2026-05-13T00:00:00.000Z",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: "Coinbase Exchange BTC-USD candles: https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
    resolutionRules: "מוכרע לפי נר BTC-USD יומי של Coinbase Exchange עבור 12 במאי 2026 לפי UTC. כן אם הסגירה מעל 80,000 דולר.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_coinbase_exchange_candles"],
      resolutionSourceIds: ["src_coinbase_exchange_candles"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
        sourceIds: ["src_coinbase_exchange_candles"]
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ],
      timeline: {
        closeAt: "2026-05-13T00:00:00.000Z"
      }
    },
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ],
    ...overrides
  };
}

describe("Coinbase candles source adapter", () => {
  it("extracts product and UTC candle date from the contract", () => {
    expect(extractCoinbaseCandleSpec(context())).toEqual({
      productId: "BTC-USD",
      candleDate: "2026-05-12"
    });
  });

  it("resolves threshold markets from the official daily close", async () => {
    const inspection = await COINBASE_CANDLES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-13T07:00:00.000Z"),
      fetchJson: async () => [[1778544000, 79000, 81200, 79500, 80500, 100]]
    });

    expect(inspection).toMatchObject({
      sourceFamily: "coinbase_exchange_candles",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      confidence: "high",
      blockers: []
    });
    expect(inspection.officialJsonUrl).toContain(
      "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
    );
  });

  it("maps range markets to the matching outcome bucket", async () => {
    const inspection = await COINBASE_CANDLES_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-cm-front-sixpack-coinbase-eth-usd-close-range-2026-05-12",
        marketTitle: "באיזה טווח אתריום יסגור ב-12 במאי לפי Coinbase?",
        resolutionSource: "Coinbase Exchange ETH-USD candles: https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400",
        resolutionRules: "מוכרע לפי נר ETH-USD יומי של Coinbase Exchange עבור 12 במאי 2026 לפי UTC.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400",
            sourceIds: ["src_coinbase_exchange_candles"]
          },
          outcomeMap: [
            { outcomeLabel: "מתחת ל-2,250$", evidenceKey: "below-2250" },
            { outcomeLabel: "2,250$ עד 2,350$", evidenceKey: "range-2250-2350" },
            { outcomeLabel: "מעל 2,350$", evidenceKey: "above-2350" }
          ]
        },
        outcomes: [
          { outcomeId: "below", outcomeKey: "below", label: "מתחת ל-2,250$" },
          { outcomeId: "range", outcomeKey: "range", label: "2,250$ עד 2,350$" },
          { outcomeId: "above", outcomeKey: "above", label: "מעל 2,350$" }
        ]
      }),
      {
        now: new Date("2026-05-13T07:00:00.000Z"),
        fetchJson: async () => [[1778544000, 2200, 2360, 2260, 2310, 200]]
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "range-2250-2350",
      winnerLabel: "2,250$ עד 2,350$",
      blockers: []
    });
  });

  it("prefers evidence-key range bounds over K labels and prose numbers", async () => {
    const inspection = await COINBASE_CANDLES_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-crypto-btc-close-range-2026-07-09",
        marketTitle: "טווח סגירת ביטקוין ב-9 ביולי",
        resolutionSource: "Coinbase BTC-USD: https://www.coinbase.com/advanced-trade/spot/BTC-USD",
        resolutionRules:
          "השוק מודד את מחיר הסגירה היומי של BTC-USD ב-Coinbase ל-9 ביולי 2026. התוצאה הזוכה היא הטווח שבו נמצא מחיר הסגירה.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: "https://www.coinbase.com/advanced-trade/spot/BTC-USD",
            sourceIds: ["src_coinbase_exchange_candles"]
          },
          outcomeMap: [
            {
              outcomeLabel: "עד $60K",
              evidenceKey: "below-60000",
              resolutionPath: "זוכה אם מחיר הסגירה נמוך מ-60000 דולר."
            },
            {
              outcomeLabel: "$60K-$62.5K",
              evidenceKey: "range-60000-62500",
              resolutionPath: "זוכה אם מחיר הסגירה הוא מ-60000 עד 62500 דולר."
            },
            {
              outcomeLabel: "$62.5K-$65K",
              evidenceKey: "range-62500-65000",
              resolutionPath: "זוכה אם מחיר הסגירה הוא מ-62500 עד 65000 דולר."
            },
            {
              outcomeLabel: "$65K-$67.5K",
              evidenceKey: "range-65000-67499.99",
              resolutionPath: "זוכה אם מחיר הסגירה הוא מ-65000 עד 67499.99 דולר."
            },
            {
              outcomeLabel: "$67.5K ומעלה",
              evidenceKey: "above-67499.99",
              resolutionPath: "זוכה אם מחיר הסגירה מעל 67499.99 דולר."
            }
          ]
        },
        outcomes: [
          { outcomeId: "below", outcomeKey: "below-60000", label: "עד $60K" },
          { outcomeId: "range-60", outcomeKey: "range-60000-62500", label: "$60K-$62.5K" },
          { outcomeId: "range-62", outcomeKey: "range-62500-65000", label: "$62.5K-$65K" },
          { outcomeId: "range-65", outcomeKey: "range-65000-67499.99", label: "$65K-$67.5K" },
          { outcomeId: "above", outcomeKey: "above-67499.99", label: "$67.5K ומעלה" }
        ]
      }),
      {
        now: new Date("2026-07-10T07:00:00.000Z"),
        fetchJson: async () => [[1783555200, 62000, 64000, 63000, 63175.25, 100]]
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "range-62500-65000",
      winnerLabel: "$62.5K-$65K",
      blockers: []
    });
  });

  it("blocks safely when the daily candle is not published", async () => {
    const inspection = await COINBASE_CANDLES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-13T00:05:00.000Z"),
      fetchJson: async () => []
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false,
      blockers: ["coinbase_candle_missing"]
    });
  });
});
