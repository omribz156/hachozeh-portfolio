import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("../../../src/lifecycle/horizon/close-market-service", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lifecycle/horizon/close-market-service")>(
    "../../../src/lifecycle/horizon/close-market-service"
  );

  return {
    ...actual,
    closeMarket: vi.fn()
  };
});

import { closeMarket } from "../../../src/lifecycle/horizon/close-market-service";
import {
  HORIZON_SYSTEM_ACTOR,
  inspectMarketClose,
  runHorizonCloseSweep
} from "../../../src/lifecycle/horizon/close-sweep-service";

beforeEach(() => {
  vi.mocked(closeMarket).mockReset();
});

function createDbPool(options?: {
  dueMarkets?: Array<{
    id: string;
    status?: "draft" | "open" | "closed" | "resolved";
    closeAt?: Date;
    closedAt?: Date | null;
    resolvedAt?: Date | null;
    closeOnEventCompletion?: boolean;
    eventCompletionCloseRequiresHumanApproval?: boolean;
  }>;
  conflictingMarkets?: Array<{
    id: string;
    status: "draft" | "closed" | "resolved";
    closeAt?: Date;
    closedAt?: Date | null;
    resolvedAt?: Date | null;
  }>;
  singleMarket?: {
    id: string;
    status?: "draft" | "open" | "closed" | "resolved";
    closeAt?: Date;
    closeOnEventCompletion?: boolean;
    eventCompletionCloseRequiresHumanApproval?: boolean;
  };
}) {
  const dueMarkets = options?.dueMarkets ?? [];
  const conflictingMarkets = options?.conflictingMarkets ?? [];
  const singleMarket = options?.singleMarket;

  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("where status = 'open'")) {
        const scopedMarketId = params.find((param) => typeof param === "string" && param.startsWith("market_"));
        const limit =
          typeof params[params.length - 1] === "number"
            ? (params[params.length - 1] as number)
            : dueMarkets.length;
        const rows = dueMarkets.filter(
          (market) => !scopedMarketId || market.id === scopedMarketId
        );

        return {
          rows: rows.slice(0, limit).map((market) => ({
            id: market.id,
            status: market.status ?? "open",
            open_at: new Date("2026-03-01T10:00:00Z"),
            close_at: market.closeAt ?? new Date("2026-03-30T09:55:00Z"),
            close_on_event_completion: market.closeOnEventCompletion ?? true,
            event_completion_close_requires_human_approval:
              market.eventCompletionCloseRequiresHumanApproval ?? true,
            closed_at: market.closedAt ?? null,
            resolved_at: market.resolvedAt ?? null
          })),
          rowCount: rows.length
        };
      }

      if (sql.includes("status = 'draft'")) {
        return {
          rows: conflictingMarkets.map((market) => ({
            id: market.id,
            status: market.status,
            open_at: new Date("2026-03-01T10:00:00Z"),
            close_at: market.closeAt ?? new Date("2026-03-30T09:55:00Z"),
            close_on_event_completion: false,
            event_completion_close_requires_human_approval: false,
            closed_at: market.closedAt ?? null,
            resolved_at: market.resolvedAt ?? null
          })),
          rowCount: conflictingMarkets.length
        };
      }

      if (sql.includes("where id = $1")) {
        const marketId = params[0];
        const market =
          singleMarket ??
          dueMarkets.find((candidate) => candidate.id === marketId);

        if (!market) {
          return { rows: [], rowCount: 0 };
        }

        return {
          rows: [
            {
              id: market.id,
              status: market.status ?? "open",
              open_at: new Date("2026-03-01T10:00:00Z"),
              close_at: market.closeAt ?? new Date("2026-03-30T09:55:00Z"),
              close_on_event_completion: market.closeOnEventCompletion ?? true,
              event_completion_close_requires_human_approval:
                market.eventCompletionCloseRequiresHumanApproval ?? true,
              closed_at: null,
              resolved_at: null
            }
          ],
          rowCount: 1
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Pool;
}

describe("inspect market close", () => {
  it("builds an eligible scheduled close inspection for a due market", async () => {
    const pool = createDbPool({
      singleMarket: {
        id: "market_seed_next_prime_minister",
        status: "open",
        closeAt: new Date("2026-03-30T09:55:00Z")
      }
    });

    const inspection = await inspectMarketClose(pool, {
      marketId: "market_seed_next_prime_minister",
      evaluatedAt: "2026-03-30T10:00:00Z",
      triggerType: "scheduled_time",
      whyNow: "Routine scheduled close inspection."
    });

    expect(inspection.check.eligible).toBe(true);
    expect(inspection.alert).toBeUndefined();
    expect(inspection.candidate.triggerType).toBe("scheduled_time");
  });
});

describe("horizon close sweep", () => {
  it("returns due candidates on dry-run without executing closes", async () => {
    const pool = createDbPool({
      dueMarkets: [
        {
          id: "market_seed_next_prime_minister"
        }
      ]
    });

    const result = await runHorizonCloseSweep(pool, {
      evaluatedAt: "2026-03-30T10:00:00Z",
      dryRun: true
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.checks[0]?.eligible).toBe(true);
    expect(result.executions).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
    expect(closeMarket).not.toHaveBeenCalled();
  });

  it("executes scheduled close for due markets", async () => {
    vi.mocked(closeMarket).mockResolvedValueOnce({
      marketId: "market_seed_next_prime_minister",
      status: "closed",
      closedAt: "2026-03-30T10:00:00.000Z",
      triggerType: "scheduled_time",
      auditEventId: "audit_close_1"
    });

    const pool = createDbPool({
      dueMarkets: [
        {
          id: "market_seed_next_prime_minister"
        }
      ]
    });

    const result = await runHorizonCloseSweep(pool, {
      evaluatedAt: "2026-03-30T10:00:00Z"
    });

    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]?.resultingStatus).toBe("closed");
    expect(closeMarket).toHaveBeenCalledWith(
      pool,
      "market_seed_next_prime_minister",
      expect.objectContaining({
        triggerType: "scheduled_time",
        idempotencyKey: "close:market_seed_next_prime_minister:scheduled:2026-03-30T09:55:00.000Z",
        requestedAt: "2026-03-30T10:00:00.000Z"
      }),
      HORIZON_SYSTEM_ACTOR
    );
  });

  it("limits scheduled close sweep batches", async () => {
    vi.mocked(closeMarket).mockResolvedValue({
      marketId: "market_one",
      status: "closed",
      closedAt: "2026-03-30T10:00:00.000Z",
      triggerType: "scheduled_time",
      auditEventId: "audit_close_1"
    });

    const pool = createDbPool({
      dueMarkets: [
        {
          id: "market_one"
        },
        {
          id: "market_two"
        }
      ]
    });

    const result = await runHorizonCloseSweep(pool, {
      evaluatedAt: "2026-03-30T10:00:00Z",
      limit: 1
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.executions).toHaveLength(1);
    expect(closeMarket).toHaveBeenCalledTimes(1);
  });

  it("scopes scheduled close sweep to one requested market", async () => {
    const pool = createDbPool({
      dueMarkets: [
        {
          id: "market_one"
        },
        {
          id: "market_two"
        }
      ]
    });

    const result = await runHorizonCloseSweep(pool, {
      evaluatedAt: "2026-03-30T10:00:00Z",
      dryRun: true,
      marketId: "market_two"
    });

    expect(result.candidates.map((candidate) => candidate.marketId)).toEqual(["market_two"]);
    expect(closeMarket).not.toHaveBeenCalled();
  });

  it("surfaces lifecycle conflicts as alerts", async () => {
    const pool = createDbPool({
      conflictingMarkets: [
        {
          id: "market_draft_weird",
          status: "draft"
        }
      ]
    });

    const result = await runHorizonCloseSweep(pool, {
      evaluatedAt: "2026-03-30T10:00:00Z",
      dryRun: true
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]?.alertType).toBe("state-conflict");
  });
});
