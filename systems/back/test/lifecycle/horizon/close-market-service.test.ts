import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  closeMarket,
  CloseMarketServiceError,
  parseCloseMarketRequest
} from "../../../src/lifecycle/horizon/close-market-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

afterEach(() => {
  vi.useRealTimers();
});

function createDbPool(options?: {
  marketStatus?: "open" | "closed" | "resolved";
  closeAt?: Date;
  closeOnEventCompletion?: boolean;
  eventCompletionCloseRequiresHumanApproval?: boolean;
  completedResponse?: unknown;
  conflictingRequestHash?: string;
}) {
  const state = {
    updatedMarket: null as null | { marketId: string; closedAt: string },
    completedResponse:
      options?.completedResponse ?? null,
    existingRequestHash: null as string | null,
    lifecycleEvents: [] as Array<Record<string, unknown>>
  };

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("insert into idempotency_records")) {
          // values: [$1=recordId, $2=scope, $3=actorId, $4=idempotencyKey, $5=requestHash]
          state.existingRequestHash = String(values?.[4] ?? "");

          if (options?.completedResponse || options?.conflictingRequestHash) {
            return { rows: [], rowCount: 0 };
          }

          return { rows: [{ id: "idem_close_1" }], rowCount: 1 };
        }

        if (sql.includes("from idempotency_records")) {
          return {
            rows: [
              {
                id: "idem_close_1",
                request_hash: options?.conflictingRequestHash ?? state.existingRequestHash ?? "",
                status: options?.completedResponse ? "completed" : "in_progress",
                response_snapshot: options?.completedResponse ?? null
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from markets")) {
          return {
            rows: [
              {
                id: "market_seed_next_prime_minister",
                status: options?.marketStatus ?? "open",
                open_at: new Date("2026-03-01T10:00:00Z"),
                close_at: options?.closeAt ?? new Date("2026-06-01T10:00:00Z"),
                close_on_event_completion: options?.closeOnEventCompletion ?? true,
                event_completion_close_requires_human_approval:
                  options?.eventCompletionCloseRequiresHumanApproval ?? true,
                closed_at: null,
                resolved_at: null
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("update markets")) {
          state.updatedMarket = {
            marketId: String(values?.[0]),
            closedAt: String(values?.[1])
          };
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into audit_events")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into lifecycle_events")) {
          state.lifecycleEvents.push({
            eventType: values?.[2],
            sourceSystem: values?.[3],
            actorId: values?.[4],
            marketId: values?.[1],
            oracleCaseId: values?.[9]
          });
          return { rows: [{ id: "lifevt_close_1" }], rowCount: 1 };
        }

        if (sql.includes("update idempotency_records")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn()
    }))
  } as unknown as Pool;

  return {
    pool,
    state
  };
}

describe("parseCloseMarketRequest", () => {
  it("requires idempotency key and valid trigger", () => {
    expect(() =>
      parseCloseMarketRequest({
        triggerType: "scheduled_time",
        reason: "Routine close"
      })
    ).toThrowError(/idempotencyKey is required/);
  });

  it.each(["javascript:alert(1)", "http://example.com/result"])(
    "rejects unsafe close source URL %s",
    (sourceUrl) => {
      expect(() =>
        parseCloseMarketRequest({
          triggerType: "oracle_confirmed_event_completion",
          reason: "Official source confirms event completion.",
          sourceUrl,
          idempotencyKey: "close:unsafe-source"
        })
      ).toThrowError(/sourceUrl must be an HTTPS URL/);
    }
  );
});

describe("close market service", () => {
  it("closes the dummy 5-minute EOL market at scheduled close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:05:01.000Z"));

    const { pool, state } = createDbPool({
      closeAt: new Date("2026-05-03T12:05:00.000Z")
    });

    const response = await closeMarket(
      pool,
      "oracle_dummy_close_in_5_min",
      {
        triggerType: "scheduled_time",
        reason: "Dummy market reached its 5-minute scheduled EOL.",
        sourceUrl: null,
        note: "will this market close in 5 min",
        oracleCaseId: null,
        triggeredByOracleId: null,
        approvedByHumanId: null,
        idempotencyKey: "close:oracle_dummy_close_in_5_min:eol"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      marketId: "oracle_dummy_close_in_5_min",
      status: "closed",
      triggerType: "scheduled_time",
      closedAt: "2026-05-03T12:05:01.000Z"
    });
    expect(state.updatedMarket).toEqual({
      marketId: "oracle_dummy_close_in_5_min",
      closedAt: "2026-05-03T12:05:01.000Z"
    });
    expect(state.lifecycleEvents[0]).toMatchObject({
      eventType: "market_closed",
      sourceSystem: "horizon"
    });
  });

  it("closes an open market and returns audit-linked response", async () => {
    const { pool, state } = createDbPool({
      closeAt: new Date("2026-03-01T09:00:00Z")
    });

    const response = await closeMarket(
      pool,
      "market_seed_next_prime_minister",
      {
        triggerType: "scheduled_time",
        reason: "Routine scheduled close sweep.",
        sourceUrl: null,
        note: null,
        oracleCaseId: null,
        triggeredByOracleId: null,
        approvedByHumanId: null,
        idempotencyKey: "close:market_seed_next_prime_minister:1"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      marketId: "market_seed_next_prime_minister",
      status: "closed",
      triggerType: "scheduled_time"
    });
    expect(response.auditEventId).toContain("audit_");
    expect(state.updatedMarket?.marketId).toBe("market_seed_next_prime_minister");
  });

  it.each(["javascript:alert(1)", "http://example.com/result"])(
    "rejects unsafe close source URL at the service boundary %s",
    async (sourceUrl) => {
      const { pool } = createDbPool({
        closeAt: new Date("2026-03-01T09:00:00Z")
      });

      await expect(
        closeMarket(
          pool,
          "market_seed_next_prime_minister",
          {
            triggerType: "oracle_confirmed_event_completion",
            reason: "Official source confirms event completion.",
            sourceUrl,
            note: "Official source confirms event completion.",
            oracleCaseId: "oracle_case_1",
            triggeredByOracleId: "oracle_agent_1",
            approvedByHumanId: "user_admin_1",
            idempotencyKey: `close:unsafe-source:${sourceUrl}`
          },
          ADMIN_ACTOR
        )
      ).rejects.toMatchObject<Partial<CloseMarketServiceError>>({
        statusCode: 400,
        code: "invalid_request",
        message: "sourceUrl must be an HTTPS URL."
      });
    }
  );

  it("rejects non-closable markets", async () => {
    const { pool } = createDbPool({
      marketStatus: "closed",
      closeAt: new Date("2026-03-01T09:00:00Z")
    });

    await expect(
      closeMarket(
        pool,
        "market_seed_next_prime_minister",
        {
          triggerType: "scheduled_time",
          reason: "Routine scheduled close sweep.",
          sourceUrl: null,
          note: null,
          oracleCaseId: null,
          triggeredByOracleId: null,
          approvedByHumanId: null,
          idempotencyKey: "close:market_seed_next_prime_minister:2"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<CloseMarketServiceError>>({
      statusCode: 409,
      code: "market_not_closable"
    });
  });

  it("rejects event-completion close without supporting policy", async () => {
    const { pool } = createDbPool({
      closeAt: new Date("2026-06-01T10:00:00Z"),
      closeOnEventCompletion: false,
      eventCompletionCloseRequiresHumanApproval: false
    });

    await expect(
      closeMarket(
        pool,
        "market_seed_next_prime_minister",
        {
          triggerType: "oracle_confirmed_event_completion",
          reason: "Event already completed.",
          sourceUrl: "https://example.com/result",
          note: "Official event completion confirmation.",
          oracleCaseId: "oracle_case_1",
          triggeredByOracleId: "oracle_agent_1",
          approvedByHumanId: null,
          idempotencyKey: "close:market_seed_next_prime_minister:3"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<CloseMarketServiceError>>({
      statusCode: 409,
      code: "market_not_closable"
    });
  });

  it("replays a completed idempotent response", async () => {
    const replayResponse = {
      marketId: "market_seed_next_prime_minister",
      status: "closed",
      closedAt: "2026-03-01T10:00:00.000Z",
      triggerType: "scheduled_time",
      auditEventId: "audit_close_1"
    };
    const { pool, state } = createDbPool({
      completedResponse: replayResponse
    });

    const response = await closeMarket(
      pool,
      "market_seed_next_prime_minister",
      {
        triggerType: "scheduled_time",
        reason: "Routine scheduled close sweep.",
        sourceUrl: null,
        note: null,
        oracleCaseId: null,
        triggeredByOracleId: null,
        approvedByHumanId: null,
        idempotencyKey: "close:market_seed_next_prime_minister:4"
      },
      ADMIN_ACTOR
    );

    expect(response).toEqual(replayResponse);
    expect(state.updatedMarket).toBeNull();
  });
});
