import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  parsePublishMarketRequest,
  publishMarket,
  PublishMarketServiceError
} from "../../../src/lifecycle/management/publish-market-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: {
  marketStatus?: "draft" | "open";
  completedResponse?: unknown;
  conflictingRequestHash?: string;
  platformBalance?: string;
  hasExistingTreasury?: boolean;
  marketContract?: unknown;
  liquidityB?: string;
  categoryKey?: string | null;
  familyKey?: string | null;
}) {
  const marketContract = options?.marketContract ?? {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "binary_yes_no",
    oracleCapability: "supported_final_only",
    resolutionSource: {
      sourceIds: ["src_official_fixture"],
      url: "https://example.com/final"
    }
  };
  const state = {
    existingRequestHash: null as string | null,
    market: {
      id: "market_draft_1",
      status: options?.marketStatus ?? "draft",
      title: "Draft market",
      category_key: options?.categoryKey ?? "politics",
      market_family_key: options?.familyKey ?? null,
      open_at: new Date("2026-04-01T10:00:00Z"),
      close_at: new Date("2099-07-10T10:00:00Z"),
      published_at: null as Date | null,
      liquidity_b: options?.liquidityB ?? "100.00000000",
      market_treasury_account_id: options?.hasExistingTreasury ? "account_market_draft_1_treasury" : null,
      market_contract: marketContract
    },
    outcomes: [
      { id: "draft_outcome_a", market_id: "market_draft_1", sort_order: 0 },
      { id: "draft_outcome_b", market_id: "market_draft_1", sort_order: 1 }
    ],
    accounts: {
      account_platform_treasury_1: {
        id: "account_platform_treasury_1",
        type: "platform_treasury",
        status: "active",
        balance_cached: options?.platformBalance ?? "500.000000"
      }
    } as Record<string, { id: string; type: string; status: string; balance_cached: string }>,
    pricingInserted: false,
    outcomeStateCount: 0,
    openingCandleSeeded: false,
    openingCandleAtMs: null as number | null,
    auditWritten: false,
    ledgerWritten: false,
    createdTreasury: false,
    tags: [] as Array<{ id: string; slug: string; label: string; kind: string | null }>,
    marketTags: [] as Array<{ marketId: string; tagId: string; weight: number }>,
    lifecycleEvents: [] as Array<Record<string, unknown>>
  };

  if (options?.hasExistingTreasury) {
    state.accounts.account_market_draft_1_treasury = {
      id: "account_market_draft_1_treasury",
      type: "market_treasury",
      status: "active",
      balance_cached: "0.000000"
    };
  }

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

          return { rows: [{ id: "idem_publish_1" }], rowCount: 1 };
        }

        if (sql.includes("from idempotency_records")) {
          return {
            rows: [
              {
                id: "idem_publish_1",
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

        if (sql.includes("where type = 'platform_treasury'")) {
          return { rows: [state.accounts.account_platform_treasury_1], rowCount: 1 };
        }

        if (sql.includes("pg_advisory_xact_lock")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("where id = $1") && sql.includes("from accounts")) {
          const accountId = String(values?.[0]);
          const account = state.accounts[accountId];
          return { rows: account ? [account] : [], rowCount: account ? 1 : 0 };
        }

        if (sql.includes("insert into accounts")) {
          state.createdTreasury = true;
          state.accounts[String(values?.[0])] = {
            id: String(values?.[0]),
            type: "market_treasury",
            status: "active",
            balance_cached: "0.000000"
          };
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update accounts")) {
          const accountId = String(values?.[0]);
          state.accounts[accountId] = {
            ...state.accounts[accountId],
            balance_cached: String(values?.[1])
          };
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("select sequence_number, transaction_hash")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("insert into ledger_transactions")) {
          state.ledgerWritten = true;
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into ledger_entries")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into market_pricing_state")) {
          state.pricingInserted = true;
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into market_outcome_state")) {
          state.outcomeStateCount += 1;
          return { rows: [], rowCount: 1 };
        }

        // appendBaseCandleFromState reads the opening prices to seed the candle.
        if (sql.includes("from market_outcome_state")) {
          return {
            rows: [
              { outcome_id: "outcome_yes", last_price: "0.50000000" },
              { outcome_id: "outcome_no", last_price: "0.50000000" }
            ],
            rowCount: 2
          };
        }

        // Opening base candle seeded at publish (the open-seed fix).
        if (sql.includes("insert into market_base_candles")) {
          state.openingCandleSeeded = true;
          state.openingCandleAtMs =
            values?.[1] instanceof Date ? values[1].getTime() : Number(values?.[1]);
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into tags")) {
          state.tags.push({
            id: String(values?.[0]),
            slug: String(values?.[1]),
            label: String(values?.[2]),
            kind: values?.[3] == null ? null : String(values?.[3])
          });
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into market_tags")) {
          state.marketTags.push({
            marketId: String(values?.[0]),
            tagId: String(values?.[1]),
            weight: Number(values?.[2])
          });
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update markets")) {
          state.market = {
            ...state.market,
            status: "open",
            open_at: new Date(String(values?.[1])),
            published_at: new Date(String(values?.[1])),
            market_treasury_account_id: String(values?.[2])
          };
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into audit_events")) {
          state.auditWritten = true;
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into lifecycle_events")) {
          state.lifecycleEvents.push({
            eventType: values?.[2],
            sourceSystem: values?.[3],
            actorId: values?.[4],
            marketId: values?.[1],
            auditEventId: values?.[8],
            payload: JSON.parse(String(values?.[11]))
          });
          return { rows: [{ id: "lifevt_publish_1" }], rowCount: 1 };
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

describe("parsePublishMarketRequest", () => {
  it("requires positive seedAmount and idempotencyKey", () => {
    expect(() =>
      parsePublishMarketRequest({
        seedAmount: "0",
        idempotencyKey: "publish:1"
      })
    ).toThrowError(/seedAmount must be greater than zero/);
  });
});

describe("publish market service", () => {
  it("publishes a draft market and initializes treasury + pricing", async () => {
    const { pool, state } = createDbPool();

    const response = await publishMarket(
      pool,
      "market_draft_1",
      {
        publishAt: null,
        seedAmount: "100.000000",
        note: "Ready for launch.",
        reviewId: "review_1",
        checklistVersion: "v1",
        managementApprovedAt: "2026-04-01T09:00:00Z",
        idempotencyKey: "publish:1"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      marketId: "market_draft_1",
      status: "open",
      marketTreasuryAccountId: "account_market_draft_1_treasury",
      marketStateVersion: 0
    });
    expect(state.createdTreasury).toBe(true);
    expect(state.pricingInserted).toBe(true);
    expect(state.outcomeStateCount).toBe(2);
    // Opening base candle seeded at publish so the chart has a baseline from open.
    expect(state.openingCandleSeeded).toBe(true);
    expect(state.ledgerWritten).toBe(true);
    expect(state.auditWritten).toBe(true);
    expect(state.tags).toEqual([
      { id: "tag-politics", slug: "politics", label: "פוליטיקה", kind: "topic" }
    ]);
    expect(state.marketTags).toEqual([
      { marketId: "market_draft_1", tagId: "tag-politics", weight: 0 }
    ]);
    expect(state.lifecycleEvents).toEqual([
      expect.objectContaining({
        eventType: "market_published",
        sourceSystem: "back",
        marketId: "market_draft_1",
        payload: expect.objectContaining({
          reserveCheck: {
            policy: "lmsr_reserve_floor",
            liquidityB: "100.00000000",
            outcomeCount: 2,
            requiredReserve: "69.314719",
            seedAmount: "100.000000",
            marketTreasuryBalanceBefore: "0.000000",
            marketTreasuryBalanceAfter: "100.000000",
            platformTreasuryBalanceBefore: "500.000000",
            platformTreasuryBalanceAfter: "400.000000",
            coverageStatus: "covered"
          },
          relatedTags: [
            {
              slug: "politics",
              label: "פוליטיקה",
              kind: "topic",
              weight: 0
            }
          ],
          familyGate: {
            measurementKind: "final_winner",
            resultShape: "binary_yes_no",
            sourceIds: ["src_official_fixture"],
            oracleCapability: "supported_final_only"
          }
        })
      })
    ]);
    expect(state.market.status).toBe("open");
    expect(state.market.open_at.toISOString()).toBe(response.publishedAt);
    expect(state.market.published_at?.toISOString()).toBe(response.publishedAt);
    expect(state.accounts.account_platform_treasury_1.balance_cached).toBe("400.000000");
    expect(state.accounts.account_market_draft_1_treasury.balance_cached).toBe("100.000000");
  });

  it("uses an explicit publishAt as the market openAt", async () => {
    const { pool, state } = createDbPool();

    const response = await publishMarket(
      pool,
      "market_draft_1",
      {
        publishAt: "2026-04-02T12:34:56.789Z",
        seedAmount: "100.000000",
        note: "Ready for launch.",
        reviewId: null,
        checklistVersion: null,
        managementApprovedAt: null,
        idempotencyKey: "publish:explicit-time"
      },
      ADMIN_ACTOR
    );

    expect(response.publishedAt).toBe("2026-04-02T12:34:56.789Z");
    expect(state.market.open_at.toISOString()).toBe("2026-04-02T12:34:56.789Z");
    expect(state.market.published_at?.toISOString()).toBe("2026-04-02T12:34:56.789Z");
    expect(state.openingCandleAtMs).toBe(Date.parse("2026-04-02T12:34:00.000Z"));
  });

  it("rejects publishAt after market closeAt", async () => {
    const { pool } = createDbPool();

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: "2099-07-10T10:00:00.000Z",
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:after-close"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "publish_after_close"
    });
  });

  it("rejects publish when seed does not cover the LMSR reserve floor", async () => {
    const { pool } = createDbPool({
      liquidityB: "1000.00000000",
      platformBalance: "5000.000000"
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:reserve-underfunded"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "market_reserve_underfunded"
    });
  });

  it("rejects publish for non-draft market", async () => {
    const { pool } = createDbPool({
      marketStatus: "open"
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:2"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "market_not_publishable"
    });
  });

  it("rejects scheduled-event publish when closeAt is after known event start", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_score",
        resultShape: "multi_outcome",
        oracleCapability: "supported_final_only",
        lifecycleFit: "event_full_cycle",
        eventStartAt: "2026-04-10T09:00:00.000Z",
        resolutionSource: {
          sourceIds: ["src_official_fixture"],
          url: "https://example.com/final"
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:close-after-event"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "close_after_event_start"
    });
  });

  it("allows non-scheduled markets even when eventStartAt metadata is present", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "reported_claim",
        resultShape: "binary_yes_no",
        oracleCapability: "credible_reporting",
        category: "credible_reporting",
        eventStartAt: "2026-04-10T09:00:00.000Z",
        resolutionSource: {
          sourceIds: ["src_credible_reporting_bundle"],
          url: "internal://oracle/credible-reporting"
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:non-scheduled-event-start"
        },
        ADMIN_ACTOR
      )
    ).resolves.toMatchObject({
      marketId: "market_draft_1",
      status: "open"
    });
  });

  it("does not let request eventCategory override scheduled contract metadata", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_score",
        resultShape: "multi_outcome",
        oracleCapability: "supported_final_only",
        lifecycleFit: "event_full_cycle",
        eventStartAt: "2026-04-10T09:00:00.000Z",
        resolutionSource: {
          sourceIds: ["src_official_fixture"],
          url: "https://example.com/final"
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          eventCategory: "credible_reporting",
          idempotencyKey: "publish:category-override"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "close_after_event_start"
    });
  });

  it("allows explicit credible-reporting family capability through the publish gate", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "reported_claim",
        resultShape: "yes_no",
        oracleCapability: "credible_reporting",
        resolutionSource: {
          sourceIds: ["src_credible_reporting_bundle"],
          url: "internal://oracle/credible-reporting"
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:credible-reporting"
        },
        ADMIN_ACTOR
      )
    ).resolves.toMatchObject({
      marketId: "market_draft_1",
      status: "open"
    });
  });

  it("rejects publish when platform treasury is insufficient", async () => {
    const { pool } = createDbPool({
      platformBalance: "50.000000"
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:3"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "insufficient_funds"
    });
  });

  it("rejects publish when the source family is missing classification", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "binary_yes_no",
        resolutionSource: {
          sourceIds: ["src_unknown"]
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:family-missing"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "market_family_not_classified"
    });
  });

  it("rejects publish when the source family is explicitly blocked", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "celebrity_statement",
        resultShape: "binary_yes_no",
        oracleCapability: "blocked",
        resolutionSource: {
          sourceIds: ["src_social_video_clip"]
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:family-blocked"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "market_family_not_classified"
    });
  });

  it("allows explicit manual-resolution families through publish", async () => {
    const { pool, state } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "credible_report_outcome",
        resultShape: "binary_yes_no",
        oracleCapability: "manual_resolution_required",
        resolutionSource: {
          sourceIds: ["src_two_credible_reports"]
        }
      }
    });

    await publishMarket(
      pool,
      "market_draft_1",
      {
        publishAt: null,
        seedAmount: "100.000000",
        note: null,
        reviewId: null,
        checklistVersion: null,
        managementApprovedAt: null,
        idempotencyKey: "publish:manual-family"
      },
      ADMIN_ACTOR
    );

    expect(state.lifecycleEvents[0]).toMatchObject({
      payload: {
        familyGate: {
          measurementKind: "credible_report_outcome",
          resultShape: "binary_yes_no",
          sourceIds: ["src_two_credible_reports"],
          oracleCapability: "manual_resolution_required"
        }
      }
    });
  });

  it("requires fallback policy for supported IFA markets", async () => {
    const { pool } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_score",
        resultShape: "multi_outcome",
        oracleCapability: "supported_final_only",
        lifecycleFit: "event_full_cycle",
        resolutionSource: {
          sourceIds: ["src_ifa_fixtures_results"],
          url: "https://www.football.org.il/"
        }
      }
    });

    await expect(
      publishMarket(
        pool,
        "market_draft_1",
        {
          publishAt: null,
          seedAmount: "100.000000",
          note: null,
          reviewId: null,
          checklistVersion: null,
          managementApprovedAt: null,
          idempotencyKey: "publish:ifa-no-fallback"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<PublishMarketServiceError>>({
      statusCode: 409,
      code: "market_fallback_policy_required"
    });
  });

  it("allows IFA markets with an explicit fallback evidence standard", async () => {
    const { pool, state } = createDbPool({
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_score",
        resultShape: "multi_outcome",
        oracleCapability: "supported_final_only",
        lifecycleFit: "event_full_cycle",
        allowFallbackResolution: true,
        fallbackEvidenceStandard: "two_independent_reports",
        resolutionSource: {
          sourceIds: ["src_ifa_fixtures_results"],
          url: "https://www.football.org.il/"
        }
      }
    });

    await publishMarket(
      pool,
      "market_draft_1",
      {
        publishAt: null,
        seedAmount: "100.000000",
        note: null,
        reviewId: null,
        checklistVersion: null,
        managementApprovedAt: null,
        idempotencyKey: "publish:ifa-fallback"
      },
      ADMIN_ACTOR
    );

    expect(state.lifecycleEvents[0]).toMatchObject({
      payload: {
        familyGate: {
          measurementKind: "final_score",
          resultShape: "multi_outcome",
          sourceIds: ["src_ifa_fixtures_results"],
          lifecycleFit: "event_full_cycle",
          allowFallbackResolution: true,
          fallbackEvidenceStandard: "two_independent_reports",
          oracleCapability: "supported_final_only"
        }
      }
    });
  });

  it("replays a completed idempotent response", async () => {
    const replayResponse = {
      marketId: "market_draft_1",
      status: "open",
      publishedAt: "2026-04-01T10:00:00.000Z",
      marketTreasuryAccountId: "account_market_draft_1_treasury",
      seedTransactionId: "ledger_tx_1",
      marketStateVersion: 0,
      auditEventId: "audit_publish_1"
    };
    const { pool, state } = createDbPool({
      completedResponse: replayResponse
    });

    const response = await publishMarket(
      pool,
      "market_draft_1",
      {
        publishAt: null,
        seedAmount: "100.000000",
        note: null,
        reviewId: null,
        checklistVersion: null,
        managementApprovedAt: null,
        idempotencyKey: "publish:4"
      },
      ADMIN_ACTOR
    );

    expect(response).toEqual(replayResponse);
    expect(state.ledgerWritten).toBe(false);
    expect(state.auditWritten).toBe(false);
    expect(state.lifecycleEvents).toHaveLength(0);
  });
});
