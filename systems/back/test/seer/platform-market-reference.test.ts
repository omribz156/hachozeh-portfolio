import { describe, expect, it } from "vitest";

import {
  parseKalshiShapeSnapshot,
  parsePolymarketShapeSnapshot,
  toPlatformReferenceSignals
} from "../../../seer/src/platform-market-reference";

describe("platform market reference", () => {
  it("parses Polymarket market examples into inferred shape references", () => {
    const snapshot = parsePolymarketShapeSnapshot(
      JSON.stringify([
        {
          id: "poly_1",
          question: "Will Iran conduct a military action against Israel on April 10, 2026?",
          endDate: "2026-04-10T23:59:00Z",
          category: "Politics",
          volume: "12345",
          liquidity: "98765",
          slug: "iran-action-april-10"
        },
        {
          id: "poly_2",
          question: "What will WTI Crude Oil (WTI) hit in April 2026?",
          endDate: "2026-04-30T23:59:00Z",
          category: "Economy",
          volume: "333",
          liquidity: "444",
          slug: "wti-april-2026"
        },
        {
          id: "poly_3",
          question: "Russia-Ukraine Ceasefire before GTA VI?",
          endDate: "2026-07-31T12:00:00Z",
          slug: "ukraine-ceasefire-before-gta"
        }
      ]),
      "2026-04-08T15:00:00.000Z"
    );

    expect(snapshot.platform).toBe("polymarket");
    expect(snapshot.examples.map((example) => example.marketForm)).toEqual(["binary", "range", "binary"]);
    expect(snapshot.examples.map((example) => example.familyHint)).toEqual([
      "geopolitics/security",
      "markets/commodities",
      "geopolitics/security"
    ]);
  });

  it("parses Kalshi public market/event data into shape references", () => {
    const snapshot = parseKalshiShapeSnapshot(
      JSON.stringify({
        markets: [
          {
            ticker: "KXTEST-YESNO",
            title: "Will the Fed cut rates by June 2026?",
            subtitle: "Yes/No",
            close_time: "2026-06-17T18:00:00Z",
            volume: 1000,
            open_interest: 500
          },
          {
            ticker: "KXMVECROSSCATEGORY-TEST",
            title: "yes Dortmund,yes Over 1.5 goals scored,yes Real Madrid,yes Over 5.5 runs scored",
            subtitle: "Combo",
            close_time: "2026-06-17T18:00:00Z",
            volume: 200,
            open_interest: 50
          }
        ]
      }),
      JSON.stringify({
        events: [
          {
            event_ticker: "KXPOPE-70",
            title: "Who will the next Pope be?",
            category: "World",
            sub_title: "Before 2070"
          }
        ]
      }),
      "2026-04-08T15:00:00.000Z"
    );

    expect(snapshot.platform).toBe("kalshi");
    expect(snapshot.examples.map((example) => example.marketForm)).toEqual(["multi-outcome", "binary"]);
    expect(snapshot.examples.map((example) => example.referenceLane)).toEqual(["reference-shapes", "reference-shapes"]);
    expect(snapshot.examples.map((example) => example.contractPattern)).toEqual([
      "multi-market-event",
      "recurring-template"
    ]);
    expect(snapshot.examples.map((example) => example.familyHint)).toEqual(["election/winner", "macro/rates"]);
    expect(snapshot.examples.some((example) => example.title.includes("yes Dortmund"))).toBe(false);
    expect(snapshot.notes).toContain("Kalshi combo/MVE markets are intentionally filtered from the default craft sample.");
  });

  it("can derive reference-only manual signals from shape snapshots", () => {
    const snapshot = parsePolymarketShapeSnapshot(
      JSON.stringify([
        {
          id: "poly_3",
          question: "Will MrBeast's latest video get between 66 and 67 million views on day 4?",
          category: "Entertainment",
          slug: "mrbeast-views-day-4"
        }
      ]),
      "2026-04-08T15:00:00.000Z"
    );

    const signals = toPlatformReferenceSignals(snapshot);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.sourceId).toBe("src_polymarket_market_reference");
    expect(signals[0]?.marketForm).toBe("threshold");
    expect(signals[0]?.tags).toContain("reference-shape");
    expect(signals[0]?.tags).toContain("standard-contract");
    expect(signals[0]?.tags).toContain("culture/attention");
    expect(signals[0]?.notes).toContain("Reference lane: reference-shapes");
  });
});
