import { describe, expect, it } from "vitest";

import { buildSourceFamilyRequestsFromReadiness } from "../../../seer/src/source-family-requests";
import type { MarketCreationReadinessItem } from "../../../seer/src/creation-drafts";

function readinessItem(
  overrides: Partial<MarketCreationReadinessItem>
): MarketCreationReadinessItem {
  return {
    candidateMarketId: "cm_weather_tlv_30c",
    reviewItemId: "rh_weather_tlv_30c",
    question: "האם הטמפרטורה המקסימלית בתל אביב תגיע היום ל-30 מעלות?",
    category: "weather",
    latestAction: "approve",
    blockers: ["missing-oracle-capability"],
    fetchNeeds: [],
    reviewedAt: "2026-05-11T10:00:00.000Z",
    contract: {
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      measurement: "הטמפרטורה המקסימלית בתל אביב",
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      resolutionAuthorityType: "official",
      resolutionSource: {
        label: "השירות המטאורולוגי הישראלי",
        url: "https://ims.gov.il/en/data_gov",
        sourceIds: ["src_ims_daily_observations"]
      },
      resolutionRule: "השוק מוכרע לפי ערך TDmax הרשמי בתחנת תל אביב.",
      timeline: {
        closeShape: "Close before the measured day starts.",
        closeAt: "2026-05-11T21:00:00.000Z",
        timezone: "UTC"
      },
      outcomeMap: [
        {
          outcomeLabel: "כן",
          outcomeKind: "binary-side",
          resolutionPath: "Wins if TDmax is at least 30.",
          evidenceKey: "yes"
        },
        {
          outcomeLabel: "לא",
          outcomeKind: "binary-side",
          resolutionPath: "Wins if TDmax is below 30.",
          evidenceKey: "no"
        }
      ],
      delayPolicy: "אם הנתון מתעכב, השוק ממתין לפרסום הרשמי.",
      payoutPolicy: "התשלום מתבצע רק לאחר פרסום תוצאה רשמית ואישור מפעיל.",
      reviewBlockers: []
    },
    ...overrides
  };
}

describe("source family requests", () => {
  it("groups missing Oracle capability into one operator-visible adapter request", () => {
    const requests = buildSourceFamilyRequestsFromReadiness(
      [
        readinessItem({
          candidateMarketId: "cm_weather_tlv_30c"
        }),
        readinessItem({
          candidateMarketId: "cm_weather_haifa_30c",
          question: "האם הטמפרטורה המקסימלית בחיפה תגיע היום ל-30 מעלות?"
        })
      ],
      "2026-05-11T12:00:00.000Z"
    );

    expect(requests).toEqual([
      expect.objectContaining({
        objectType: "source_family_request",
        requestId: "sfr_src_ims_daily_observations_threshold_crossing_yes_no",
        sourceId: "src_ims_daily_observations",
        sourceLabel: "השירות המטאורולוגי הישראלי",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no",
        status: "adapter_needed",
        requestedByCandidateMarketIds: ["cm_weather_tlv_30c", "cm_weather_haifa_30c"],
        operatorNextAction: "run_oracle_capability_check"
      })
    ]);
  });

  it("does not request adapters for quarantined external market references", () => {
    const requests = buildSourceFamilyRequestsFromReadiness(
      [
        readinessItem({
          blockers: ["reference-only-resolution-source", "missing-oracle-capability"],
          contract: {
            ...readinessItem({}).contract!,
            resolutionSource: {
              label: "Polymarket reference",
              url: "https://polymarket.com/event/example",
              sourceIds: ["src_polymarket_market_reference"]
            }
          }
        })
      ],
      "2026-05-11T12:00:00.000Z"
    );

    expect(requests).toEqual([]);
  });

  it("keeps known manual families out of the default adapter-pressure list", () => {
    expect(
      buildSourceFamilyRequestsFromReadiness(
        [
          readinessItem({
            blockers: [],
            contract: {
              ...readinessItem({}).contract!,
              oracleCapability: "manual_resolution_required"
            }
          })
        ],
        "2026-05-11T12:00:00.000Z"
      )
    ).toEqual([]);

    expect(
      buildSourceFamilyRequestsFromReadiness(
        [
          readinessItem({
            blockers: [],
            contract: {
              ...readinessItem({}).contract!,
              oracleCapability: "manual_resolution_required"
            }
          })
        ],
        "2026-05-11T12:00:00.000Z",
        {
          includeManual: true
        }
      )
    ).toHaveLength(1);
  });

  it("carries market-family context into adapter handoff requests", () => {
    const requests = buildSourceFamilyRequestsFromReadiness(
      [
        readinessItem({
          blockers: ["market-family-adapter-needed"],
          familyClassification: {
            objectType: "market_family_classification",
            status: "adapter_needed",
            familyKey: "economy.fx-threshold",
            familyLabelHe: "שער יציג מול סף",
            category: "economy",
            measurementKind: "threshold_crossing",
            resultShape: "yes_no",
            matchedSourceIds: ["src_boi_exchange_rates"],
            operatorNextAction: "build_oracle_adapter",
            confidence: "high",
            reasons: ["source-family-match"],
            blockers: ["adapter-capability-missing"]
          },
          contract: {
            ...readinessItem({}).contract!,
            resolutionSource: {
              label: "שערים יציגים - בנק ישראל",
              url: "https://www.boi.org.il/en/economic-roles/financial-markets/exchange-rates/",
              sourceIds: ["src_boi_exchange_rates"]
            }
          }
        })
      ],
      "2026-05-11T12:00:00.000Z"
    );

    expect(requests).toEqual([
      expect.objectContaining({
        sourceId: "src_boi_exchange_rates",
        status: "adapter_needed",
        marketFamilyKey: "economy.fx-threshold",
        marketFamilyLabelHe: "שער יציג מול סף",
        marketFamilyClassificationStatus: "adapter_needed",
        notes: expect.arrayContaining(["market-family=economy.fx-threshold"])
      })
    ]);
  });
});
