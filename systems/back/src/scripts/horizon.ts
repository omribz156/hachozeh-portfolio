import { createDbPool } from "../db/client/pool";
import { loadAppEnv } from "../config/env";
import {
  HORIZON_SYSTEM_ACTOR,
  inspectMarketClose,
  readHorizonAlerts,
  runHorizonCloseSweep
} from "../lifecycle/horizon/close-sweep-service";
import {
  closeMarket,
  type CloseMarketRequest
} from "../lifecycle/horizon/close-market-service";
import { resolveMarketIdFromInput } from "../../../oracle/src/inspect-market-service";
import { parseHorizonArgs } from "./horizon-args";

function printHelp(helpText?: string): void {
  console.log(helpText ?? `Usage:
  npm run horizon -- close-sweep [--dry-run true] [--at <iso>] [--limit 50] [--json]
  npm run horizon -- inspect-close --market <market-id-or-key> [--trigger scheduled_time|oracle_confirmed_event_completion] [--reason <text>] [--context <text>] [--source-ref <url>] [--approved-by <actor-id>] [--json]
  npm run horizon -- close-market --market <market-id-or-key> [--trigger scheduled_time|oracle_confirmed_event_completion] [--at <iso>] [--reason <text>] [--context <text>] [--source-ref <url>] [--approved-by <actor-id>] [--idempotency-key <key>] [--json]
  npm run horizon -- alerts [--at <iso>] [--json]
`);
}

function printResult(result: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function run(): Promise<void> {
  const parsed = parseHorizonArgs(process.argv);

  if (parsed.helpRequested || (!parsed.command && !parsed.unknownCommand)) {
    printHelp(parsed.helpText);
    return;
  }

  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    if (!parsed.command) {
      throw new Error(`Unsupported command: ${parsed.unknownCommand}`);
    }

    if (parsed.command === "close-sweep") {
      const result = await runHorizonCloseSweep(dbPool, {
        evaluatedAt: parsed.options.at,
        dryRun: parsed.options.dryRun,
        limit: parsed.options.limit
      });
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "inspect-close") {
      const marketId = resolveMarketIdFromInput(parsed.options.market);
      const triggerType =
        parsed.options.trigger === "oracle_confirmed_event_completion"
          ? "oracle_confirmed_event_completion"
          : "scheduled_time";
      const result = await inspectMarketClose(dbPool, {
        marketId,
        evaluatedAt: parsed.options.at,
        triggerType,
        whyNow:
          parsed.options.reason ??
          (triggerType === "scheduled_time"
            ? "Routine scheduled close inspection."
            : "Oracle requested early close inspection."),
        actorId: HORIZON_SYSTEM_ACTOR.actorId,
        proposedBySubsystem:
          triggerType === "oracle_confirmed_event_completion" ? "oracle" : undefined,
        approvalActorId: parsed.options.approvedBy,
        triggerContextSummary: parsed.options.context,
        sourceRef: parsed.options.sourceRef,
        notes: parsed.options.note
      });
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "close-market") {
      const marketId = resolveMarketIdFromInput(parsed.options.market);
      const triggerType =
        parsed.options.trigger === "oracle_confirmed_event_completion"
          ? "oracle_confirmed_event_completion"
          : "scheduled_time";
      const request: CloseMarketRequest = {
        triggerType,
        reason:
          parsed.options.reason ??
          (triggerType === "scheduled_time"
            ? "Manual scheduled close command."
            : "Manual Oracle-backed close command."),
        sourceUrl: parsed.options.sourceRef ?? null,
        note: parsed.options.context ?? null,
        oracleCaseId: parsed.options.oracleCaseId ?? null,
        triggeredByOracleId:
          triggerType === "oracle_confirmed_event_completion" ? "oracle" : null,
        approvedByHumanId: parsed.options.approvedBy ?? null,
        idempotencyKey:
          parsed.options.idempotencyKey ??
          `close:${marketId}:${parsed.options.at ?? new Date().toISOString()}`,
        requestedAt: parsed.options.at
      };
      const result = await closeMarket(dbPool, marketId, request, HORIZON_SYSTEM_ACTOR);
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "alerts") {
      const result = await readHorizonAlerts(dbPool, {
        evaluatedAt: parsed.options.at
      });
      printResult(result, parsed.jsonMode);
      return;
    }
  } finally {
    await dbPool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
