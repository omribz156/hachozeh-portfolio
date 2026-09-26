import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  parseResolveMarketRequest,
  resolveMarket,
  ResolveMarketServiceError
} from "../../../../oracle/src/resolve-market-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: {
  marketStatus?: "closed" | "open" | "resolved";
  completedResponse?: unknown;
  conflictingRequestHash?: string;
}) {
  const state = {
    existingRequestHash: null as string | null,
    market: {
      id: "market_seed_next_prime_minister",
      status: options?.marketStatus ?? "closed",
      settlement_status: null as string | null,
      market_treasury_account_id: "account_market_treasury_1",
      resolved_at: null as Date | null
    },
    outcomes: [
      { id: "outcome_a", market_id: "market_seed_next_prime_minister", is_winner: null },
      { id: "outcome_b", market_id: "market_seed_next_prime_minister", is_winner: null }
    ],
    positions: [
      {
        user_id: "user_1",
        outcome_id: "outcome_a",
        shares: "10.000000",
        cost_basis: "6.000000",
        user_cash_account_id: "account_user_1_cash",
        user_cash_balance: "2.000000"
      },
      {
        user_id: "user_2",
        outcome_id: "outcome_b",
        shares: "5.000000",
        cost_basis: "4.000000",
        user_cash_account_id: "account_user_2_cash",
        user_cash_balance: "1.000000"
      }
    ],
    contractPositions: [
      {
        user_id: "user_1",
        market_id: "market_seed_next_prime_minister",
        requested_outcome_id: "outcome_a",
        contract_side: "yes",
        settled_at: null as string | null
      },
      {
        user_id: "user_2",
        market_id: "market_seed_next_prime_minister",
        requested_outcome_id: "outcome_b",
        contract_side: "yes",
        settled_at: null as string | null
      }
    ],
    accounts: {
      account_market_treasury_1: {
        id: "account_market_treasury_1",
        type: "market_treasury",
        status: "active",
        balance_cached: "100.000000"
      },
      account_platform_treasury_1: {
        id: "account_platform_treasury_1",
        type: "platform_treasury",
        status: "active",
        balance_cached: "500.000000"
      },
      account_user_1_cash: {
        id: "account_user_1_cash",
        type: "user_cash",
        status: "active",
        balance_cached: "2.000000"
      },
      account_user_2_cash: {
        id: "account_user_2_cash",
        type: "user_cash",
        status: "active",
        balance_cached: "1.000000"
      }
    } as Record<string, { id: string; type: string; status: string; balance_cached: string }>,
    realizationEvents: [] as Array<Record<string, unknown>>,
    ledgerTransactions: [] as Array<Record<string, unknown>>,
    marketResolutionInserted: false,
    lifecycleEvents: [] as Array<Record<string, unknown>>
  };

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("pg_advisory_xact_lock")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into idempotency_records")) {
          // values: [$1=recordId, $2=scope, $3=actorId, $4=idempotencyKey, $5=requestHash]
          state.existingRequestHash = String(values?.[4] ?? "");

          if (options?.completedResponse || options?.conflictingRequestHash) {
            return { rows: [], rowCount: 0 };
          }

          return { rows: [{ id: "idem_resolve_1" }], rowCount: 1 };
        }

        if (sql.includes("from idempotency_records")) {
          return {
            rows: [
              {
                id: "idem_resolve_1",
                request_hash: options?.conflictingRequestHash ?? state.existingRequestHash ?? "",
                status: options?.completedResponse ? "completed" : "in_progress",
                response_snapshot: options?.completedResponse ?? null
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from markets")) {
          return { rows: [state.market], rowCount: 1 };
        }

        if (sql.includes("from market_outcomes")) {
          return { rows: state.outcomes, rowCount: state.outcomes.length };
        }

        if (sql.includes("insert into market_resolutions")) {
          state.marketResolutionInserted = true;
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update market_outcomes")) {
          const winningOutcomeId = String(values?.[1]);
          state.outcomes = state.outcomes.map((outcome) => ({
            ...outcome,
            is_winner: outcome.id === winningOutcomeId
          }));
          return { rows: [], rowCount: state.outcomes.length };
        }

        if (sql.includes("from positions p")) {
          return { rows: state.positions, rowCount: state.positions.length };
        }

        if (sql.includes("where id = $1") && sql.includes("from accounts")) {
          const accountId = String(values?.[0]);
          return { rows: [state.accounts[accountId]], rowCount: 1 };
        }

        if (sql.includes("where type = 'platform_treasury'")) {
          return { rows: [state.accounts.account_platform_treasury_1], rowCount: 1 };
        }

        if (sql.includes("update accounts")) {
          const accountId = String(values?.[0]);
          state.accounts[accountId] = {
            ...state.accounts[accountId],
            balance_cached: String(values?.[1])
          };
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into realization_events")) {
          state.realizationEvents.push({
            userId: values?.[1],
            outcomeId: values?.[3],
            type: values?.[4],
            proceeds: values?.[6],
            claimStatus: values?.[9]
          });
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("from realization_events re") && sql.includes("notification_preferences")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("delete from positions")) {
          const userId = String(values?.[0]);
          const outcomeId = String(values?.[2]);
          state.positions = state.positions.filter(
            (position) => !(position.user_id === userId && position.outcome_id === outcomeId)
          );
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update contract_positions")) {
          const marketId = String(values?.[0]);
          const settledAt = String(values?.[1]);
          state.contractPositions = state.contractPositions.map((position) =>
            position.market_id === marketId && position.settled_at === null
              ? { ...position, settled_at: settledAt }
              : position
          );
          return { rows: [], rowCount: state.contractPositions.length };
        }

        if (sql.includes("select sequence_number, transaction_hash")) {
          const lastIndex = state.ledgerTransactions.length;
          if (lastIndex === 0) {
            return { rows: [], rowCount: 0 };
          }

          return {
            rows: [
              {
                sequence_number: String(lastIndex),
                transaction_hash: `hash_${lastIndex}`
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into ledger_transactions")) {
          state.ledgerTransactions.push({
            type: values?.[2],
            referenceType: values?.[3],
            referenceId: values?.[4]
          });
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into ledger_entries")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update markets")) {
          state.market = {
            ...state.market,
            status: sql.includes("status = 'resolved'") ? "resolved" : state.market.status,
            settlement_status: String(values?.[2] ?? state.market.settlement_status),
            resolved_at: values?.[1] ? new Date(String(values?.[1])) : state.market.resolved_at
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
            oracleCaseId: values?.[9],
            resolutionId: values?.[10]
          });
          return { rows: [{ id: `lifevt_${state.lifecycleEvents.length}` }], rowCount: 1 };
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

  return { pool, state };
}

describe("parseResolveMarketRequest", () => {
  it("requires resolution source and idempotency key", () => {
    expect(() =>
      parseResolveMarketRequest({
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionNote: "Official result."
      })
    ).toThrowError(/resolutionSourceUrl is required/);
  });
});

describe("resolve market service", () => {
  it("resolves a closed market and leaves winner payouts claimable", async () => {
    const { pool, state } = createDbPool();

    const response = await resolveMarket(
      pool,
      "market_seed_next_prime_minister",
      {
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "https://example.com/result",
        resolutionNote: "Official result.",
        oracleCaseId: "oracle_case_1",
        proposedByOracleId: "oracle_agent_1",
        approvedByHumanId: null,
        evidenceSnapshot: "{\"winner\":\"outcome_a\"}",
        idempotencyKey: "resolve:1"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      marketId: "market_seed_next_prime_minister",
      status: "resolved",
      winningOutcomeId: "outcome_a",
      settlementStatus: "completed"
    });
    expect(state.market.status).toBe("resolved");
    expect(state.market.settlement_status).toBe("completed");
    expect(state.marketResolutionInserted).toBe(true);
    expect(state.positions).toHaveLength(0);
    expect(state.contractPositions.every((position) => position.settled_at)).toBe(true);
    expect(state.accounts.account_user_1_cash.balance_cached).toBe("2.000000");
    expect(state.accounts.account_market_treasury_1.balance_cached).toBe("10.000000");
    expect(state.accounts.account_platform_treasury_1.balance_cached).toBe("590.000000");
    expect(state.realizationEvents).toHaveLength(2);
    expect(state.realizationEvents[0]).toMatchObject({
      type: "resolution_win",
      claimStatus: "pending"
    });
    expect(state.ledgerTransactions).toHaveLength(1);
    expect(state.lifecycleEvents.map((event) => event.eventType)).toEqual([
      "market_resolved",
      "settlement_completed"
    ]);
  });

  it("rejects resolve when market is not closed", async () => {
    const { pool } = createDbPool({
      marketStatus: "open"
    });

    await expect(
      resolveMarket(
        pool,
        "market_seed_next_prime_minister",
        {
          winningOutcomeId: "outcome_a",
          triggerType: "oracle_proposal",
          resolutionSourceUrl: "https://example.com/result",
          resolutionNote: "Official result.",
          oracleCaseId: null,
          proposedByOracleId: "oracle_agent_1",
          approvedByHumanId: null,
          evidenceSnapshot: null,
          idempotencyKey: "resolve:2"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<ResolveMarketServiceError>>({
      statusCode: 409,
      code: "market_not_resolvable"
    });
  });

  it("replays a completed idempotent response", async () => {
    const replayResponse = {
      marketId: "market_seed_next_prime_minister",
      status: "resolved",
      winningOutcomeId: "outcome_a",
      resolutionId: "resolution_1",
      resolvedAt: "2026-04-01T10:00:00.000Z",
      settlementStatus: "completed",
      auditEventId: "audit_resolution_1"
    };
    const { pool, state } = createDbPool({
      completedResponse: replayResponse
    });

    const response = await resolveMarket(
      pool,
      "market_seed_next_prime_minister",
      {
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "https://example.com/result",
        resolutionNote: "Official result.",
        oracleCaseId: null,
        proposedByOracleId: "oracle_agent_1",
        approvedByHumanId: null,
        evidenceSnapshot: null,
        idempotencyKey: "resolve:3"
      },
      ADMIN_ACTOR
    );

    expect(response).toEqual(replayResponse);
    expect(state.marketResolutionInserted).toBe(false);
    expect(state.lifecycleEvents).toHaveLength(0);
  });
});
