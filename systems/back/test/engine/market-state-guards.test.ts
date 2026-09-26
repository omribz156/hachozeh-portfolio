import { describe, expect, it, vi } from "vitest";

import {
  isMarketOpenForTrading,
  resolveContractExecutionIndexes
} from "../../src/engine/market-state-guards";

describe("engine market state guards", () => {
  it("treats a DB-open market past close time as not tradable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00.000Z"));

    try {
      expect(
        isMarketOpenForTrading({
          market_status: "open",
          market_close_at: "2026-05-30T11:59:59.000Z"
        })
      ).toBe(false);
      expect(
        isMarketOpenForTrading({
          market_status: "open",
          market_close_at: "2026-05-30T12:01:00.000Z"
        })
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves direct and complement execution indexes", () => {
    const rows = [
      { outcome_id: "yes" },
      { outcome_id: "no" },
      { outcome_id: "draw" }
    ];

    expect(
      resolveContractExecutionIndexes(rows, {
        requestedOutcomeId: "yes",
        executionOutcomeId: "yes"
      })
    ).toEqual({
      ok: true,
      requestedOutcomeIndex: 0,
      executionOutcomeIndex: 0
    });

    expect(
      resolveContractExecutionIndexes(rows, {
        requestedOutcomeId: "yes",
        executionOutcomeId: null
      })
    ).toEqual({
      ok: true,
      requestedOutcomeIndex: 0,
      executionOutcomeIndex: -1
    });
  });

  it("returns outcome_not_found when requested or execution outcome is missing", () => {
    const rows = [{ outcome_id: "yes" }];

    expect(
      resolveContractExecutionIndexes(rows, {
        requestedOutcomeId: "missing",
        executionOutcomeId: "yes"
      })
    ).toEqual({
      ok: false,
      code: "outcome_not_found"
    });

    expect(
      resolveContractExecutionIndexes(rows, {
        requestedOutcomeId: "yes",
        executionOutcomeId: "missing"
      })
    ).toEqual({
      ok: false,
      code: "outcome_not_found"
    });
  });
});
