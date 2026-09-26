import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

type Options = {
  market?: string;
  json?: boolean;
};

async function run(options: Options): Promise<void> {
  const marketId = options.market?.trim();
  if (!marketId) {
    throw new Error("--market is required.");
  }

  const pool = createDbPool(loadAppEnv().db);
  try {
    const market = (
      await pool.query(
        `
          select
            m.id,
            m.title,
            m.status,
            m.settlement_status,
            m.close_at,
            m.closed_at,
            m.resolved_at,
            mr.id as resolution_id,
            mr.winning_outcome_id,
            mo.label as winning_outcome_label
          from markets m
          left join market_resolutions mr on mr.market_id = m.id
          left join market_outcomes mo on mo.market_id = m.id and mo.id = mr.winning_outcome_id
          where m.id = $1
          limit 1
        `,
        [marketId]
      )
    ).rows[0] ?? null;

    const realizationSummary = (
      await pool.query(
        `
          select
            re.type,
            re.outcome_id,
            mo.label as outcome_label,
            count(*)::int as row_count,
            count(distinct re.user_id)::int as user_count,
            coalesce(sum(re.shares_closed), 0)::numeric(20, 6)::text as shares_closed,
            coalesce(sum(re.proceeds), 0)::numeric(20, 6)::text as proceeds,
            coalesce(sum(re.removed_cost_basis), 0)::numeric(20, 6)::text as removed_cost_basis
          from realization_events re
          left join market_outcomes mo on mo.market_id = re.market_id and mo.id = re.outcome_id
          where re.market_id = $1
            and re.type in ('resolution_win', 'resolution_loss')
          group by re.type, re.outcome_id, mo.label
          order by re.type asc, mo.label asc nulls last
        `,
        [marketId]
      )
    ).rows;

    const compensationSummary = (
      await pool.query(
        `
          select
            count(distinct lt.id)::int as transaction_count,
            count(distinct a.owner_id)::int as user_count,
            coalesce(sum(le.amount), 0)::numeric(20, 6)::text as amount
          from ledger_transactions lt
          join ledger_entries le
            on le.transaction_id = lt.id
           and le.entry_role = 'credit_user_cash_incident_compensation'
          join accounts a
            on a.id = le.account_id
           and a.type = 'user_cash'
          where lt.reference_type = 'market_incident_compensation'
            and lt.reference_id like 'market_incident_compensation:' || $1 || ':%'
        `,
        [marketId]
      )
    ).rows[0] ?? { transaction_count: 0, user_count: 0, amount: "0.000000" };

    const notificationSummary = (
      await pool.query(
        `
          select
            type,
            count(*)::int as notification_count,
            count(*) filter (where read_at is null and dismissed_at is null)::int as visible_unread_count
          from user_notifications
          where market_id = $1
          group by type
          order by type asc
        `,
        [marketId]
      )
    ).rows;

    const staleLossNotifications = (
      await pool.query(
        `
          select
            nu.id,
            nu.user_id,
            nu.realization_event_id,
            re.outcome_id,
            mo.label as outcome_label,
            nu.created_at
          from user_notifications nu
          left join realization_events re on re.id = nu.realization_event_id
          left join market_outcomes mo on mo.market_id = re.market_id and mo.id = re.outcome_id
          where nu.market_id = $1
            and nu.type = 'loss'
            and nu.producer_type = 'market_resolution'
            and exists (
              select 1
              from ledger_transactions lt
              where lt.reference_type = 'market_incident_compensation'
                and lt.reference_id = 'market_incident_compensation:' || $1 || ':' || nu.realization_event_id
            )
          order by nu.created_at asc
        `,
        [marketId]
      )
    ).rows;

    const staleWinNotifications = (
      await pool.query(
        `
          select
            nu.id,
            nu.user_id,
            nu.realization_event_id,
            re.outcome_id,
            mo.label as outcome_label,
            mr.winning_outcome_id,
            winner.label as winning_outcome_label,
            nu.created_at
          from user_notifications nu
          join realization_events re on re.id = nu.realization_event_id
          join market_resolutions mr on mr.id = re.resolution_id
          left join market_outcomes mo on mo.market_id = re.market_id and mo.id = re.outcome_id
          left join market_outcomes winner on winner.market_id = mr.market_id and winner.id = mr.winning_outcome_id
          where nu.market_id = $1
            and nu.type = 'win'
            and nu.producer_type = 'market_resolution'
            and re.market_id = $1
            and re.type = 'resolution_win'
            and re.outcome_id <> mr.winning_outcome_id
          order by nu.created_at asc
        `,
        [marketId]
      )
    ).rows;

    const staleWinClaims = (
      await pool.query(
        `
          select
            re.id,
            re.user_id,
            re.outcome_id,
            mo.label as outcome_label,
            mr.winning_outcome_id,
            winner.label as winning_outcome_label,
            re.claim_status,
            re.share_consented_at,
            re.created_at
          from realization_events re
          join market_resolutions mr on mr.id = re.resolution_id
          left join market_outcomes mo on mo.market_id = re.market_id and mo.id = re.outcome_id
          left join market_outcomes winner on winner.market_id = mr.market_id and winner.id = mr.winning_outcome_id
          where re.market_id = $1
            and re.type = 'resolution_win'
            and re.outcome_id <> mr.winning_outcome_id
            and (
              re.claim_status in ('pending', 'claimed')
              or re.share_consented_at is not null
            )
          order by re.created_at asc
        `,
        [marketId]
      )
    ).rows;

    const lifecycleEvents = (
      await pool.query(
        `
          select
            event_type,
            source_system,
            actor_id,
            oracle_case_id,
            resolution_id,
            occurred_at,
            payload
          from market_lifecycle_events
          where market_id = $1
          order by occurred_at desc
          limit 30
        `,
        [marketId]
      )
    ).rows;

    const issues = [
      ...(staleLossNotifications.length > 0 ? ["stale_loss_notifications_after_compensation"] : []),
      ...(staleWinNotifications.length > 0 ? ["stale_win_notifications_after_resolution_repair"] : []),
      ...(staleWinClaims.length > 0 ? ["stale_win_claims_after_resolution_repair"] : []),
      ...(market?.status === "resolved" && !market.resolution_id ? ["resolved_without_resolution_row"] : [])
    ];

    const receipt = {
      objectType: "market_post_incident_audit",
      generatedAt: new Date().toISOString(),
      market,
      realizationSummary,
      compensationSummary,
      notificationSummary,
      staleLossNotificationCount: staleLossNotifications.length,
      staleLossNotifications,
      staleWinNotificationCount: staleWinNotifications.length,
      staleWinNotifications,
      staleWinClaimCount: staleWinClaims.length,
      staleWinClaims,
      lifecycleEvents,
      issueCount: issues.length,
      issues
    };

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (issues.length > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("market-post-incident-audit")
  .description("Read-only post-incident audit for settlement, compensation, notifications, and lifecycle receipts.")
  .requiredOption("--market <market-id>")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
