import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { recordOperatorObservedEvent } from "../../../../oracle/src/operator-observed-event-service";

function createDb(options?: { marketExists?: boolean; insertedEventId?: string | null }) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("from markets")) {
      return {
        rows: options?.marketExists === false ? [] : [{ id: values?.[0] }],
        rowCount: options?.marketExists === false ? 0 : 1
      };
    }

    if (sql.includes("insert into lifecycle_events")) {
      return {
        rows: options?.insertedEventId === null ? [] : [{ id: options?.insertedEventId ?? "lifevt_operator_1" }],
        rowCount: options?.insertedEventId === null ? 0 : 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    db: { query } as unknown as Pool,
    query
  };
}

describe("recordOperatorObservedEvent", () => {
  it("records operator-observed outcome context without creating or approving resolution", async () => {
    const { db, query } = createDb();

    const result = await recordOperatorObservedEvent(
      db,
      { actorId: "operator_omri" },
      {
        marketId: "disc-cm-eurovision-winner-2026",
        summary: "Official broadcast showed Austria as winner before the official page updated.",
        observedAt: "2026-05-17T23:15:00.000Z",
        observedOutcomeKey: "austria",
        sourceUrl: "https://eurovision.tv/event/vienna-2026/grand-final/results",
        sourceLabel: "Eurovision official results",
        note: "Operator-observed only; still requires normal Oracle resolution.",
        idempotencyKey: "eurovision-observed-austria"
      }
    );

    expect(result).toMatchObject({
      objectType: "oracle_operator_observed_event_result",
      marketId: "disc-cm-eurovision-winner-2026",
      eventType: "operator_observed_outcome",
      lifecycleEventId: "lifevt_operator_1",
      deduped: false,
      settlementAllowed: false,
      nextAction: "context_only"
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("insert into lifecycle_events"),
      expect.arrayContaining([
        expect.any(String),
        "disc-cm-eurovision-winner-2026",
        "operator_observed_outcome",
        "admin",
        "operator_omri",
        "2026-05-17T23:15:00.000Z",
        "eurovision-observed-austria",
        "operator_observed_outcome:disc-cm-eurovision-winner-2026:eurovision-observed-austria"
      ])
    );

    const payload = JSON.parse(String(query.mock.calls[1]?.[1]?.[11]));
    expect(payload).toMatchObject({
      tier: "operator_observed",
      observedOutcomeKey: "austria",
      sourceUrl: "https://eurovision.tv/event/vienna-2026/grand-final/results",
      settlementAllowed: false,
      createsResolutionCase: false
    });
  });

  it.each(["javascript:alert(1)", "http://example.com/result"])(
    "rejects unsafe operator-observed source URL %s",
    async (sourceUrl) => {
      const { db, query } = createDb();

      await expect(
        recordOperatorObservedEvent(
          db,
          { actorId: "operator_omri" },
          {
            marketId: "disc-cm-eurovision-winner-2026",
            summary: "Official broadcast showed Austria as winner before the official page updated.",
            observedAt: "2026-05-17T23:15:00.000Z",
            observedOutcomeKey: "austria",
            sourceUrl,
            sourceLabel: "Eurovision official results",
            idempotencyKey: `unsafe-source-${sourceUrl}`
          }
        )
      ).rejects.toThrowError(/sourceUrl must be an HTTPS URL/);

      expect(query).not.toHaveBeenCalled();
    }
  );

  it("returns deduped when the lifecycle event already exists", async () => {
    const { db } = createDb({ insertedEventId: null });

    const result = await recordOperatorObservedEvent(
      db,
      { actorId: "operator_omri" },
      {
        marketId: "disc-cm-eurovision-winner-2026",
        summary: "Duplicate observation.",
        observedAt: "2026-05-17T23:15:00.000Z",
        idempotencyKey: "same-observation"
      }
    );

    expect(result).toMatchObject({
      lifecycleEventId: null,
      deduped: true,
      settlementAllowed: false
    });
  });

  it("rejects unknown markets before writing lifecycle events", async () => {
    const { db, query } = createDb({ marketExists: false });

    await expect(
      recordOperatorObservedEvent(
        db,
        { actorId: "operator_omri" },
        {
          marketId: "missing-market",
          summary: "No write should happen."
        }
      )
    ).rejects.toThrowError(/Market not found/);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
