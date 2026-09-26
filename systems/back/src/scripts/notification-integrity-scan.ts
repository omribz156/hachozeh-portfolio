import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Options = {
  market?: string;
  limit?: string;
  json?: boolean;
};

export type NotificationIntegrityScanReport = {
  objectType: "notification_integrity_scan";
  generatedAt: string;
  marketId: string | null;
  issueCount: number;
  staleLossAfterCompensation: unknown[];
  staleWinAfterResolutionRepair: unknown[];
  orphanEvents: unknown[];
  notificationWithoutRealization: unknown[];
  compensationWithoutCorrectionNotification: unknown[];
};

function readLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "200", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--limit must be a positive integer.");
  return parsed;
}

export async function runNotificationIntegrityScan(
  db: Queryable,
  input: { marketId?: string; limit?: number } = {}
): Promise<NotificationIntegrityScanReport> {
  const marketId = input.marketId?.trim() || null;
  const limit = input.limit ?? 200;
    const staleLossAfterCompensation = (
      await db.query(
        `
          select
            nu.id as notification_id,
            nu.user_id,
            nu.market_id,
            nu.realization_event_id,
            nu.created_at
          from user_notifications nu
          where ($1::text is null or nu.market_id = $1)
            and nu.type = 'loss'
            and nu.producer_type = 'market_resolution'
            and exists (
              select 1
              from ledger_transactions lt
              where lt.reference_type = 'market_incident_compensation'
                and lt.reference_id = 'market_incident_compensation:' || nu.market_id || ':' || nu.realization_event_id
            )
          order by nu.created_at desc
          limit $2
        `,
        [marketId, limit]
      )
    ).rows;

    const orphanEvents = (
      await db.query(
        `
          select une.id, une.notification_id, une.user_id, une.event_type, une.created_at
          from user_notification_events une
          left join user_notifications nu on nu.id = une.notification_id
          where nu.id is null
          order by une.created_at desc
          limit $1
        `,
        [limit]
      )
    ).rows;

    const staleWinAfterResolutionRepair = (
      await db.query(
        `
          select
            nu.id as notification_id,
            nu.user_id,
            nu.market_id,
            nu.realization_event_id,
            re.outcome_id,
            mr.winning_outcome_id,
            nu.created_at
          from user_notifications nu
          join realization_events re
            on re.id = nu.realization_event_id
          join market_resolutions mr
            on mr.id = re.resolution_id
          where ($1::text is null or nu.market_id = $1)
            and nu.type = 'win'
            and nu.producer_type = 'market_resolution'
            and re.type = 'resolution_win'
            and re.outcome_id <> mr.winning_outcome_id
          order by nu.created_at desc
          limit $2
        `,
        [marketId, limit]
      )
    ).rows;

    const notificationWithoutRealization = (
      await db.query(
        `
          select nu.id, nu.user_id, nu.market_id, nu.realization_event_id, nu.type, nu.created_at
          from user_notifications nu
          left join realization_events re on re.id = nu.realization_event_id
          where ($1::text is null or nu.market_id = $1)
            and nu.producer_type = 'market_resolution'
            and nu.realization_event_id is not null
            and re.id is null
          order by nu.created_at desc
          limit $2
        `,
        [marketId, limit]
      )
    ).rows;

    const compensationWithoutCorrectionNotification = (
      await db.query(
        `
          select distinct
            re.user_id,
            re.market_id,
            re.id as realization_event_id,
            lt.id as compensation_ledger_transaction_id
          from ledger_transactions lt
          join realization_events re
            on lt.reference_id = 'market_incident_compensation:' || re.market_id || ':' || re.id
          where ($1::text is null or re.market_id = $1)
            and lt.reference_type = 'market_incident_compensation'
            and not exists (
              select 1
              from user_notifications nu
              where nu.user_id = re.user_id
                and nu.market_id = re.market_id
                and nu.producer_type = 'market_incident_compensation'
            )
          order by re.market_id, re.user_id, re.id
          limit $2
        `,
        [marketId, limit]
      )
    ).rows;

    return {
      objectType: "notification_integrity_scan",
      generatedAt: new Date().toISOString(),
      marketId,
      issueCount:
        staleLossAfterCompensation.length +
        staleWinAfterResolutionRepair.length +
        orphanEvents.length +
        notificationWithoutRealization.length +
        compensationWithoutCorrectionNotification.length,
      staleLossAfterCompensation,
      staleWinAfterResolutionRepair,
      orphanEvents,
      notificationWithoutRealization,
      compensationWithoutCorrectionNotification
    };
}

async function run(options: Options): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);
  try {
    const receipt = await runNotificationIntegrityScan(pool, {
      marketId: options.market,
      limit: readLimit(options.limit)
    });

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (receipt.issueCount > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("notification-integrity-scan")
  .description("Read-only scan for notifications that contradict repaired market resolution state.")
  .option("--market <market-id>")
  .option("--limit <n>", "Maximum rows per issue class.", "200")
  .option("--json")
  .action(run);

if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
