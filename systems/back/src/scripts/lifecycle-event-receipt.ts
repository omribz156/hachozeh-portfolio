import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { readDbBackedMarketDetailPassiveRecord } from "../db/read-models/market-detail-passive";
import { resolveMarketIdFromInput } from "../../../oracle/src/inspect-market-service";

type MarketRow = {
  id: string;
  title: string;
  status: string;
  close_at: Date;
  closed_at: Date | null;
  resolved_at: Date | null;
  settlement_status: string | null;
  winner_outcome_id: string | null;
};

type LifecycleEventRow = {
  id: string;
  event_type: string;
  source_system: string;
  actor_id: string;
  occurred_at: Date;
  created_at: Date;
  correlation_id: string | null;
  dedupe_key: string | null;
  audit_event_id: string | null;
  oracle_case_id: string | null;
  resolution_id: string | null;
  payload: unknown;
};

type ParsedArgs = {
  market: string;
  limit: number;
  json: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--json") {
      flags.set("json", "true");
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      flags.set("market", arg);
      continue;
    }

    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(arg.slice(2), "true");
      continue;
    }

    flags.set(arg.slice(2), next);
    index += 1;
  }

  const market =
    flags.get("market") ??
    process.env.MARKET_RECEIPT_MARKET ??
    process.env.MARKET_API_SMOKE_MARKET;

  if (!market) {
    throw new Error("Missing market. Pass --market <id-or-key> or set MARKET_RECEIPT_MARKET.");
  }

  const limit = Number.parseInt(flags.get("limit") ?? "10", 10);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100.");
  }

  return {
    market,
    limit,
    json: flags.get("json") === "true"
  };
}

function printHelp(): void {
  console.log(`Usage:
  npm --prefix systems/back run receipt:lifecycle -- --market <market-id-or-key> [--limit 10] [--json]

Prints a compact backend receipt for lifecycle_events and market-detail eventUpdates.
`);
}

function effectiveStatus(row: MarketRow): string {
  if (row.status === "open" && row.close_at.getTime() <= Date.now()) {
    return "closed";
  }

  return row.status;
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  for (const key of [
    "summary",
    "reason",
    "sourceUrl",
    "officialStatus",
    "winningOutcomeId",
    "winningOutcomeKey",
    "triggerType",
    "settlementStatus"
  ]) {
    if (record[key] !== undefined) {
      summary[key] = record[key];
    }
  }

  return summary;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  const marketId = resolveMarketIdFromInput(args.market);
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const marketResult = await pool.query<MarketRow>(
      `
        select
          m.id,
          m.title,
          m.status,
          m.close_at,
          m.closed_at,
          m.resolved_at,
          m.settlement_status,
          winner.id as winner_outcome_id
        from markets m
        left join market_outcomes winner
          on winner.market_id = m.id
         and winner.is_winner = true
        where m.id = $1
        limit 1
      `,
      [marketId]
    );
    const market = marketResult.rows[0];

    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }

    const eventResult = await pool.query<LifecycleEventRow>(
      `
        select
          id,
          event_type,
          source_system,
          actor_id,
          occurred_at,
          created_at,
          correlation_id,
          dedupe_key,
          audit_event_id,
          oracle_case_id,
          resolution_id,
          payload
        from lifecycle_events
        where market_id = $1
        order by occurred_at desc, created_at desc
        limit $2
      `,
      [marketId, args.limit]
    );
    const marketDetail = await readDbBackedMarketDetailPassiveRecord(pool, marketId);
    const eventUpdates = marketDetail?.snapshot.eventUpdates ?? [];

    const receipt = {
      objectType: "lifecycle_event_receipt",
      market: {
        id: market.id,
        title: market.title,
        persistedStatus: market.status,
        effectiveStatus: effectiveStatus(market),
        closeAt: market.close_at.toISOString(),
        closedAt: market.closed_at?.toISOString() ?? null,
        resolvedAt: market.resolved_at?.toISOString() ?? null,
        settlementStatus: market.settlement_status,
        winnerOutcomeId: market.winner_outcome_id
      },
      lifecycleEvents: {
        count: eventResult.rows.length,
        byType: eventResult.rows.reduce<Record<string, number>>((counts, row) => {
          counts[row.event_type] = (counts[row.event_type] ?? 0) + 1;
          return counts;
        }, {}),
        recent: eventResult.rows.map((row) => ({
          id: row.id,
          eventType: row.event_type,
          sourceSystem: row.source_system,
          actorId: row.actor_id,
          occurredAt: row.occurred_at.toISOString(),
          correlationId: row.correlation_id,
          dedupeKey: row.dedupe_key,
          auditEventId: row.audit_event_id,
          oracleCaseId: row.oracle_case_id,
          resolutionId: row.resolution_id,
          payload: summarizePayload(row.payload)
        }))
      },
      marketDetail: {
        found: Boolean(marketDetail),
        settlementStatus: marketDetail?.snapshot.settlementStatus ?? null,
        resolvedAt: marketDetail?.snapshot.resolvedAt ?? null,
        winner: marketDetail?.snapshot.winner ?? null,
        eventUpdatesCount: eventUpdates.length,
        eventUpdates
      }
    };

    if (args.json) {
      console.log(JSON.stringify(receipt, null, 2));
      return;
    }

    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
