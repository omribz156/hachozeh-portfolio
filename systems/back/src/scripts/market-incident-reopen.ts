import { loadAppEnv } from "../config/env";
import type { Pool } from "pg";

import { createDbPool, type Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import { insertLifecycleEvent } from "../shared/lifecycle-events";
import { readStringArg } from "./script-args";

type ReopenOptions = {
  marketIds: string[];
  actorId: string;
  reason: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  idempotencyKey: string;
  reopenUntil: string | null;
  execute: boolean;
  json: boolean;
  renderLogReceipt: boolean;
};

type MarketRow = {
  id: string;
  title: string;
  status: string;
  settlement_status: string | null;
  event_id: string | null;
  close_at: Date;
  resolved_at: Date | null;
  resolution_id: string | null;
  winning_outcome_id: string | null;
  winner_label: string | null;
  resolution_event_count: number;
  resolution_loss_count: number;
  resolution_win_count: number;
  claimed_win_count: number;
};

type RestoreRow = {
  user_id: string;
  market_id: string;
  outcome_id: string;
  shares: string;
  cost_basis: string;
  realization_ids: string[];
};

type ReopenMarketReport = {
  market: MarketRow | null;
  targetCloseAt: string | null;
  restoredPositionCount: number;
  deletedLossRealizationCount: number;
  deletedNotificationCount: number;
  deletedNotificationEventCount: number;
  keptWinRealizationCount: number;
  deletedResolution: boolean;
  skipped: boolean;
  skipReason: string | null;
};

type ReopenReport = {
  objectType: "market_incident_reopen";
  generatedAt: string;
  dryRun: boolean;
  reason: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  markets: ReopenMarketReport[];
};

function readFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function readPayload(args: string[]): Record<string, unknown> {
  const raw = readStringArg(args, "payload-json-b64", "").trim();

  if (!raw) {
    return {};
  }

  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--payload-json-b64 must decode to a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function readPayloadString(
  payload: Record<string, unknown>,
  name: string,
  fallback: string
): string {
  const value = payload[name];
  return typeof value === "string" ? value : fallback;
}

function readPayloadBoolean(
  payload: Record<string, unknown>,
  name: string,
  fallback: boolean
): boolean {
  const value = payload[name];
  return typeof value === "boolean" ? value : fallback;
}

function readPayloadStringArray(
  payload: Record<string, unknown>,
  name: string,
  fallback: string[]
): string[] {
  const value = payload[name];

  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitMarketIds(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOptions(args = process.argv.slice(2)): ReopenOptions {
  const payload = readPayload(args);
  const marketIds = readPayloadStringArray(
    payload,
    "marketIds",
    splitMarketIds(readStringArg(args, "market-ids", readStringArg(args, "market-id", "")))
  );

  if (!marketIds.length) {
    throw new Error("--market-ids is required.");
  }

  const actorId = readPayloadString(
    payload,
    "actorId",
    readStringArg(args, "actor-id", "oracle_incident_operator")
  ).trim();
  const reason = readPayloadString(
    payload,
    "reason",
    readStringArg(args, "reason", "Premature market resolution reopen")
  ).trim();
  const summary = readPayloadString(payload, "summary", readStringArg(args, "summary", reason)).trim();
  const sourceUrl = readPayloadString(payload, "sourceUrl", readStringArg(args, "source-url", "")).trim() || null;
  const sourceLabel = readPayloadString(payload, "sourceLabel", readStringArg(args, "source-label", "")).trim() || null;
  const reopenUntil = readPayloadString(payload, "reopenUntil", readStringArg(args, "reopen-until", "")).trim() || null;
  const idempotencyKey = readStringArg(
    args,
    "idempotency-key",
    readPayloadString(payload, "idempotencyKey", `market-incident-reopen:${marketIds.join(",")}`)
  ).trim();

  return {
    marketIds,
    actorId,
    reason,
    summary,
    sourceUrl,
    sourceLabel,
    idempotencyKey,
    reopenUntil,
    execute: readPayloadBoolean(payload, "execute", readFlag(args, "execute")),
    json: readFlag(args, "json"),
    renderLogReceipt: readFlag(args, "render-log-receipt")
  };
}

async function readMarket(db: Queryable, marketId: string): Promise<MarketRow | null> {
  const result = await db.query<MarketRow>(
    `
      select
        m.id,
        m.title,
        m.status,
        m.settlement_status,
        m.event_id,
        m.close_at,
        m.resolved_at,
        mr.id as resolution_id,
        mr.winning_outcome_id,
        mo.label as winner_label,
        count(re.id)::int as resolution_event_count,
        count(re.id) filter (where re.type = 'resolution_loss')::int as resolution_loss_count,
        count(re.id) filter (where re.type = 'resolution_win')::int as resolution_win_count,
        count(re.id) filter (where re.type = 'resolution_win' and re.claim_status = 'claimed')::int as claimed_win_count
      from markets m
      left join market_resolutions mr
        on mr.market_id = m.id
      left join market_outcomes mo
        on mo.market_id = m.id
       and mo.id = mr.winning_outcome_id
      left join realization_events re
        on re.market_id = m.id
       and re.type in ('resolution_win', 'resolution_loss')
      where m.id = $1
      group by m.id, mr.id, mr.winning_outcome_id, mo.label
      limit 1
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function readRestoreRows(db: Queryable, marketId: string): Promise<RestoreRow[]> {
  const result = await db.query<RestoreRow>(
    `
      select
        user_id,
        market_id,
        outcome_id,
        sum(shares_closed)::numeric(20, 6)::text as shares,
        sum(removed_cost_basis)::numeric(20, 6)::text as cost_basis,
        array_agg(id order by created_at, id) as realization_ids
      from realization_events
      where market_id = $1
        and type = 'resolution_loss'
      group by user_id, market_id, outcome_id
      order by user_id, outcome_id
    `,
    [marketId]
  );

  return result.rows;
}

function targetCloseAt(market: MarketRow, reopenUntil: string | null): string {
  return reopenUntil ?? market.close_at.toISOString();
}

function isFutureClose(closeAt: string, now: Date): boolean {
  const parsed = new Date(closeAt);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > now.getTime();
}

async function applyReopenMarket(
  client: Queryable,
  market: MarketRow,
  restoreRows: RestoreRow[],
  options: ReopenOptions,
  closeAt: string,
  now: Date
): Promise<ReopenMarketReport> {
  for (const row of restoreRows) {
    await client.query(
      `
        insert into positions (
          user_id,
          market_id,
          outcome_id,
          shares,
          cost_basis,
          realized_pnl,
          created_at,
          updated_at,
          last_trade_at,
          settled_at
        )
        values ($1, $2, $3, $4::numeric, $5::numeric, 0, now(), now(), null, null)
        on conflict (user_id, market_id, outcome_id)
        do update set
          shares = positions.shares + excluded.shares,
          cost_basis = positions.cost_basis + excluded.cost_basis,
          settled_at = null,
          updated_at = now()
      `,
      [row.user_id, row.market_id, row.outcome_id, row.shares, row.cost_basis]
    );
  }

  await client.query(
    `
      update contract_positions cp
      set settled_at = null,
          updated_at = now()
      where cp.market_id = $1
        and exists (
          select 1
          from realization_events re
          where re.market_id = cp.market_id
            and re.user_id = cp.user_id
            and re.outcome_id = cp.requested_outcome_id
            and re.type = 'resolution_loss'
        )
    `,
    [market.id]
  );

  const notificationCleanupResult = await client.query<{
    deleted_notification_count: number;
    deleted_notification_event_count: number;
  }>(
    `
      with false_loss_notifications as (
        select id
        from user_notifications
        where realization_event_id = any($1::text[])
      ),
      deleted_events as (
        delete from user_notification_events
        where notification_id in (select id from false_loss_notifications)
        returning id
      ),
      deleted_notifications as (
        delete from user_notifications
        where id in (select id from false_loss_notifications)
        returning id
      )
      select
        (select count(*)::int from deleted_notifications) as deleted_notification_count,
        (select count(*)::int from deleted_events) as deleted_notification_event_count
    `,
    [restoreRows.flatMap((row) => row.realization_ids)]
  );

  const notificationCleanup = notificationCleanupResult.rows[0];

  const deletedRealizationLosses = await client.query<{ id: string }>(
    `
      delete from realization_events
      where market_id = $1
        and type = 'resolution_loss'
      returning id
    `,
    [market.id]
  );

  let deletedResolution = false;
  if (market.resolution_id) {
    await client.query(
      `
        update realization_events
        set resolution_id = null
        where market_id = $1
          and resolution_id = $2
          and type = 'resolution_win'
      `,
      [market.id, market.resolution_id]
    );
    await client.query("delete from market_resolutions where id = $1", [market.resolution_id]);
    deletedResolution = true;
  }

  await client.query(
    `
      update market_outcomes
      set is_winner = null,
          updated_at = now()
      where market_id = $1
    `,
    [market.id]
  );

  await client.query(
    `
      update markets
      set status = 'open',
          settlement_status = null,
          resolved_at = null,
          closed_at = null,
          close_at = $2,
          updated_at = now()
      where id = $1
    `,
    [market.id, closeAt]
  );

  const auditEventId = await insertAuditEvent(client, {
    actorId: options.actorId,
    action: "market_incident_reopen",
    entityType: "market",
    entityId: market.id,
    payload: {
      reason: options.reason,
      summary: options.summary,
      sourceUrl: options.sourceUrl,
      sourceLabel: options.sourceLabel,
      previousStatus: market.status,
      previousSettlementStatus: market.settlement_status,
      previousWinnerOutcomeId: market.winning_outcome_id,
      restoredPositionCount: restoreRows.length,
      deletedLossRealizationIds: deletedRealizationLosses.rows.map((row) => row.id),
      deletedNotificationCount: notificationCleanup?.deleted_notification_count ?? 0,
      deletedNotificationEventCount: notificationCleanup?.deleted_notification_event_count ?? 0,
      keptWinRealizationCount: market.resolution_win_count,
      claimedWinCount: market.claimed_win_count,
      detachedWinResolutionId: market.resolution_id,
      targetCloseAt: closeAt
    }
  });

  await insertLifecycleEvent(client, {
    marketId: market.id,
    eventType: "operator_observed_outcome",
    sourceSystem: "admin",
    actorId: options.actorId,
    occurredAt: now.toISOString(),
    correlationId: options.idempotencyKey,
    dedupeKey: `market_incident_reopen:${market.id}:${options.idempotencyKey}`,
    auditEventId,
    payload: {
      objectType: "market_incident_reopen",
      reason: options.reason,
      summary: options.summary,
      sourceUrl: options.sourceUrl,
      sourceLabel: options.sourceLabel,
      targetCloseAt: closeAt,
      restoredPositionCount: restoreRows.length,
      deletedLossRealizationCount: deletedRealizationLosses.rowCount ?? 0,
      deletedNotificationCount: notificationCleanup?.deleted_notification_count ?? 0,
      deletedNotificationEventCount: notificationCleanup?.deleted_notification_event_count ?? 0,
      keptWinRealizationCount: market.resolution_win_count,
      claimedWinCount: market.claimed_win_count
    }
  });

  return {
    market,
    targetCloseAt: closeAt,
    restoredPositionCount: restoreRows.length,
    deletedLossRealizationCount: deletedRealizationLosses.rowCount ?? 0,
    deletedNotificationCount: notificationCleanup?.deleted_notification_count ?? 0,
    deletedNotificationEventCount: notificationCleanup?.deleted_notification_event_count ?? 0,
    keptWinRealizationCount: market.resolution_win_count,
    deletedResolution,
    skipped: false,
    skipReason: null
  };
}

export async function runMarketIncidentReopen(
  db: Pool,
  options: ReopenOptions,
  now = new Date()
): Promise<ReopenReport> {
  const reports: ReopenMarketReport[] = [];

  if (!options.execute) {
    for (const marketId of options.marketIds) {
      const market = await readMarket(db, marketId);
      if (!market) {
        reports.push({
          market: null,
          targetCloseAt: null,
          restoredPositionCount: 0,
          deletedLossRealizationCount: 0,
          deletedNotificationCount: 0,
          deletedNotificationEventCount: 0,
          keptWinRealizationCount: 0,
          deletedResolution: false,
          skipped: true,
          skipReason: "market_not_found"
        });
        continue;
      }

      const closeAt = targetCloseAt(market, options.reopenUntil);
      const restoreRows = await readRestoreRows(db, market.id);
      reports.push({
        market,
        targetCloseAt: closeAt,
        restoredPositionCount: restoreRows.length,
        deletedLossRealizationCount: market.resolution_loss_count,
        deletedNotificationCount: 0,
        deletedNotificationEventCount: 0,
        keptWinRealizationCount: market.resolution_win_count,
        deletedResolution: Boolean(market.resolution_id),
        skipped: !isFutureClose(closeAt, now),
        skipReason: isFutureClose(closeAt, now) ? null : "target_close_at_not_future"
      });
    }
  } else {
    await withTransaction(db, async (client) => {
      for (const marketId of options.marketIds) {
        await client.query("select id from markets where id = $1 for update", [marketId]);
        const market = await readMarket(client, marketId);
        if (!market) {
          reports.push({
            market: null,
            targetCloseAt: null,
            restoredPositionCount: 0,
            deletedLossRealizationCount: 0,
            deletedNotificationCount: 0,
            deletedNotificationEventCount: 0,
            keptWinRealizationCount: 0,
            deletedResolution: false,
            skipped: true,
            skipReason: "market_not_found"
          });
          continue;
        }

        const closeAt = targetCloseAt(market, options.reopenUntil);
        if (!isFutureClose(closeAt, now)) {
          throw new Error(`Cannot reopen ${market.id}: target close_at is not in the future.`);
        }

        const restoreRows = await readRestoreRows(client, market.id);
        reports.push(await applyReopenMarket(client, market, restoreRows, options, closeAt, now));
      }
    });
  }

  return {
    objectType: "market_incident_reopen",
    generatedAt: now.toISOString(),
    dryRun: !options.execute,
    reason: options.reason,
    summary: options.summary,
    sourceUrl: options.sourceUrl,
    sourceLabel: options.sourceLabel,
    markets: reports
  };
}

function formatReport(report: ReopenReport): string {
  return [
    `market-incident-reopen: dryRun=${report.dryRun} markets=${report.markets.length}`,
    `market-incident-reopen: summary=${report.summary}`,
    ...report.markets.map((item) =>
      [
        `market=${item.market?.id ?? "missing"}`,
        `status=${item.market?.status ?? "missing"}/${item.market?.settlement_status ?? "null"}`,
        `targetCloseAt=${item.targetCloseAt ?? "null"}`,
        `restorePositions=${item.restoredPositionCount}`,
        `deleteLosses=${item.deletedLossRealizationCount}`,
        `deleteNotifications=${item.deletedNotificationCount}`,
        `deleteNotificationEvents=${item.deletedNotificationEventCount}`,
        `keepWins=${item.keptWinRealizationCount}`,
        `deleteResolution=${item.deletedResolution}`,
        `skipped=${item.skipped}`,
        `skipReason=${item.skipReason ?? "none"}`
      ].join(" ")
    )
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const report = await runMarketIncidentReopen(pool, options);
    const output = options.json
      ? JSON.stringify(report, null, options.renderLogReceipt ? 0 : 2)
      : formatReport(report);

    if (options.renderLogReceipt) {
      console.error(`PROD_MARKET_INCIDENT_REOPEN ${output}`);
    } else {
      console.log(output);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
