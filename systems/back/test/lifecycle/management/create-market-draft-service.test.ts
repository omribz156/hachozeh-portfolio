import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  createMarketDraft,
  CreateMarketDraftServiceError,
  parseCreateMarketDraftRequest
} from "../../../src/lifecycle/management/create-market-draft-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: {
  completedResponse?: unknown;
  conflictingRequestHash?: string;
  existingMarket?: boolean;
}) {
  const state = {
    existingRequestHash: null as string | null,
    market: options?.existingMarket ? { id: "who-wins-ef4a5b19" } : null,
    outcomes: [] as string[],
    auditWritten: false,
    oracleSourcePolicyJson: null as string | null,
    marketContractJson: null as string | null,
    marketEnvironment: null as string | null,
    marketFamilyKey: null as string | null,
    eventId: null as string | null,
    eventChildLabel: null as string | null,
    eventTitle: null as string | null,
    eventResolutionPolicy: null as string | null,
    liquidityB: null as string | null
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

          return { rows: [{ id: "idem_create_1" }], rowCount: 1 };
        }

        if (sql.includes("from idempotency_records")) {
          return {
            rows: [
              {
                id: "idem_create_1",
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
            rows: state.market ? [state.market] : [],
            rowCount: state.market ? 1 : 0
          };
        }

        if (sql.includes("insert into events")) {
          state.eventId = String(values?.[0] ?? "");
          state.eventTitle = String(values?.[2] ?? "");
          state.eventResolutionPolicy = String(values?.[7] ?? "");
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into markets")) {
          state.market = {
            id: String(values?.[0])
          };
          state.marketEnvironment = String(values?.[1] ?? "");
          state.marketFamilyKey = values?.[5] == null ? null : String(values?.[5]);
          state.eventId = String(values?.[6] ?? "");
          state.eventChildLabel = values?.[7] == null ? null : String(values?.[7]);
          state.oracleSourcePolicyJson = String(values?.[12] ?? "");
          state.marketContractJson = String(values?.[13] ?? "");
          state.liquidityB = String(values?.[14] ?? "");
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into market_outcomes")) {
          state.outcomes.push(String(values?.[0]));
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into audit_events")) {
          state.auditWritten = true;
          return { rows: [], rowCount: 1 };
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

describe("parseCreateMarketDraftRequest", () => {
  it("requires at least two outcomes", () => {
    expect(() =>
      parseCreateMarketDraftRequest({
        title: "?? ?????",
        openAt: "2026-04-01T09:00:00Z",
        closeAt: "2026-04-02T09:00:00Z",
        resolutionSource: "iec",
        resolutionRules: "winner is official result",
        liquidityB: "1000.00000000",
        outcomes: [{ label: "?" }],
        idempotencyKey: "create:1"
      })
    ).toThrowError(/at least two options/);
  });

  it("rejects unknown market environments", () => {
    expect(() =>
      parseCreateMarketDraftRequest({
        marketEnvironment: "sim",
        title: "Who wins?",
        openAt: "2026-04-01T09:00:00Z",
        closeAt: "2026-04-02T09:00:00Z",
        resolutionSource: "official",
        resolutionRules: "winner is official result",
        liquidityB: "1000.00000000",
        closeOnEventCompletion: false,
        eventCompletionCloseRequiresHumanApproval: false,
        outcomes: [{ label: "Yes" }, { label: "No" }],
        idempotencyKey: "create:env"
      })
    ).toThrowError(/marketEnvironment must be prod or test/);
  });
});

describe("create market draft service", () => {
  it("creates a draft market with generated ids when not provided", async () => {
    const { pool, state } = createDbPool();

    const response = await createMarketDraft(
      pool,
      {
        marketId: null,
        familyKey: "coalition-mandate-v1",
        eventId: null,
        eventTitle: null,
        eventDescription: null,
        eventIcon: null,
        eventChildLabel: "June 30",
        title: "Who wins?",
        description: "Draft market",
        categoryKey: "politics",
        openAt: "2026-04-01T10:00:00.000Z",
        closeAt: "2026-04-08T10:00:00.000Z",
        resolutionSource: "official-results",
        resolutionRules: "Official result decides.",
        oracleSourcePolicy: {
          preferredSourceIds: ["src_knesset_official", "src_central_elections_committee"],
          contextSourceIds: ["src_market_launch_wire"],
          resolutionSourceIds: ["src_central_elections_committee"],
          requiresHumanReviewOnSourceConflict: true
        },
        marketContract: {
          objectType: "market_contract_v1",
          version: "seer-contract-v1",
          delayPolicy: "Official delay policy follows operator-approved source updates."
        },
        liquidityB: "1000.00000000",
        closeOnEventCompletion: true,
        eventCompletionCloseRequiresHumanApproval: true,
        outcomes: [
          {
            outcomeId: null,
            label: "Candidate A",
            shortLabel: "A",
            description: null,
            colorKey: "blue"
          },
          {
            outcomeId: null,
            label: "Candidate B",
            shortLabel: "B",
            description: null,
            colorKey: "red"
          }
        ],
        idempotencyKey: "create:1"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      status: "draft",
      openAt: "2026-04-01T10:00:00.000Z",
      closeAt: "2026-04-08T10:00:00.000Z"
    });
    expect(response.marketId).toMatch(/^who-wins-/);
    expect(response.outcomeIds).toEqual([
      `${response.marketId}-outcome-candidate-a`,
      `${response.marketId}-outcome-candidate-b`
    ]);
    expect(state.market?.id).toBe(response.marketId);
    expect(response.eventId).toBe(`evt_${response.marketId}`);
    expect(state.eventId).toBe(`evt_${response.marketId}`);
    expect(state.eventChildLabel).toBe("June 30");
    expect(state.marketEnvironment).toBe("prod");
    expect(state.eventTitle).toBe("Who wins?");
    expect(state.eventResolutionPolicy).toBe("independent_children");
    expect(state.outcomes).toEqual(response.outcomeIds);
    expect(state.auditWritten).toBe(true);
    expect(state.marketFamilyKey).toBe("coalition-mandate-v1");
    expect(state.oracleSourcePolicyJson).toContain("src_knesset_official");
    expect(state.oracleSourcePolicyJson).toContain("src_market_launch_wire");
    expect(state.marketContractJson).toContain("market_contract_v1");
    expect(state.marketContractJson).toContain("Official delay policy");
    expect(state.marketContractJson).toContain("\"environment\":\"prod\"");
    expect(JSON.parse(state.marketContractJson ?? "{}").operational.relatedTagSuggestions).toEqual([
      { slug: "politics", label: "פוליטיקה", kind: "topic", weight: 0 }
    ]);
    expect(state.liquidityB).toBe("1000.00000000");
  });

  it("keeps explicitly marked stress drafts shallow for local engine proof markets", async () => {
    const { pool, state } = createDbPool();

    await createMarketDraft(
      pool,
      {
        marketId: "stress-liquidity-proof",
        familyKey: "stress.market",
        eventId: null,
        eventTitle: null,
        eventDescription: null,
        eventIcon: null,
        title: "Stress proof",
        description: null,
        categoryKey: "stress",
        openAt: "2026-04-01T10:00:00.000Z",
        closeAt: "2026-04-08T10:00:00.000Z",
        resolutionSource: "stress",
        resolutionRules: "Stress market.",
        oracleSourcePolicy: null,
        marketContract: null,
        liquidityB: "700.00000000",
        closeOnEventCompletion: false,
        eventCompletionCloseRequiresHumanApproval: false,
        outcomes: [
          {
            outcomeId: "stress-liquidity-proof-yes",
            label: "Yes",
            shortLabel: null,
            description: null,
            colorKey: null
          },
          {
            outcomeId: "stress-liquidity-proof-no",
            label: "No",
            shortLabel: null,
            description: null,
            colorKey: null
          }
        ],
        idempotencyKey: "create:stress"
      },
      ADMIN_ACTOR
    );

    expect(state.liquidityB).toBe("700.00000000");
  });

  it("derives named-opponent display hints for two-side winner contracts", async () => {
    const { pool, state } = createDbPool();

    await createMarketDraft(
      pool,
      {
        marketId: "winner-named-sides",
        familyKey: "sports-fixtures",
        eventId: "event_match_1",
        eventTitle: "Team A vs Team B event",
        eventDescription: null,
        eventIcon: null,
        title: "Team A vs Team B",
        description: null,
        categoryKey: "sports",
        openAt: "2026-04-01T10:00:00.000Z",
        closeAt: "2026-04-08T10:00:00.000Z",
        resolutionSource: "official-results",
        resolutionRules: "Official result decides.",
        oracleSourcePolicy: null,
        marketContract: {
          objectType: "market_contract_v1",
          version: "seer-contract-v1",
          resultShape: "home_away_winner",
          outcomeMap: [
            { outcomeLabel: "Team A", outcomeKind: "named-outcome" },
            { outcomeLabel: "Team B", outcomeKind: "named-outcome" }
          ]
        },
        liquidityB: "1000.00000000",
        closeOnEventCompletion: false,
        eventCompletionCloseRequiresHumanApproval: false,
        outcomes: [
          {
            outcomeId: "winner-named-sides-team-a",
            label: "Team A",
            shortLabel: null,
            description: null,
            colorKey: null
          },
          {
            outcomeId: "winner-named-sides-team-b",
            label: "Team B",
            shortLabel: null,
            description: null,
            colorKey: null
          }
        ],
        idempotencyKey: "create:named-sides"
      },
      ADMIN_ACTOR
    );

    expect(JSON.parse(state.marketContractJson ?? "{}").displayHints).toMatchObject({
      binaryPresentation: "named_opponents",
      affirmativeLabel: "Team A",
      negativeLabel: "Team B"
    });
  });

  it("returns stored response for completed idempotent retry", async () => {
    const { pool } = createDbPool({
      completedResponse: {
        marketId: "existing-market",
        eventId: "evt_existing-market",
        status: "draft",
        createdAt: "2026-04-01T09:00:00.000Z",
        openAt: "2026-04-01T10:00:00.000Z",
        closeAt: "2026-04-08T10:00:00.000Z",
        outcomeIds: ["existing-market-outcome-a", "existing-market-outcome-b"],
        auditEventId: "audit_1"
      }
    });

    const response = await createMarketDraft(
      pool,
      {
        marketId: "existing-market",
        familyKey: null,
        eventId: null,
        eventTitle: null,
        eventDescription: null,
        eventIcon: null,
        title: "Existing market",
        description: null,
        categoryKey: null,
        openAt: "2026-04-01T10:00:00.000Z",
        closeAt: "2026-04-08T10:00:00.000Z",
        resolutionSource: "official-results",
        resolutionRules: "Official result decides.",
        oracleSourcePolicy: null,
        marketContract: null,
        liquidityB: "1000.00000000",
        closeOnEventCompletion: false,
        eventCompletionCloseRequiresHumanApproval: false,
        outcomes: [
          {
            outcomeId: "existing-market-outcome-a",
            label: "Candidate A",
            shortLabel: null,
            description: null,
            colorKey: null
          },
          {
            outcomeId: "existing-market-outcome-b",
            label: "Candidate B",
            shortLabel: null,
            description: null,
            colorKey: null
          }
        ],
        idempotencyKey: "create:2"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      marketId: "existing-market",
      status: "draft"
    });
  });

  it("rejects idempotency conflict for different payload replay", async () => {
    const { pool } = createDbPool({
      conflictingRequestHash: "different"
    });

    await expect(
      createMarketDraft(
        pool,
        {
          marketId: "conflict-market",
          familyKey: null,
          eventId: null,
          eventTitle: null,
          eventDescription: null,
          eventIcon: null,
          title: "Conflict market",
          description: null,
          categoryKey: null,
          openAt: "2026-04-01T10:00:00.000Z",
          closeAt: "2026-04-08T10:00:00.000Z",
          resolutionSource: "official-results",
          resolutionRules: "Official result decides.",
          oracleSourcePolicy: null,
          marketContract: null,
          liquidityB: "1000.00000000",
          closeOnEventCompletion: false,
          eventCompletionCloseRequiresHumanApproval: false,
          outcomes: [
            {
              outcomeId: "conflict-market-outcome-a",
              label: "Candidate A",
              shortLabel: null,
              description: null,
              colorKey: null
            },
            {
              outcomeId: "conflict-market-outcome-b",
              label: "Candidate B",
              shortLabel: null,
              description: null,
              colorKey: null
            }
          ],
          idempotencyKey: "create:3"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<CreateMarketDraftServiceError>>({
      statusCode: 409,
      code: "idempotency_conflict"
    });
  });

  it("parses optional oracle source policy", () => {
    const request = parseCreateMarketDraftRequest({
      title: "Who wins?",
      openAt: "2026-04-01T09:00:00Z",
      closeAt: "2026-04-02T09:00:00Z",
      resolutionSource: "iec",
      resolutionRules: "winner is official result",
      eventResolutionPolicy: "exclusive_first_hit",
      oracleSourcePolicy: {
        preferredSourceIds: ["src_central_elections_committee"],
        contextSourceIds: ["src_market_launch_wire"],
        closeConditionSourceIds: ["src_knesset_feed"],
        resolutionSourceIds: ["src_central_elections_committee"],
        requiresHumanReviewOnWeakAuthority: true,
        notes: ["Prefer official publication before review media."]
      },
      marketContract: {
        objectType: "market_contract_v1",
        version: "seer-contract-v1",
        delayPolicy: "If delayed, keep the market pending until official update."
      },
      liquidityB: "1000.00000000",
      outcomes: [{ label: "A" }, { label: "B" }],
      idempotencyKey: "create:4"
    });

    expect(request.oracleSourcePolicy).toEqual({
      preferredSourceIds: ["src_central_elections_committee"],
      contextSourceIds: ["src_market_launch_wire"],
      closeConditionSourceIds: ["src_knesset_feed"],
      resolutionSourceIds: ["src_central_elections_committee"],
      requiresHumanReviewOnWeakAuthority: true,
      notes: ["Prefer official publication before review media."]
    });
    expect(request.marketContract).toMatchObject({
      objectType: "market_contract_v1",
      delayPolicy: "If delayed, keep the market pending until official update."
    });
    expect(request.eventResolutionPolicy).toBe("exclusive_first_hit");
  });

  it("rejects invalid event resolution policy", () => {
    expect(() =>
      parseCreateMarketDraftRequest({
        title: "Who wins?",
        openAt: "2026-04-01T09:00:00Z",
        closeAt: "2026-04-02T09:00:00Z",
        resolutionSource: "iec",
        resolutionRules: "winner is official result",
        eventResolutionPolicy: "void_siblings",
        liquidityB: "1000.00000000",
        outcomes: [{ label: "A" }, { label: "B" }],
        idempotencyKey: "create:invalid-policy"
      })
    ).toThrowError(/eventResolutionPolicy/);
  });

  it("rejects non market_contract_v1 contract payloads", () => {
    expect(() =>
      parseCreateMarketDraftRequest({
        title: "Who wins?",
        openAt: "2026-04-01T09:00:00Z",
        closeAt: "2026-04-02T09:00:00Z",
        resolutionSource: "iec",
        resolutionRules: "winner is official result",
        marketContract: {
          objectType: "flat_resolution_rules"
        },
        liquidityB: "1000.00000000",
        outcomes: [{ label: "A" }, { label: "B" }],
        idempotencyKey: "create:5"
      })
    ).toThrowError(/market_contract_v1/);
  });
});
