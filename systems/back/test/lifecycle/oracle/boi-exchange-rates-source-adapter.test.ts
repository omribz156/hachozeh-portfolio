import { describe, expect, it } from "vitest";

import {
  BOI_EXCHANGE_RATES_SOURCE_ADAPTER,
  extractBoiExchangeRateSpec
} from "../../../../oracle/src/adapters/boi-exchange-rates-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-boi-usd-ils-3-70-2026-05-31",
    marketTitle: "האם השער היציג של הדולר יגיע ל-3.70 ש\"ח ב-31 במאי 2026?",
    marketStatus: "closed",
    closeAt: "2026-05-31T12:00:00.000Z",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: "https://boi.org.il/PublicApi/GetExchangeRates",
    resolutionRules: "מוכרע לפי שער החליפין היציג USD/ILS של בנק ישראל עבור 31 במאי 2026. כן אם השער הרשמי יהיה 3.70 או יותר.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_boi_exchange_rates"],
      resolutionSourceIds: ["src_boi_exchange_rates"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: "https://boi.org.il/PublicApi/GetExchangeRates",
        sourceIds: ["src_boi_exchange_rates"]
      },
      timeline: {
        closeAt: "2026-05-31T12:00:00.000Z",
        expectedResolutionAt: "2026-05-31T13:30:00.000Z"
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

function sdmxObs(value: number): string {
  return `<message:DataSet>
    <Series SERIES_CODE="RER_USD_ILS" FREQ="D" BASE_CURRENCY="USD" COUNTER_CURRENCY="ILS" UNIT_MEASURE="ILS" DATA_TYPE="OF00">
      <Obs TIME_PERIOD="2026-05-31" OBS_VALUE="${value}" RELEASE_STATUS="YP"></Obs>
    </Series>
  </message:DataSet>`;
}

describe("BOI exchange-rates source adapter", () => {
  it("extracts currency, target date, threshold, and operator from the contract", () => {
    expect(extractBoiExchangeRateSpec(context())).toEqual({
      currencyKey: "USD",
      targetDate: "2026-05-31",
      threshold: 3.7,
      operator: ">="
    });
  });

  it("resolves threshold markets from BOI SDMX representative rates", async () => {
    const inspection = await BOI_EXCHANGE_RATES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-31T14:00:00.000Z"),
      fetchText: async () => sdmxObs(3.701),
      fetchJson: async () => {
        throw new Error("current endpoint should not be fetched when SDMX has the target date");
      }
    });

    expect(inspection).toMatchObject({
      sourceFamily: "boi_exchange_rates",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      confidence: "high",
      blockers: []
    });
    expect(inspection.officialJsonUrl).toContain("c%5BBASE_CURRENCY%5D=USD");
  });

  it("maps below-threshold observations to no", async () => {
    const inspection = await BOI_EXCHANGE_RATES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-31T14:00:00.000Z"),
      fetchText: async () => sdmxObs(3.699)
    });

    expect(inspection).toMatchObject({
      status: "final",
      evidenceKey: "no",
      winnerLabel: "לא"
    });
  });

  it("resolves under-threshold contracts when the representative rate is below the line", async () => {
    const inspection = await BOI_EXCHANGE_RATES_SOURCE_ADAPTER.inspectResolution(
      context({
        marketId: "disc-cm-boi-usd-ils-below-2-75-2026-05-31",
        marketTitle: "האם השער היציג של הדולר יהיה מתחת ל-2.75 ש\"ח ב-31 במאי 2026?",
        resolutionRules:
          "מוכרע לפי שער החליפין היציג USD/ILS של בנק ישראל עבור 31 במאי 2026. כן אם השער הרשמי יהיה מתחת ל-2.75 ש\"ח."
      }),
      {
        now: new Date("2026-05-31T14:00:00.000Z"),
        fetchText: async () => sdmxObs(2.749)
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      evidenceKey: "yes",
      winnerLabel: "כן",
      normalizedSnapshot: {
        spec: {
          threshold: 2.75,
          operator: "<"
        },
        operator: "<"
      }
    });
  });

  it("falls back to current BOI JSON only when lastUpdate matches the target date", async () => {
    const inspection = await BOI_EXCHANGE_RATES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-31T14:00:00.000Z"),
      fetchText: async () => "<message:DataSet></message:DataSet>",
      fetchJson: async () => ({
        key: "USD",
        currentExchangeRate: 3.72,
        unit: 1,
        lastUpdate: "2026-05-31T12:22:04.273953Z"
      })
    });

    expect(inspection).toMatchObject({
      status: "final",
      evidenceKey: "yes"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      observation: {
        sourceMode: "current",
        observedDate: "2026-05-31"
      }
    });
  });

  it("waits safely when BOI has not published the target-date observation", async () => {
    const inspection = await BOI_EXCHANGE_RATES_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-31T12:10:00.000Z"),
      fetchText: async () => "<message:DataSet></message:DataSet>",
      fetchJson: async () => ({
        key: "USD",
        currentExchangeRate: 3.68,
        unit: 1,
        lastUpdate: "2026-05-30T12:22:04.273953Z"
      })
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false,
      blockers: ["boi_fx_observation_missing"]
    });
  });
});
