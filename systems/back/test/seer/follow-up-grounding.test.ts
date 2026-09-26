import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManualSeerSignal } from "../../../seer/src/contracts";
import { buildSignalFollowUpNotes } from "../../../seer/src/follow-up-grounding";
import { enrichSignal } from "../../../seer/src/signal-enrichment";

function trendingSportsSignal(): ManualSeerSignal {
  return {
    objectType: "manual_seer_signal",
    signalId: "msig_google_trending_il_chelsea_v_city",
    sourceId: "src_google_trending_il",
    title: "chelsea vs man city",
    summary: 'Google Trends IL shows "chelsea vs man city" as an active trend.',
    category: "general",
    whyNow: '"chelsea vs man city" is trending in Israel right now.',
    observedAt: "2026-04-12T13:40:00.000Z",
    importedAt: "2026-04-12T13:41:00.000Z",
    sourceRef: "https://trends.google.com/trending?geo=IL#chelsea-vs-man-city",
    sourceLabel: "Google Trending IL",
    notes: ["BBC: Chelsea vs Manchester City: preview | https://www.bbc.com/sport/football/live/cwyxndndp4pt"],
    tags: ["google-trending"]
  };
}

describe("signal follow-up grounding", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("extracts structured event date and competition from fetched coverage pages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T16:00:00.000Z"));

    const signal = trendingSportsSignal();
    const enrichment = enrichSignal({
      sourceId: signal.sourceId,
      sourceClass: "attention",
      category: signal.category,
      title: signal.title,
      summary: signal.summary,
      whyNow: signal.whyNow,
      observedAt: signal.observedAt,
      keyEntities: signal.keyEntities,
      notes: signal.notes,
      tags: signal.tags
    });

    const mockFetch: typeof fetch = async () =>
      new Response(
        `
          <html>
            <head>
              <meta property="og:title" content="Chelsea vs Manchester City preview: Premier League team news">
              <script type="application/ld+json">
                {"@type":"SportsEvent","startDate":"2026-04-12T15:30:00Z"}
              </script>
            </head>
          </html>
        `,
        { status: 200 }
      );

    const notes = await buildSignalFollowUpNotes(signal, enrichment, mockFetch);

    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("followup-title: Chelsea vs Manchester City preview: Premier League team news"),
        "followup-competition=Premier League | https://www.bbc.com/sport/football/live/cwyxndndp4pt",
        "followup-event-date=2026-04-12 | https://www.bbc.com/sport/football/live/cwyxndndp4pt"
      ])
    );
  });

  it("skips oversized coverage pages instead of reading unbounded HTML", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T16:00:00.000Z"));

    const signal = trendingSportsSignal();
    const enrichment = enrichSignal({
      sourceId: signal.sourceId,
      sourceClass: "attention",
      category: signal.category,
      title: signal.title,
      summary: signal.summary,
      whyNow: signal.whyNow,
      observedAt: signal.observedAt,
      keyEntities: signal.keyEntities,
      notes: signal.notes,
      tags: signal.tags
    });

    const mockFetch: typeof fetch = async () =>
      new Response("x".repeat(300 * 1024), {
        status: 200
      });

    await expect(buildSignalFollowUpNotes(signal, enrichment, mockFetch)).resolves.toEqual([]);
  });
});
