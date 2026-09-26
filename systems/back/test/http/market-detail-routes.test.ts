import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

const PASSIVE_OUTCOMES = [
  ["market_seed_next_prime_minister_outcome_option_a", "מועמד א'", "מועמד א'"],
  ["market_seed_next_prime_minister_outcome_option_b", "מועמד ב'", "מועמד ב'"],
  ["market_seed_next_prime_minister_outcome_option_c", "מועמד ג'", null],
  ["market_seed_next_prime_minister_outcome_option_d", "מועמד ד'", "מועמד ד'"]
] as const;

function buildPassiveRows(options: {
  marketStatus: "closed" | "resolved";
  persistedStatus?: "open" | "closed" | "resolved";
  version: string;
  updatedAt: Date;
  prices: string[];
  resolution?: Record<string, unknown>;
}) {
  return PASSIVE_OUTCOMES.map(([outcomeId, label, shortLabel], index) => ({
    market_id: "market_seed_next_prime_minister",
    market_status: options.marketStatus,
    persisted_status: options.persistedStatus ?? options.marketStatus,
    title: "מי יהיה ראש הממשלה הבא?",
    description: "שוק backend",
    category_key: "politics",
    market_family_key: null,
    open_at: new Date("2026-03-01T08:00:00.000Z"),
    close_at: new Date("2026-06-22T18:00:00.000Z"),
    published_at: new Date("2026-03-01T09:00:00.000Z"),
    market_state_version: options.version,
    updated_at: options.updatedAt,
    outcome_id: outcomeId,
    short_label: shortLabel,
    label,
    sort_order: index,
    last_price: options.prices[index],
    ...options.resolution
  }));
}

function createPassiveDetailQuery(rows: Array<Record<string, unknown>>) {
  return async (sql: string, values?: unknown[]) => {
    if (sql.includes("select event_id") && sql.includes("from markets")) {
      expect(values).toEqual(["market_seed_next_prime_minister"]);

      return {
        rowCount: 1,
        rows: [{ event_id: null }]
      };
    }

    if (sql.includes("where market_family_key =")) {
      return {
        rowCount: 0,
        rows: []
      };
    }

    if (sql.includes("from trades")) {
      return {
        rowCount: 0,
        rows: []
      };
    }

    if (sql.includes("from lifecycle_events") && !sql.includes("from markets m")) {
      return {
        rowCount: 0,
        rows: []
      };
    }

    if (sql.includes("from markets m")) {
      expect(values).toEqual(["market_seed_next_prime_minister"]);

      return {
        rowCount: rows.length,
        rows
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected db query in app test: ${sql}`);
  };
}

describe("market-detail routes", () => {
  it("returns db-backed passive market detail with lifecycle status and explicit outcomes", async () => {
    const rows = buildPassiveRows({
      marketStatus: "closed",
      persistedStatus: "open",
      version: "12",
      updatedAt: new Date("2026-03-29T09:00:00.000Z"),
      prices: ["0.25000000", "0.25000000", "0.25000000", "0.25000000"]
    });
    const { baseUrl } = await startServer({
      queryImpl: createPassiveDetailQuery(rows)
    });

    const response = await fetch(`${baseUrl}/api/market-detail/markets/next-prime-minister`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=10, stale-while-revalidate=60"
    );
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=60"
    );
    expect(payload.snapshot.marketStatus).toBe("closed");
    expect(payload.snapshot.tradingMode).toBe("contract_side");
    expect(payload.snapshot.lifecycle).toMatchObject({
      openAt: "2026-03-01T08:00:00.000Z",
      closeAt: "2026-06-22T18:00:00.000Z",
      expectedResolutionAt: null,
      publishedAt: "2026-03-01T09:00:00.000Z",
      updatedAt: "2026-03-29T09:00:00.000Z",
      persistedStatus: "open",
      effectiveStatus: "closed",
      settlementStatus: null,
      payoutPolicy: {
        kind: "after_official_resolution_settlement"
      }
    });
    expect(payload.snapshot.outcomes).toEqual([
      {
        id: "option-a",
        key: "option-a",
        label: "מועמד א'",
        shortLabel: "מועמד א'"
      },
      {
        id: "option-b",
        key: "option-b",
        label: "מועמד ב'",
        shortLabel: "מועמד ב'"
      },
      {
        id: "option-c",
        key: "option-c",
        label: "מועמד ג'",
        shortLabel: "מועמד ג'"
      },
      {
        id: "option-d",
        key: "option-d",
        label: "מועמד ד'",
        shortLabel: "מועמד ד'"
      }
    ]);
    expect(payload.context.marketLabel).toBe("מי יהיה ראש הממשלה הבא?");
  });

  it("returns resolution trust summary for resolved market detail", async () => {
    const rows = buildPassiveRows({
      marketStatus: "resolved",
      version: "14",
      updatedAt: new Date("2026-06-22T18:10:00.000Z"),
      prices: ["1.00000000", "0.00000000", "0.00000000", "0.00000000"],
      resolution: {
        market_contract: {
          objectType: "market_contract_v1",
          version: "seer-contract-v1",
          timeline: {
            expectedResolutionAt: "2026-06-22T18:30:00.000Z"
          },
          payoutPolicy: {
            kind: "after_resolution",
            label: "לאחר הכרעה רשמית"
          }
        },
        resolution_source: "official_election_result",
        resolution_rules: "Resolves to the official final coalition mandate notice.",
        oracle_source_policy: {
          contextSourceIds: ["src_market_launch_wire"],
          resolutionSourceIds: ["src_gov_il_news"],
          requiresHumanReviewOnSourceConflict: true,
          notes: [
            "wake-role=Coalition talks",
            "ground-role=Government notice",
            "resolve-role=Official coalition mandate notice"
          ]
        },
        settlement_status: "completed",
        market_resolved_at: new Date("2026-06-22T18:09:30.000Z"),
        winning_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
        winning_outcome_label: "מועמד א'",
        resolution_source_url: "https://example.com/final-result",
        resolution_note: "המקור הרשמי אישר את התוצאה הסופית.",
        resolution_resolved_at: new Date("2026-06-22T18:09:00.000Z")
      }
    });
    const { baseUrl } = await startServer({
      queryImpl: createPassiveDetailQuery(rows)
    });

    const response = await fetch(`${baseUrl}/api/market-detail/markets/next-prime-minister`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.snapshot.marketStatus).toBe("resolved");
    expect(payload.snapshot.resolution).toEqual({
      winningOutcomeKey: "option-a",
      winningOutcomeLabel: "מועמד א'",
      sourceUrl: "https://example.com/final-result",
      explanation: "המקור הרשמי אישר את התוצאה הסופית.",
      resolvedAtLabel: "22 ביוני 2026 · 21:09"
    });
    expect(payload.snapshot.result).toMatchObject({
      status: "resolved",
      settlementStatus: "completed",
      resolvedAt: "2026-06-22T18:09:30.000Z",
      winner: {
        outcomeId: "market_seed_next_prime_minister_outcome_option_a",
        outcomeKey: "option-a",
        label: "מועמד א'"
      },
      source: {
        url: "https://example.com/final-result",
        explanation: "המקור הרשמי אישר את התוצאה הסופית."
      }
    });
    expect(payload.snapshot.lifecycle).toMatchObject({
      expectedResolutionAt: "2026-06-22T18:30:00.000Z",
      resolvedAt: "2026-06-22T18:09:30.000Z",
      persistedStatus: "resolved",
      effectiveStatus: "resolved",
      settlementStatus: "completed",
      payoutPolicy: {
        kind: "after_resolution",
        label: "לאחר הכרעה רשמית"
      }
    });
    expect(payload.snapshot.winner).toEqual({
      outcomeId: "market_seed_next_prime_minister_outcome_option_a",
      outcomeKey: "option-a",
      label: "מועמד א'"
    });
    expect(payload.snapshot.outcomes).toEqual([
      expect.objectContaining({
        key: "option-a",
        finalValue: 1
      }),
      expect.objectContaining({
        key: "option-b",
        finalValue: 0
      }),
      expect.objectContaining({
        key: "option-c",
        finalValue: 0
      }),
      expect.objectContaining({
        key: "option-d",
        finalValue: 0
      })
    ]);
    expect(payload.snapshot.trust).toMatchObject({
      resolutionSource: "official_election_result",
      resolutionRules: "Resolves to the official final coalition mandate notice.",
      sourceRolePlan: {
        wake: ["Coalition talks"],
        ground: ["Government notice"],
        resolve: ["Official coalition mandate notice"]
      },
      sourcePolicySummary: {
        contextSourceCount: 1,
        resolutionSourceCount: 1,
        requiresHumanReviewOnSourceConflict: true
      }
    });
  });

  it("uses shared nested error shape for unknown passive markets", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/market-detail/markets/nope-nope`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      error: {
        code: "market_detail_not_found",
        message: "Market detail market not found."
      },
      marketKey: "nope-nope"
    });
  });

  it("does not keep the retired meeting-detail compatibility path alive", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/market-detail/meetings/mar-18`);

    expect(response.status).toBe(404);
  });
});
