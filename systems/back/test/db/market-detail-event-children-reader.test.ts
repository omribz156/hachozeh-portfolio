import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  readMarketDetailEventChildren,
  readMarketDetailEventChildrenCacheFingerprint
} from "../../src/db/read-models/market-detail/event-children-reader";

function createPool(options?: { childCount?: number }) {
  const childCount = options?.childCount ?? 2;
  const sharedMarketContract = {
    resolutionSource: {
      label: "אתר הכנסת הרשמי",
      url: "https://main.knesset.gov.il/"
    }
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("select event_id") && sql.includes("from markets")) {
      return {
        rowCount: 1,
        rows: [{ event_id: "event-iran-deadline" }]
      };
    }

    if (sql.includes("count(distinct m.id)::text")) {
      return {
        rowCount: 1,
        rows: [
          {
            child_count: String(childCount),
            max_state_version: "12",
            max_updated_at: new Date("2026-06-04T08:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from events e")) {
      return {
        rowCount: childCount * 2,
        rows: (
          childCount <= 1
            ? [
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-june-30",
                  market_status: "open",
                  event_child_label: "30 ביוני",
                  title: "הסכם איראן עד 30 ביוני?",
                  close_at: new Date("2026-06-30T20:59:00.000Z"),
                  outcome_id: "child-june-30-yes",
                  outcome_label: "כן",
                  outcome_short_label: "כן",
                  sort_order: 0,
                  last_price: "0.68000000",
                  winning_outcome_id: null
                },
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-june-30",
                  market_status: "open",
                  event_child_label: "30 ביוני",
                  title: "הסכם איראן עד 30 ביוני?",
                  close_at: new Date("2026-06-30T20:59:00.000Z"),
                  outcome_id: "child-june-30-no",
                  outcome_label: "לא",
                  outcome_short_label: "לא",
                  sort_order: 1,
                  last_price: "0.32000000",
                  winning_outcome_id: null
                }
              ]
            : [
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-june-30",
                  market_status: "open",
                  event_child_label: "30 ביוני",
                  title: "הסכם איראן עד 30 ביוני?",
                  close_at: new Date("2026-06-30T20:59:00.000Z"),
                  outcome_id: "child-june-30-yes",
                  outcome_label: "כן",
                  outcome_short_label: "כן",
                  sort_order: 0,
                  last_price: "0.68000000",
                  winning_outcome_id: null
                },
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-june-30",
                  market_status: "open",
                  event_child_label: "30 ביוני",
                  title: "הסכם איראן עד 30 ביוני?",
                  close_at: new Date("2026-06-30T20:59:00.000Z"),
                  outcome_id: "child-june-30-no",
                  outcome_label: "לא",
                  outcome_short_label: "לא",
                  sort_order: 1,
                  last_price: "0.32000000",
                  winning_outcome_id: null
                },
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-may-31",
                  market_status: "resolved",
                  event_child_label: "31 במאי",
                  title: "הסכם איראן עד 31 במאי?",
                  close_at: new Date("2026-05-31T20:59:00.000Z"),
                  outcome_id: "child-may-31-yes",
                  outcome_label: "כן",
                  outcome_short_label: "כן",
                  sort_order: 0,
                  last_price: "0.00000000",
                  winning_outcome_id: "child-may-31-no"
                },
                {
                  event_id: "event-iran-deadline",
                  event_title: "הסכם איראן עד תאריך?",
                  event_description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
                  event_icon: null,
                  event_status: "active",
                  resolution_policy: "independent_children",
                  event_display_flags: {},
                  market_id: "child-may-31",
                  market_status: "resolved",
                  event_child_label: "31 במאי",
                  title: "הסכם איראן עד 31 במאי?",
                  close_at: new Date("2026-05-31T20:59:00.000Z"),
                  outcome_id: "child-may-31-no",
                  outcome_label: "לא",
                  outcome_short_label: "לא",
                  sort_order: 1,
                  last_price: "1.00000000",
                  winning_outcome_id: "child-may-31-no"
                }
              ]
        ).map((row) => ({
          ...row,
          market_contract: sharedMarketContract
        }))
      };
    }

    if (sql.includes("from trades")) {
      return {
        rowCount: 2,
        rows: [
          { market_id: "child-june-30", volume_amount: "1200.000000" },
          { market_id: "child-may-31", volume_amount: "300.000000" }
        ]
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as unknown as Pool;
}

describe("readMarketDetailEventChildren", () => {
  it("returns multi-child event summary and ordered child rows", async () => {
    const payload = await readMarketDetailEventChildren(createPool(), "child-june-30");

    expect(payload?.event).toEqual({
      id: "event-iran-deadline",
      title: "הסכם איראן עד תאריך?",
      description: "אירוע שמרכז שוקי דדליין להסכם איראן.",
      icon: null,
      status: "active",
      resolutionPolicy: "independent_children",
      rulesLead: "אירוע שמרכז שוקי דדליין להסכם איראן.",
      delayPolicy: "כל שוק בתוך האירוע מוכרע בנפרד לפי הכללים והמקורות שלו. האירוע כולו נשאר פעיל עד שכל השווקים נסגרים ונפתרים.",
      resolutionSource: {
        label: "אתר הכנסת הרשמי",
        url: "https://main.knesset.gov.il/"
      },
      showGraph: false,
      childCount: 2,
      volumeLabel: "V₪ 1.5K"
    });
    expect(payload?.children).toEqual([
      expect.objectContaining({
        marketId: "child-june-30",
        label: "30 ביוני",
        status: "open",
        canonicalProbability: 0.68,
        winner: null,
        volumeLabel: "V₪ 1.2K",
        viewerPosition: null
      }),
      expect.objectContaining({
        marketId: "child-may-31",
        label: "31 במאי",
        status: "resolved",
        canonicalProbability: 0,
        winner: "no",
        volumeLabel: "V₪ 300",
        viewerPosition: null
      })
    ]);
  });

  it("returns no event-mode payload for single-child events", async () => {
    await expect(
      readMarketDetailEventChildren(createPool({ childCount: 1 }), "child-june-30")
    ).resolves.toBeNull();
  });

  it("returns a cache fingerprint only for multi-child events", async () => {
    await expect(
      readMarketDetailEventChildrenCacheFingerprint(createPool(), "event-iran-deadline")
    ).resolves.toContain("event-iran-deadline:2:12");
    await expect(
      readMarketDetailEventChildrenCacheFingerprint(
        createPool({ childCount: 1 }),
        "event-iran-deadline"
      )
    ).resolves.toBeNull();
  });
});
