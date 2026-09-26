import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractImsThresholdSpec,
  IMS_WEATHER_SOURCE_ADAPTER
} from "../../../../oracle/src/adapters/ims-weather-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-ims-test",
    marketTitle: "האם הטמפרטורה המקסימלית בתל אביב תגיע ב-12 במאי ל-30 מעלות?",
    marketStatus: "closed",
    closeAt: "2026-05-11T21:00:00.000Z",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: "https://ims.gov.il/en/data_gov",
    resolutionRules:
      "השוק מוכרע לפי ערך TDmax הרשמי של השירות המטאורולוגי בתחנת תל-אביב, חוף עבור 12 במאי 2026: 30.0°C ומעלה = כן; פחות מ-30.0°C = לא.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_ims_daily_observations"],
      resolutionSourceIds: ["src_ims_daily_observations"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      resolutionSource: {
        url: "https://ims.gov.il/en/data_gov",
        sourceIds: ["src_ims_daily_observations"]
      }
    },
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ],
    ...overrides
  };
}

describe("IMS weather source adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the IMS threshold spec from the Hebrew public rule", () => {
    expect(extractImsThresholdSpec(context())).toMatchObject({
      metric: "TDmax",
      stationId: "178",
      stationName: "תל-אביב, חוף",
      localDate: "2026-05-12",
      threshold: 30
    });
  });

  it("settles yes when TDmax reaches the threshold", async () => {
    const inspection = await IMS_WEATHER_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-13T06:00:00.000Z"),
      fetchJson: async () => ({
        data: [
          {
            date: "2026-05-12",
            TDmax: "28.4"
          },
          {
            date: "2026-05-12",
            TDmax: "30.4"
          }
        ]
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "ims_daily_observations",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      blockers: []
    });
    expect(inspection.officialJsonUrl).toBe(
      "https://api.ims.gov.il/v1/envista/stations/178/data/daily/2026/05/12"
    );
  });

  it("maps official TDmax into a 10-outcome temperature bucket", async () => {
    const inspection = await IMS_WEATHER_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "מה תהיה הטמפרטורה הגבוהה ביותר בתל אביב ב-28 במאי?",
        resolutionRules:
          "השוק מוכרע לפי ערך TDmax הרשמי של השירות המטאורולוגי בתחנת תל-אביב, חוף עבור 28 במאי 2026. התוצאה הזוכה היא מדרגת המעלות שבתוכה נמצא הערך הרשמי.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          resolutionSource: {
            url: "https://ims.gov.il/en/data_gov",
            sourceIds: ["src_ims_daily_observations"]
          },
          outcomeMap: [
            {
              outcomeLabel: "24°C ומטה",
              evidenceKey: "below-25",
              resolutionPath: "זוכה אם TDmax הרשמי נמוך מ-25.0°C."
            },
            {
              outcomeLabel: "25°C",
              evidenceKey: "range-25-25.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-25.0°C עד 25.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "26°C",
              evidenceKey: "range-26-26.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-26.0°C עד 26.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "27°C",
              evidenceKey: "range-27-27.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-27.0°C עד 27.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "28°C",
              evidenceKey: "range-28-28.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-28.0°C עד 28.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "29°C",
              evidenceKey: "range-29-29.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-29.0°C עד 29.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "30°C",
              evidenceKey: "range-30-30.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-30.0°C עד 30.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "31°C",
              evidenceKey: "range-31-31.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-31.0°C עד 31.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "32°C",
              evidenceKey: "range-32-32.9",
              resolutionPath: "זוכה אם TDmax הרשמי הוא מ-32.0°C עד 32.9°C, כולל הגבולות."
            },
            {
              outcomeLabel: "33°C ומעלה",
              evidenceKey: "at-least-33",
              resolutionPath: "זוכה אם TDmax הרשמי הוא 33.0°C ומעלה."
            }
          ]
        },
        outcomes: [
          { outcomeId: "below-25", outcomeKey: "below-25", label: "24°C ומטה" },
          { outcomeId: "range-25-25.9", outcomeKey: "range-25-25.9", label: "25°C" },
          { outcomeId: "range-26-26.9", outcomeKey: "range-26-26.9", label: "26°C" },
          { outcomeId: "range-27-27.9", outcomeKey: "range-27-27.9", label: "27°C" },
          { outcomeId: "range-28-28.9", outcomeKey: "range-28-28.9", label: "28°C" },
          { outcomeId: "range-29-29.9", outcomeKey: "range-29-29.9", label: "29°C" },
          { outcomeId: "range-30-30.9", outcomeKey: "range-30-30.9", label: "30°C" },
          { outcomeId: "range-31-31.9", outcomeKey: "range-31-31.9", label: "31°C" },
          { outcomeId: "range-32-32.9", outcomeKey: "range-32-32.9", label: "32°C" },
          { outcomeId: "at-least-33", outcomeKey: "at-least-33", label: "33°C ומעלה" }
        ]
      }),
      {
        now: new Date("2026-05-29T06:00:00.000Z"),
        fetchJson: async () => ({
          data: [
            {
              date: "2026-05-28",
              TDmax: "29.4"
            }
          ]
        })
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "range-29-29.9",
      winnerLabel: "29°C",
      blockers: []
    });
  });

  it("uses the IMS ApiToken header when doing live adapter fetch", async () => {
    const original = process.env.IMS_API_TOKEN;
    process.env.IMS_API_TOKEN = "ims-test-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          {
            channels: [
              {
                name: "TDmax",
                value: 29.8
              }
            ]
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const inspection = await IMS_WEATHER_SOURCE_ADAPTER.inspectResolution(context(), {
        now: new Date("2026-05-13T06:00:00.000Z")
      });

      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toBe("https://api.ims.gov.il/v1/envista/stations/178/data/daily/2026/05/12");
      expect(init).toMatchObject({
        headers: expect.objectContaining({
          Authorization: "ApiToken ims-test-token"
        })
      });
      expect(inspection).toMatchObject({
        status: "final",
        evidenceKey: "no",
        winnerLabel: "לא"
      });
    } finally {
      if (original == null) {
        delete process.env.IMS_API_TOKEN;
      } else {
        process.env.IMS_API_TOKEN = original;
      }
    }
  });

  it("treats an empty IMS daily response as missing metric data instead of a JSON crash", async () => {
    const original = process.env.IMS_API_TOKEN;
    process.env.IMS_API_TOKEN = "ims-test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        text: async () => ""
      }))
    );

    try {
      const inspection = await IMS_WEATHER_SOURCE_ADAPTER.inspectResolution(context(), {
        now: new Date("2026-05-13T06:00:00.000Z")
      });

      expect(inspection).toMatchObject({
        status: "not_started",
        resolutionAvailable: false,
        blockers: ["ims_metric_missing"]
      });
    } finally {
      if (original == null) {
        delete process.env.IMS_API_TOKEN;
      } else {
        process.env.IMS_API_TOKEN = original;
      }
    }
  });

  it("blocks safely when no IMS token is configured for live fetch", async () => {
    const original = process.env.IMS_API_TOKEN;
    delete process.env.IMS_API_TOKEN;

    try {
      const inspection = await IMS_WEATHER_SOURCE_ADAPTER.inspectResolution(context(), {
        now: new Date("2026-05-13T06:00:00.000Z")
      });

      expect(inspection).toMatchObject({
        status: "unknown",
        resolutionAvailable: false,
        blockers: ["missing_ims_api_token"]
      });
    } finally {
      if (original == null) {
        delete process.env.IMS_API_TOKEN;
      } else {
        process.env.IMS_API_TOKEN = original;
      }
    }
  });
});
