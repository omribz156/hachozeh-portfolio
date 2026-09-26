import { describe, expect, it } from "vitest";

import {
  CBS_TIME_SERIES_SOURCE_ADAPTER,
  extractCbsTimeSeriesSpec,
  pickCbsMonthlyValue
} from "../../../../oracle/src/adapters/cbs-time-series-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CLOSING_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-israel-cpi-june-2026",
  marketTitle: "שיעור השינוי החודשי במדד המחירים לצרכן ביוני",
  marketStatus: "closed",
  closeAt: "2026-07-15T16:29:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: false,
  resolutionSource: "https://www.cbs.gov.il/en/Pages/Main%20Price%20Indices.aspx",
  resolutionRules:
    "השוק מודד את שיעור השינוי החודשי הרשמי במדד המחירים לצרכן של יוני 2026, כפי שיפורסם על ידי הלמ״ס.",
  oracleSourcePolicy: {
    preferredSourceIds: ["src_cbs_time_series"],
    resolutionSourceIds: ["src_cbs_time_series"]
  },
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "official_value",
    resultShape: "multi_outcome",
    oracleCapability: "supported_final_only",
    trustDisplayUrl: "https://www.cbs.gov.il/en/Pages/Main%20Price%20Indices.aspx",
    machineResolutionEndpoint: "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false",
    resolutionSource: {
      url: "https://www.cbs.gov.il/en/Pages/Main%20Price%20Indices.aspx",
      sourceIds: ["src_cbs_time_series"]
    },
    outcomeMap: [
      { outcomeLabel: "0.1%-0.2%", evidenceKey: "range-0.1-0.2" },
      { outcomeLabel: "0.3%-0.4%", evidenceKey: "range-0.3-0.4" },
      { outcomeLabel: "0.7% ומעלה", evidenceKey: "above-0.7" }
    ]
  },
  outcomes: [
    { outcomeId: "range-1", outcomeKey: "range-1", label: "0.1%-0.2%" },
    { outcomeId: "range-2", outcomeKey: "range-2", label: "0.3%-0.4%" },
    { outcomeId: "above", outcomeKey: "above", label: "0.7% ומעלה" }
  ]
};

const CLOSING_CONTEXT_RESTRICTED: OracleLifecycleSourceContext = {
  ...CLOSING_CONTEXT,
  closeAt: "2026-07-15T17:00:00.000Z",
  marketContract: {
    ...CLOSING_CONTEXT.marketContract!,
    machineResolutionEndpoint: "https://api.cbs.gov.il/index/data/price_selected?TimePeriod=2026-06&format=xml&download=false"
  }
};

const CBS_MONTHLY_PAYLOAD = {
  status: "ok",
  value: [
    {
      period: "2026-05",
      monthly_change: "0.12"
    },
    {
      period: "2026-06",
      monthly_change: "0.33"
    }
  ],
  metadata: {
    source: "CBS CPI",
    observations: {
      lastUpdated: "2026-07-16T10:00:00.000Z"
    }
  }
};

const CLOSING_MONTHLY_PAYLOAD = `\
<indices UpdateDate="2026-07-16">\
  <date year="2026" month="מאי">\
    <code code="120010"><name>מדד המחירים לצרכן - כללי</name><percent>0.12</percent></code>\
    <code code="999999"><name>מדד אחר</name><percent>9.99</percent></code>\
  </date>\
  <date year="2026" month="יוני">\
    <code code="120010"><name>מדד המחירים לצרכן - כללי</name><percent>0.33</percent></code>\
  </date>\
</indices>`;

describe("CBS time-series source adapter", () => {
  it("extracts no target period from the static CBS CPI machine endpoint", () => {
    expect(extractCbsTimeSeriesSpec(CLOSING_CONTEXT)).toMatchObject({
      machineResolutionEndpoint: "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false",
      targetPeriod: null,
      seriesCode: "120010"
    });
  });

  it("extracts an explicit series code from case-insensitive query keys", () => {
    expect(
      extractCbsTimeSeriesSpec({
        ...CLOSING_CONTEXT,
        marketContract: {
          ...CLOSING_CONTEXT.marketContract,
          machineResolutionEndpoint:
            "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false&CoDe=543210"
        }
      })
    ).toMatchObject({
      seriesCode: "543210"
    });
  });

  it("extracts an exact period from case-insensitive machine endpoint keys", () => {
    expect(extractCbsTimeSeriesSpec(CLOSING_CONTEXT_RESTRICTED)).toMatchObject({
      targetPeriod: "2026-06-01",
      seriesCode: "120010"
    });
  });

  it("picks the latest parseable value when no explicit target period is supplied", () => {
    expect(pickCbsMonthlyValue(CBS_MONTHLY_PAYLOAD, CLOSING_CONTEXT)).toBe(0.33);
  });

  it("maps a matched monthly CPI value into a configured outcome bucket", async () => {
    const inspection = await CBS_TIME_SERIES_SOURCE_ADAPTER.inspectResolution(CLOSING_CONTEXT, {
      now: new Date("2026-07-16T10:05:00.000Z"),
      fetchText: async () => CLOSING_MONTHLY_PAYLOAD
    });

    expect(inspection).toMatchObject({
      sourceFamily: "cbs_time_series",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "range-0.3-0.4",
      winnerLabel: "0.3%-0.4%",
      blockers: []
    });
  });

  it("treats CPI lower and upper boundary buckets as inclusive when copy says so", async () => {
    const boundaryContext: OracleLifecycleSourceContext = {
      ...CLOSING_CONTEXT_RESTRICTED,
      marketContract: {
        ...CLOSING_CONTEXT_RESTRICTED.marketContract!,
        outcomeMap: [
          {
            outcomeLabel: "חוסר שינוי או ירידה",
            evidenceKey: "at-most-0",
            resolutionPath: "זוכה אם שיעור השינוי הרשמי הוא עד 0.0%."
          },
          {
            outcomeLabel: "0.1%-0.2%",
            evidenceKey: "range-0.1-0.2"
          },
          {
            outcomeLabel: "0.7% ומעלה",
            evidenceKey: "above-0.7"
          }
        ]
      },
      outcomes: [
        { outcomeId: "flat-or-down", outcomeKey: "flat-or-down", label: "חוסר שינוי או ירידה" },
        { outcomeId: "range-1", outcomeKey: "range-1", label: "0.1%-0.2%" },
        { outcomeId: "above", outcomeKey: "above", label: "0.7% ומעלה" }
      ]
    };

    const flatInspection = await CBS_TIME_SERIES_SOURCE_ADAPTER.inspectResolution(boundaryContext, {
      now: new Date("2026-07-16T10:05:00.000Z"),
      fetchText: async () => `\
<indices UpdateDate="2026-07-16">\
  <date year="2026" month="יוני">\
    <code code="120010"><name>מדד המחירים לצרכן - כללי</name><percent>0.0</percent></code>\
  </date>\
</indices>`
    });

    expect(flatInspection).toMatchObject({
      resolutionAvailable: true,
      evidenceKey: "at-most-0",
      winnerLabel: "חוסר שינוי או ירידה",
      blockers: []
    });

    const upperInspection = await CBS_TIME_SERIES_SOURCE_ADAPTER.inspectResolution(boundaryContext, {
      now: new Date("2026-07-16T10:05:00.000Z"),
      fetchText: async () => `\
<indices UpdateDate="2026-07-16">\
  <date year="2026" month="יוני">\
    <code code="120010"><name>מדד המחירים לצרכן - כללי</name><percent>0.7</percent></code>\
  </date>\
</indices>`
    });

    expect(upperInspection).toMatchObject({
      resolutionAvailable: true,
      evidenceKey: "above-0.7",
      winnerLabel: "0.7% ומעלה",
      blockers: []
    });
  });

  it("does not resolve a target month from an earlier published CPI month", async () => {
    const inspection = await CBS_TIME_SERIES_SOURCE_ADAPTER.inspectResolution(CLOSING_CONTEXT_RESTRICTED, {
      now: new Date("2026-07-16T10:05:00.000Z"),
      fetchText: async () => `\
<indices UpdateDate="2026-07-16">\
  <date year="2026" month="מאי">\
    <code code="120010"><name>מדד המחירים לצרכן - כללי</name><percent>-0.3</percent></code>\
  </date>\
</indices>`
    });

    expect(inspection).toMatchObject({
      sourceFamily: "cbs_time_series",
      status: "not_started",
      resolutionAvailable: false,
      blockers: ["cbs_value_missing"]
    });
  });

  it("blocks when CBS payload exposes no parseable value", async () => {
    const inspection = await CBS_TIME_SERIES_SOURCE_ADAPTER.inspectResolution(CLOSING_CONTEXT, {
      now: new Date("2026-07-16T10:05:00.000Z"),
      fetchText: async () => "<indices></indices>"
    });

    expect(inspection).toMatchObject({
      sourceFamily: "cbs_time_series",
      status: "not_started",
      resolutionAvailable: false,
      blockers: ["cbs_value_missing"]
    });
  });
});
