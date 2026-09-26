import { describe, expect, it } from "vitest";

import type { SeerMarketCreationDraft } from "../../src/lifecycle/management/seer-market-creation-service";
import { buildEmbeddedWatchPlanInput } from "../../src/market-watch/publish-bundle";

describe("embedded market-watch publish bundle", () => {
  it("targets the materialized event and selects the first future run", () => {
    const draft = {
      candidateMarketId: "show-winner-a",
      eventId: "evt-show-winner",
      watchPlan: {
        id: "show_watch",
        target: "event",
        checkerKind: "show_official_keywords",
        enabled: true,
        timezone: "Asia/Jerusalem",
        sourceUrls: ["https://example.com/show"],
        entities: ["זוג א"],
        keywords: ["הודח"],
        runAt: [
          "2026-07-15T20:45:00.000Z",
          "2026-07-20T20:45:00.000Z"
        ],
        intervalMinutes: null,
        nextRunAt: null,
        proximityChars: 180,
        note: "Official episode watch."
      }
    } as SeerMarketCreationDraft;

    expect(buildEmbeddedWatchPlanInput(draft, Date.parse("2026-07-16T00:00:00.000Z"))).toMatchObject({
      id: "show_watch",
      eventId: "evt-show-winner",
      marketId: null,
      nextRunAt: "2026-07-20T20:45:00.000Z",
      runPolicy: {
        proximityChars: 180
      }
    });
  });

  it("refuses to publish a bundled watch plan with no future schedule", () => {
    const draft = {
      candidateMarketId: "show-winner-a",
      eventId: "evt-show-winner",
      watchPlan: {
        id: "expired_watch",
        target: "event",
        checkerKind: "show_official_keywords",
        enabled: true,
        timezone: "Asia/Jerusalem",
        sourceUrls: ["https://example.com/show"],
        entities: ["זוג א"],
        keywords: ["הודח"],
        runAt: ["2026-07-15T20:45:00.000Z"],
        intervalMinutes: null,
        nextRunAt: null,
        proximityChars: null,
        note: null
      }
    } as SeerMarketCreationDraft;

    expect(() => buildEmbeddedWatchPlanInput(
      draft,
      Date.parse("2026-07-16T00:00:00.000Z")
    )).toThrow("no future schedule");
  });

  it("binds a market watch to the actual versioned materialization target", () => {
    const draft = {
      candidateMarketId: "show-winner-a",
      watchPlan: {
        id: "show_market_watch",
        target: "market",
        checkerKind: "show_official_keywords",
        enabled: true,
        timezone: "Asia/Jerusalem",
        sourceUrls: ["https://example.com/show"],
        entities: ["זוג א"],
        keywords: ["הודח"],
        runAt: ["2026-07-20T20:45:00.000Z"],
        intervalMinutes: null,
        nextRunAt: null,
        proximityChars: null,
        note: null
      }
    } as SeerMarketCreationDraft;

    expect(buildEmbeddedWatchPlanInput(
      draft,
      Date.parse("2026-07-16T00:00:00.000Z"),
      { marketId: "disc-cm-show-winner-a-v2" }
    )).toMatchObject({
      eventId: null,
      marketId: "disc-cm-show-winner-a-v2"
    });
  });
});
