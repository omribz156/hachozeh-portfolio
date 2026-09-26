import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import type { RequestActor } from "../auth/actor-resolver";
import { closeMarket } from "../lifecycle/horizon/close-market-service";
import {
  approveOracleCloseConditionCase,
  approveOracleResolutionCase,
  OracleReviewActionError
} from "../../../oracle/src/review-action-service";
import { inspectOracleMarket } from "../../../oracle/src/inspect-market-service";

type DummyMarketConfig = {
  marketId: string;
  title: string;
  openAt: string;
  closeAt: string;
  closeOnEventCompletion: boolean;
  eventId?: string;
  eventChildLabel?: string;
};

type GauntletMarketResult = {
  marketId: string;
  title: string;
  assertions: string[];
  rejectedCloseCondition?: unknown;
  close: unknown;
  resolution: unknown;
  eventProof?: unknown;
};

type RunOptions = {
  cleanup: boolean;
  dryRun: boolean;
  runId: string;
  smoke: boolean;
};

const ACTOR: RequestActor = {
  actorId: "oracle_eol_gauntlet_operator",
  mode: "session",
  sessionId: "oracle_eol_gauntlet",
  role: "admin"
};

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function parseBooleanFlag(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (rawValue == null) {
    return defaultValue;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  throw new Error(`Expected boolean flag value, got: ${rawValue}`);
}

function readFlagValue(args: string[], flagName: string): string | undefined {
  const index = args.indexOf(flagName);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function hasFlag(args: string[], flagName: string): boolean {
  return args.includes(flagName);
}

function createRunId(): string {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function parseRunOptions(args: string[]): RunOptions {
  const smoke = hasFlag(args, "--smoke");
  const keepFixtures = hasFlag(args, "--keep-fixtures");
  const explicitCleanup = readFlagValue(args, "--cleanup");

  return {
    cleanup: keepFixtures ? false : parseBooleanFlag(explicitCleanup, smoke),
    dryRun: hasFlag(args, "--dry-run"),
    runId: readFlagValue(args, "--run-id") ?? createRunId(),
    smoke
  };
}

function assertCondition(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Oracle EOL smoke assertion failed: ${message}`);
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  assertCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertCloseResponse(
  value: unknown,
  triggerType: "scheduled_time" | "oracle_confirmed_event_completion",
  marketId: string
): string {
  const record = readRecord(value, "close response");
  assertCondition(record.marketId === marketId, `close marketId must be ${marketId}`);
  assertCondition(record.status === "closed", "close status must be closed");
  assertCondition(record.triggerType === triggerType, `close trigger must be ${triggerType}`);
  assertCondition(typeof record.auditEventId === "string", "close must write auditEventId");
  return `close:${triggerType}`;
}

function assertReviewResolution(value: unknown, marketId: string): string {
  const record = readRecord(value, "resolution review");
  const resolution = readRecord(record.resolution, "resolution payload");

  assertCondition(record.outcome === "approved_resolution", "resolution review must be approved");
  assertCondition(resolution.marketId === marketId, `resolution marketId must be ${marketId}`);
  assertCondition(resolution.status === "resolved", "resolution status must be resolved");
  assertCondition(resolution.settlementStatus === "completed", "settlement must complete");
  assertCondition(typeof resolution.auditEventId === "string", "resolution must write auditEventId");

  return "resolve:approved";
}

function assertCloseReview(value: unknown, marketId: string): string {
  const record = readRecord(value, "close-condition review");
  const close = readRecord(record.close, "close-condition close payload");

  assertCondition(record.outcome === "approved_close_condition", "close-condition review must be approved");
  assertCloseResponse(close, "oracle_confirmed_event_completion", marketId);

  return "close-condition:approved";
}

async function ensurePlatformTreasury(dbPool: Pool): Promise<void> {
  await dbPool.query(
    `
      insert into accounts (id, type, owner_id, status, balance_cached)
      select 'acct_platform_treasury_oracle_eol', 'platform_treasury', 'platform', 'active', '0.000000'
      where not exists (
        select 1
        from accounts
        where type = 'platform_treasury'
      )
    `
  );
}

async function resetDummyMarket(dbPool: Pool, config: DummyMarketConfig): Promise<void> {
  const treasuryAccountId = `acct_${config.marketId}_treasury`;
  const yesOutcomeId = `${config.marketId}_outcome_yes`;
  const noOutcomeId = `${config.marketId}_outcome_no`;

  await withTransaction(dbPool, async (client) => {
    await client.query("delete from oracle_case_reviews where market_id = $1", [config.marketId]);
    await client.query("delete from oracle_case_outputs where market_id = $1", [config.marketId]);
    await client.query("delete from oracle_evidence_packets where market_id = $1", [config.marketId]);
    await client.query("delete from oracle_cases where market_id = $1", [config.marketId]);
    await client.query("delete from lifecycle_events where market_id = $1", [config.marketId]);
    await client.query("delete from market_resolutions where market_id = $1", [config.marketId]);
    await client.query("delete from idempotency_records where resource_id = $1", [config.marketId]);

    await client.query(
      `
        insert into accounts (id, type, owner_id, status, balance_cached)
        values ($1, 'market_treasury', $2, 'active', '0.000000')
        on conflict (id) do update
        set status = 'active',
            balance_cached = '0.000000',
            updated_at = now()
      `,
      [treasuryAccountId, config.marketId]
    );

    await client.query(
      `
        insert into markets (
          id,
          status,
          title,
          description,
          category_key,
          open_at,
          close_at,
          published_at,
          closed_at,
          resolved_at,
          settlement_status,
          resolution_source,
          resolution_rules,
          liquidity_b,
          market_treasury_account_id,
          created_by,
          close_on_event_completion,
          event_completion_close_requires_human_approval,
          oracle_source_policy,
          event_id,
          event_child_label
        )
        values (
          $1,
          'open',
          $2,
          'Oracle EOL gauntlet dummy market.',
          'oracle-eol',
          $3,
          $4,
          $3,
          null,
          null,
          null,
          'Oracle EOL gauntlet',
          'Dummy market resolves YES when the gauntlet reaches resolution approval.',
          '100.00000000',
          $5,
          'oracle_eol_gauntlet',
          $6,
          $7,
          $8::jsonb,
          $9,
          $10
        )
        on conflict (id) do update
        set status = 'open',
            title = excluded.title,
            open_at = excluded.open_at,
            close_at = excluded.close_at,
            published_at = excluded.published_at,
            closed_at = null,
            resolved_at = null,
            settlement_status = null,
            market_treasury_account_id = excluded.market_treasury_account_id,
            close_on_event_completion = excluded.close_on_event_completion,
            event_completion_close_requires_human_approval = excluded.event_completion_close_requires_human_approval,
            oracle_source_policy = excluded.oracle_source_policy,
            event_id = excluded.event_id,
            event_child_label = excluded.event_child_label,
            updated_at = now()
      `,
      [
        config.marketId,
        config.title,
        config.openAt,
        config.closeAt,
        treasuryAccountId,
        config.closeOnEventCompletion,
        config.closeOnEventCompletion,
        JSON.stringify({
          closeConditionSourceIds: ["src_oracle_eol_dummy"],
          resolutionSourceIds: ["src_oracle_eol_dummy"],
          notes: [
            "ground-role=Oracle EOL gauntlet dummy source",
            "resolve-role=Oracle EOL gauntlet dummy source"
          ]
        }),
        config.eventId ?? null,
        config.eventChildLabel ?? null
      ]
    );

    for (const [index, outcome] of [
      { id: yesOutcomeId, label: "Yes" },
      { id: noOutcomeId, label: "No" }
    ].entries()) {
      await client.query(
        `
          insert into market_outcomes (id, market_id, label, short_label, sort_order, is_winner)
          values ($1, $2, $3, $3, $4, null)
          on conflict (id) do update
          set label = excluded.label,
              short_label = excluded.short_label,
              sort_order = excluded.sort_order,
              is_winner = null,
              updated_at = now()
        `,
        [outcome.id, config.marketId, outcome.label, index]
      );

      await client.query(
        `
          insert into market_outcome_state (market_id, outcome_id, q_shares, last_price)
          values ($1, $2, '0.000000', '0.50000000')
          on conflict (market_id, outcome_id) do update
          set q_shares = '0.000000',
              last_price = '0.50000000',
              updated_at = now()
        `,
        [config.marketId, outcome.id]
      );
    }

    await client.query(
      `
        insert into market_pricing_state (market_id, version, liquidity_b, total_volume)
        values (
          $1,
          0,
          '100.00000000',
          coalesce((select sum(cash_amount) from trades where market_id = $1), 0)
        )
        on conflict (market_id) do update
        set version = 0,
            liquidity_b = '100.00000000',
            -- Recompute from surviving trades so the denormalized volume
            -- never drifts across gauntlet resets (audit:total-volume).
            total_volume = coalesce(
              (select sum(cash_amount) from trades where market_id = $1),
              0
            ),
            updated_at = now()
      `,
      [config.marketId]
    );
  });
}

async function resetDummyEvent(dbPool: Pool, input: { eventId: string; title: string }): Promise<void> {
  await dbPool.query(
    `
      insert into events (
        id,
        slug,
        title,
        description,
        icon,
        category_key,
        market_family_key,
        resolution_policy,
        sibling_resolution_requires_human_approval,
        status,
        display_flags
      )
      values (
        $1,
        $1,
        $2,
        'Oracle EOL gauntlet synthetic independent-children event.',
        null,
        'oracle-eol',
        'oracle-eol-gauntlet',
        'independent_children',
        true,
        'active',
        '{}'::jsonb
      )
      on conflict (id) do update
      set slug = excluded.slug,
          title = excluded.title,
          description = excluded.description,
          icon = excluded.icon,
          category_key = excluded.category_key,
          market_family_key = excluded.market_family_key,
          resolution_policy = excluded.resolution_policy,
          sibling_resolution_requires_human_approval = excluded.sibling_resolution_requires_human_approval,
          status = excluded.status,
          display_flags = excluded.display_flags,
          updated_at = now()
    `,
    [input.eventId, input.title]
  );
}

async function cleanupDummyMarkets(
  dbPool: Pool,
  marketIds: string[],
  runId: string,
  eventIds: string[] = []
): Promise<number> {
  const treasuryAccountIds = marketIds.map((marketId) => `acct_${marketId}_treasury`);

  await withTransaction(dbPool, async (client) => {
    await client.query("delete from oracle_case_reviews where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from oracle_case_outputs where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from oracle_evidence_packets where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from oracle_cases where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from lifecycle_events where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from realization_events where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from market_resolutions where market_id = any($1::text[])", [marketIds]);
    await client.query(
      "delete from idempotency_records where resource_id = any($1::text[]) or idempotency_key like $2",
      [marketIds, `%${runId}%`]
    );
    await client.query("delete from trades where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from positions where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from contract_positions where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from market_outcome_state where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from market_pricing_state where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from market_outcomes where market_id = any($1::text[])", [marketIds]);
    await client.query("delete from markets where id = any($1::text[])", [marketIds]);
    if (eventIds.length > 0) {
      await client.query("delete from events where id = any($1::text[])", [eventIds]);
    }
    await client.query("delete from accounts where id = any($1::text[])", [treasuryAccountIds]);
  });

  return marketIds.length;
}

async function assertIndependentEventPartialResolution(
  dbPool: Pool,
  input: {
    eventId: string;
    resolvedMarketId: string;
    openSiblingMarketId: string;
  }
): Promise<Record<string, unknown>> {
  const { rows } = await dbPool.query<{
    event_id: string;
    event_status: string;
    resolution_policy: string;
    market_id: string;
    market_status: string;
    winning_outcome_id: string | null;
  }>(
    `
      select
        e.id as event_id,
        e.status as event_status,
        e.resolution_policy,
        m.id as market_id,
        m.status as market_status,
        mr.winning_outcome_id
      from events e
      join markets m
        on m.event_id = e.id
      left join market_resolutions mr
        on mr.market_id = m.id
      where e.id = $1
      order by m.id asc
    `,
    [input.eventId]
  );

  const resolvedChild = rows.find((row) => row.market_id === input.resolvedMarketId);
  const openSibling = rows.find((row) => row.market_id === input.openSiblingMarketId);

  assertCondition(rows.length === 2, "event partial proof must have exactly two child markets");
  assertCondition(rows[0]?.event_status === "active", "event parent must remain active while a sibling is open");
  assertCondition(rows[0]?.resolution_policy === "independent_children", "event policy must be independent_children");
  assertCondition(resolvedChild?.market_status === "resolved", "trigger child must resolve");
  assertCondition(typeof resolvedChild?.winning_outcome_id === "string", "trigger child must have a winner");
  assertCondition(openSibling?.market_status === "open", "unrelated sibling child must stay open");
  assertCondition(openSibling?.winning_outcome_id == null, "unrelated sibling child must not receive a winner");

  return {
    objectType: "oracle_eol_independent_event_partial_resolution_proof",
    eventId: input.eventId,
    eventStatus: rows[0]?.event_status,
    resolutionPolicy: rows[0]?.resolution_policy,
    resolvedChild: {
      marketId: resolvedChild?.market_id,
      status: resolvedChild?.market_status,
      winningOutcomeId: resolvedChild?.winning_outcome_id
    },
    openSibling: {
      marketId: openSibling?.market_id,
      status: openSibling?.market_status,
      winningOutcomeId: openSibling?.winning_outcome_id
    }
  };
}

async function resolveDummyMarket(
  dbPool: Pool,
  marketId: string,
  runId: string
) {
  const inspection = await inspectOracleMarket(
    dbPool,
    {
      marketId,
      caseType: "resolution_check",
      sources: [
        {
          sourceId: "src_oracle_eol_dummy",
          sourceUrl: `https://example.com/oracle-eol/${runId}/${marketId}/resolution`,
          sourceLabel: "Oracle EOL dummy source",
          sourceType: "official",
          claimSummary: "Dummy gauntlet source confirms YES as the winning outcome."
        }
      ],
      winningOutcomeId: `${marketId}_outcome_yes`,
      reasonSummary: "Dummy gauntlet source confirms YES."
    },
    {
      persistResult: true
    }
  );

  return approveOracleResolutionCase(dbPool, inspection.oracleCase.oracleCaseId, ACTOR, {
    reviewNote: "EOL gauntlet approved dummy resolution.",
    idempotencyKey: `oracle-eol-resolve:${runId}:${marketId}`
  });
}

async function runScheduledCloseGauntlet(
  dbPool: Pool,
  runId: string
): Promise<GauntletMarketResult> {
  const market: DummyMarketConfig = {
    marketId: `oracle_dummy_close_in_5_min_${runId}`,
    title: "will this market close in 5 min",
    openAt: minutesAgo(6),
    closeAt: secondsAgo(5),
    closeOnEventCompletion: false
  };

  await resetDummyMarket(dbPool, market);

  const close = await closeMarket(
    dbPool,
    market.marketId,
    {
      triggerType: "scheduled_time",
      reason: "Dummy market reached its 5-minute scheduled EOL.",
      sourceUrl: null,
      note: market.title,
      oracleCaseId: null,
      triggeredByOracleId: null,
      approvedByHumanId: null,
      idempotencyKey: `oracle-eol-scheduled-close:${runId}:${market.marketId}`
    },
    ACTOR
  );
  const resolution = await resolveDummyMarket(dbPool, market.marketId, runId);

  return {
    marketId: market.marketId,
    title: market.title,
    assertions: [
      assertCloseResponse(close, "scheduled_time", market.marketId),
      assertReviewResolution(resolution, market.marketId)
    ],
    close,
    resolution
  };
}

async function rejectBadCloseCondition(
  dbPool: Pool,
  market: DummyMarketConfig,
  runId: string
): Promise<unknown> {
  const closeInspection = await inspectOracleMarket(
    dbPool,
    {
      marketId: market.marketId,
      caseType: "close_condition_check",
      sources: [
        {
          sourceId: "src_oracle_eol_dummy",
          sourceUrl: `https://example.com/oracle-eol/${runId}/${market.marketId}/not-ready`,
          sourceLabel: "Oracle EOL dummy source",
          sourceType: "official",
          claimSummary: "Dummy context says the event has not completed yet."
        }
      ],
      closeConditionSatisfied: false,
      reasonSummary: "Dummy context confirms this market is not ready to close."
    },
    {
      persistResult: true
    }
  );

  try {
    await approveOracleCloseConditionCase(
      dbPool,
      closeInspection.oracleCase.oracleCaseId,
      ACTOR,
      {
        reviewNote: "EOL smoke intentionally tried a not-ready close-condition case.",
        idempotencyKey: `oracle-eol-reject-close:${runId}:${market.marketId}`
      }
    );
  } catch (error) {
    const rejectionCode =
      error instanceof OracleReviewActionError
        ? error.code
        : error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "unknown";

    assertCondition(
      rejectionCode === "oracle_case_not_approvable" || rejectionCode === "oracle_case_not_reviewable",
      "bad close-condition approval must fail safely"
    );

    const { rows } = await dbPool.query("select status from markets where id = $1", [market.marketId]);
    assertCondition(rows[0]?.status === "open", "bad close-condition case must leave market open");

    return {
      oracleCaseId: closeInspection.oracleCase.oracleCaseId,
      rejected: true,
      code: rejectionCode
    };
  }

  throw new Error("Bad close-condition approval unexpectedly succeeded.");
}

async function runEarlyCloseGauntlet(
  dbPool: Pool,
  runId: string
): Promise<GauntletMarketResult> {
  const eventId = `evt_oracle_dummy_partial_${runId}`;
  const market: DummyMarketConfig = {
    marketId: `oracle_dummy_close_in_10_min_${runId}`,
    title: "will this market close in 10 min",
    openAt: minutesAgo(1),
    closeAt: minutesFromNow(9),
    closeOnEventCompletion: true,
    eventId,
    eventChildLabel: "early close child"
  };
  const sibling: DummyMarketConfig = {
    marketId: `oracle_dummy_still_open_${runId}`,
    title: "will sibling stay open",
    openAt: minutesAgo(1),
    closeAt: minutesFromNow(30),
    closeOnEventCompletion: true,
    eventId,
    eventChildLabel: "open sibling"
  };

  await resetDummyEvent(dbPool, {
    eventId,
    title: "Oracle EOL independent event partial-resolution proof"
  });
  await resetDummyMarket(dbPool, market);
  await resetDummyMarket(dbPool, sibling);

  const rejectedCloseCondition = await rejectBadCloseCondition(dbPool, market, runId);

  const closeInspection = await inspectOracleMarket(
    dbPool,
    {
      marketId: market.marketId,
      caseType: "close_condition_check",
      sources: [
        {
          sourceId: "src_oracle_eol_dummy",
          sourceUrl: `https://example.com/oracle-eol/${runId}/${market.marketId}/early-close`,
          sourceLabel: "Oracle EOL dummy source",
          sourceType: "official",
          claimSummary: "Dummy context says the event completed before scheduled EOL."
        }
      ],
      closeConditionSatisfied: true,
      reasonSummary: "Dummy context confirms early close condition."
    },
    {
      persistResult: true
    }
  );

  const close = await approveOracleCloseConditionCase(
    dbPool,
    closeInspection.oracleCase.oracleCaseId,
    ACTOR,
    {
      reviewNote: "EOL gauntlet approved dummy early close.",
      idempotencyKey: `oracle-eol-early-close:${runId}:${market.marketId}`
    }
  );
  const resolution = await resolveDummyMarket(dbPool, market.marketId, runId);
  const eventProof = await assertIndependentEventPartialResolution(dbPool, {
    eventId,
    resolvedMarketId: market.marketId,
    openSiblingMarketId: sibling.marketId
  });

  return {
    marketId: market.marketId,
    title: market.title,
    assertions: [
      "close-condition:rejects-not-ready",
      assertCloseReview(close, market.marketId),
      assertReviewResolution(resolution, market.marketId)
    ],
    rejectedCloseCondition,
    close,
    resolution,
    eventProof
  };
}

async function main(): Promise<void> {
  const options = parseRunOptions(process.argv.slice(2));

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          objectType: options.smoke ? "oracle_eol_smoke_plan" : "oracle_eol_gauntlet_plan",
          runId: options.runId,
          cleanup: options.cleanup,
          smoke: options.smoke,
          markets: [
            "will this market close in 5 min",
            "will this market close in 10 min",
            "will sibling stay open"
          ]
        },
        null,
        2
      )
    );
    return;
  }

  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    await ensurePlatformTreasury(dbPool);

    const scheduled = await runScheduledCloseGauntlet(dbPool, options.runId);
    const early = await runEarlyCloseGauntlet(dbPool, options.runId);
    const eventId =
      typeof early.eventProof === "object" &&
      early.eventProof !== null &&
      "eventId" in early.eventProof &&
      typeof early.eventProof.eventId === "string"
        ? early.eventProof.eventId
        : null;
    const openSiblingMarketId = `oracle_dummy_still_open_${options.runId}`;
    const marketIds = [scheduled.marketId, early.marketId, openSiblingMarketId];
    const cleanup = options.cleanup
      ? {
          enabled: true,
          removedMarketCount: await cleanupDummyMarkets(
            dbPool,
            marketIds,
            options.runId,
            eventId ? [eventId] : []
          )
        }
      : {
          enabled: false,
          removedMarketCount: 0
        };

    console.log(
      JSON.stringify(
        {
          objectType: options.smoke ? "oracle_eol_smoke_result" : "oracle_eol_gauntlet_result",
          runId: options.runId,
          generatedAt: new Date().toISOString(),
          cleanup,
          markets: [scheduled, early]
        },
        null,
        2
      )
    );
  } finally {
    await dbPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
