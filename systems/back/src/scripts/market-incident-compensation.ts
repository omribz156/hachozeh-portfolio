import { randomUUID } from "node:crypto";

import { loadAppEnv } from "../config/env";
import type { Pool } from "pg";

import { createDbPool, type Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { transferPlatformTreasuryToUser } from "../economy/economy-ledger";
import { insertAuditEvent } from "../shared/audit-events";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import { insertLifecycleEvent } from "../shared/lifecycle-events";
import { readStringArg } from "./script-args";

type CompensationOptions = {
  marketId: string;
  correctWinningOutcomeId: string | null;
  actorId: string;
  reason: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  idempotencyKey: string;
  execute: boolean;
  noteOnly: boolean;
  correctResolutionDisplay: boolean;
  json: boolean;
  renderLogReceipt: boolean;
};

type MarketRow = {
  id: string;
  title: string;
  status: string;
  settlement_status: string | null;
  winning_outcome_id: string | null;
  winner_label: string | null;
};

type CompensationCandidateRow = {
  realization_event_id: string;
  user_id: string;
  user_label: string;
  user_cash_account_id: string;
  outcome_id: string;
  outcome_label: string;
  shares_closed: string;
  removed_cost_basis: string;
  actual_proceeds: string;
  already_compensated: boolean;
};

type CompensationResult = {
  userId: string;
  userLabel: string;
  realizationEventId: string;
  outcomeId: string;
  outcomeLabel: string;
  amount: string;
  skipped: boolean;
  ledgerTransactionId: string | null;
};

type CompensationReport = {
  objectType: "market_incident_compensation";
  generatedAt: string;
  dryRun: boolean;
  market: MarketRow | null;
  correctWinningOutcomeId: string | null;
  reason: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  candidateCount: number;
  eligibleCompensationCount: number;
  compensatedCount: number;
  skippedAlreadyCompensatedCount: number;
  clearedLossNotificationCount: number;
  clearedLossNotificationEventCount: number;
  clearedWinNotificationCount: number;
  clearedWinNotificationEventCount: number;
  correctionNotificationTargetCount: number;
  correctionNotificationExistingCount: number;
  correctionNotificationInsertedCount: number;
  totalCompensation: string;
  correctedResolutionDisplay: boolean;
  results: CompensationResult[];
};

type NotificationCleanupCounts = {
  clearedLossNotificationCount: number;
  clearedLossNotificationEventCount: number;
  clearedWinNotificationCount: number;
  clearedWinNotificationEventCount: number;
};

export type IncidentCorrectionNotificationTarget = {
  userId: string;
  amount: string;
  outcomeLabel: string;
};

type CorrectionNotificationCounts = {
  targetCount: number;
  existingCount: number;
  insertedCount: number;
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

function parseOptions(args = process.argv.slice(2)): CompensationOptions {
  const payload = readPayload(args);
  const marketId = readPayloadString(payload, "marketId", readStringArg(args, "market-id", "")).trim();
  const correctWinningOutcomeId = readPayloadString(
    payload,
    "correctWinningOutcomeId",
    readStringArg(args, "correct-winning-outcome-id", "")
  ).trim();
  const noteOnly = readPayloadBoolean(payload, "noteOnly", readFlag(args, "note-only"));
  const correctResolutionDisplay = readPayloadBoolean(
    payload,
    "correctResolutionDisplay",
    readFlag(args, "correct-resolution-display")
  );

  if (!marketId) {
    throw new Error("--market-id is required.");
  }
  if (!correctWinningOutcomeId && !noteOnly) {
    throw new Error("--correct-winning-outcome-id is required.");
  }

  const actorId = readPayloadString(
    payload,
    "actorId",
    readStringArg(args, "actor-id", "oracle_incident_operator")
  ).trim();
  const reason = readPayloadString(
    payload,
    "reason",
    readStringArg(args, "reason", "Market incident compensation")
  ).trim();
  const summary = readPayloadString(payload, "summary", readStringArg(args, "summary", reason)).trim();
  const sourceUrl = readPayloadString(payload, "sourceUrl", readStringArg(args, "source-url", "")).trim() || null;
  const sourceLabel = readPayloadString(payload, "sourceLabel", readStringArg(args, "source-label", "")).trim() || null;
  const idempotencyKey = readStringArg(
    args,
    "idempotency-key",
    readPayloadString(
      payload,
      "idempotencyKey",
      `market-incident-compensation:${marketId}:${correctWinningOutcomeId || "note"}`
    )
  ).trim();

  return {
    marketId,
    correctWinningOutcomeId: correctWinningOutcomeId || null,
    actorId,
    reason,
    summary,
    sourceUrl,
    sourceLabel,
    idempotencyKey,
    execute: readPayloadBoolean(payload, "execute", readFlag(args, "execute")),
    noteOnly,
    correctResolutionDisplay,
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
        mr.winning_outcome_id,
        mo.label as winner_label
      from markets m
      left join market_resolutions mr
        on mr.market_id = m.id
      left join market_outcomes mo
        on mo.market_id = m.id
       and mo.id = mr.winning_outcome_id
      where m.id = $1
      limit 1
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function readCandidates(
  db: Queryable,
  options: CompensationOptions
): Promise<CompensationCandidateRow[]> {
  if (options.noteOnly || !options.correctWinningOutcomeId) {
    return [];
  }

  const result = await db.query<CompensationCandidateRow>(
    `
      select
        re.id as realization_event_id,
        re.user_id,
        coalesce(nullif(u.display_name, ''), nullif(u.handle, ''), 'user_' || substr(re.user_id, 1, 8)) as user_label,
        a.id as user_cash_account_id,
        re.outcome_id,
        mo.label as outcome_label,
        re.shares_closed::numeric(20, 6)::text as shares_closed,
        re.removed_cost_basis::numeric(20, 6)::text as removed_cost_basis,
        re.proceeds::numeric(20, 6)::text as actual_proceeds,
        exists (
          select 1
          from ledger_transactions lt
          where lt.reference_type = 'market_incident_compensation'
            and lt.reference_id = 'market_incident_compensation:' || re.market_id || ':' || re.id
        ) as already_compensated
      from realization_events re
      join market_outcomes mo
        on mo.market_id = re.market_id
       and mo.id = re.outcome_id
      join accounts a
        on a.owner_id = re.user_id
       and a.type = 'user_cash'
       and a.status = 'active'
      left join users u
        on u.id = re.user_id
      where re.market_id = $1
        and re.outcome_id = $2
        and re.type = 'resolution_loss'
      order by user_label, re.id
    `,
    [options.marketId, options.correctWinningOutcomeId]
  );

  return result.rows;
}

function candidateRealizationIds(candidates: CompensationCandidateRow[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.realization_event_id).filter(Boolean))];
}

function candidateUserIds(candidates: CompensationCandidateRow[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.user_id).filter(Boolean))];
}

async function lockMarketIncidentCompensationRun(
  db: Queryable,
  marketId: string
): Promise<void> {
  await db.query(
    "select pg_advisory_xact_lock(hashtext('market_incident_compensation'), hashtext($1))",
    [marketId]
  );
}

function emptyNotificationCleanupCounts(): NotificationCleanupCounts {
  return {
    clearedLossNotificationCount: 0,
    clearedLossNotificationEventCount: 0,
    clearedWinNotificationCount: 0,
    clearedWinNotificationEventCount: 0
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPositiveAmount(value: string): string {
  const numeric = Number.parseFloat(value);
  const formatted = new Intl.NumberFormat("he-IL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(Number.isFinite(numeric) ? Math.abs(numeric) : 0);

  return `+V₪ ${formatted}`;
}

export function buildIncidentCorrectionNotificationTargets(
  results: readonly CompensationResult[]
): IncidentCorrectionNotificationTarget[] {
  const byUser = new Map<string, IncidentCorrectionNotificationTarget>();

  for (const result of results) {
    const current = byUser.get(result.userId);
    byUser.set(result.userId, {
      userId: result.userId,
      amount: quantizeMoney(toDecimal(current?.amount ?? 0).plus(result.amount)),
      outcomeLabel: result.outcomeLabel
    });
  }

  return [...byUser.values()];
}

async function createIncidentCorrectionNotifications(
  db: Queryable,
  options: CompensationOptions,
  market: MarketRow | null,
  results: readonly CompensationResult[],
  execute: boolean
): Promise<CorrectionNotificationCounts> {
  const targets = buildIncidentCorrectionNotificationTargets(results);
  if (!market || options.noteOnly || targets.length === 0) {
    return { targetCount: 0, existingCount: 0, insertedCount: 0 };
  }

  const producerId = options.idempotencyKey;
  const userIds = targets.map((target) => target.userId);
  const existing = await db.query<{ user_id: string }>(
    `
      select user_id
      from user_notifications
      where user_id = any($1::text[])
        and producer_type = 'market_incident_compensation'
        and producer_id = $2
    `,
    [userIds, producerId]
  );
  const existingUserIds = new Set(existing.rows.map((row) => row.user_id));

  if (!execute) {
    return {
      targetCount: targets.length,
      existingCount: existingUserIds.size,
      insertedCount: 0
    };
  }

  const pendingTargets = targets.filter((target) => !existingUserIds.has(target.userId));
  if (pendingTargets.length === 0) {
    return {
      targetCount: targets.length,
      existingCount: existingUserIds.size,
      insertedCount: 0
    };
  }

  const title = escapeHtml(market.title);
  const inserted = await db.query<{ id: string; user_id: string }>(
    `
      insert into user_notifications (
        id,
        user_id,
        type,
        producer_type,
        producer_id,
        market_id,
        html,
        amount,
        amount_tone,
        thumb_glyph,
        thumb_accent,
        metadata,
        created_at
      )
      select
        t.id,
        t.user_id,
        'win',
        'market_incident_compensation',
        $1,
        $2,
        $3,
        t.amount,
        'pos',
        'emoji_events',
        'var(--hz-action-buy-strong)',
        t.metadata::jsonb,
        now()
      from unnest($4::text[], $5::text[], $6::text[], $7::text[]) as t(id, user_id, amount, metadata)
      on conflict (user_id, producer_type, producer_id) do nothing
      returning id, user_id
    `,
    [
      producerId,
      options.marketId,
      `<b>תיקון תוצאה</b>: הפוזיציה שלך ב־<span class="hz-notif__q">${title}</span> זכתה. הזיכוי הועבר לחשבון.`,
      pendingTargets.map(() => `notification_${randomUUID()}`),
      pendingTargets.map((target) => target.userId),
      pendingTargets.map((target) => formatPositiveAmount(target.amount)),
      pendingTargets.map((target) => JSON.stringify({
        objectType: "market_incident_compensation",
        marketTitle: market.title,
        outcomeLabel: target.outcomeLabel,
        correctWinningOutcomeId: options.correctWinningOutcomeId,
        compensatedAmount: target.amount,
        sourceUrl: options.sourceUrl,
        sourceLabel: options.sourceLabel
      }))
    ]
  );

  if (inserted.rows.length > 0) {
    await db.query(
      `
        insert into user_notification_events (id, notification_id, user_id, event_type, created_at)
        select t.id, t.notification_id, t.user_id, 'resolution_notified', now()
        from unnest($1::text[], $2::text[], $3::text[]) as t(id, notification_id, user_id)
        on conflict (notification_id, event_type) do nothing
      `,
      [
        inserted.rows.map(() => `notification_event_${randomUUID()}`),
        inserted.rows.map((row) => row.id),
        inserted.rows.map((row) => row.user_id)
      ]
    );
  }

  return {
    targetCount: targets.length,
    existingCount: existingUserIds.size,
    insertedCount: inserted.rows.length
  };
}

async function cleanupStaleResolutionNotifications(
  db: Queryable,
  options: CompensationOptions,
  candidates: CompensationCandidateRow[],
  execute: boolean
): Promise<NotificationCleanupCounts> {
  if (options.noteOnly) {
    return emptyNotificationCleanupCounts();
  }

  const realizationIds = candidateRealizationIds(candidates);
  const userIds = candidateUserIds(candidates);
  const hasLossCandidates = realizationIds.length > 0 || userIds.length > 0;
  const canCleanWrongWins = Boolean(options.correctWinningOutcomeId);

  if (!execute) {
    const result = await db.query<{
      loss_notification_count: number;
      loss_notification_event_count: number;
      win_notification_count: number;
      win_notification_event_count: number;
    }>(
      `
        with stale_loss_notifications as (
          select id
          from user_notifications
          where market_id = $1
            and type = 'loss'
            and producer_type = 'market_resolution'
            and $4::boolean
            and (
              realization_event_id = any($2::text[])
              or user_id = any($3::text[])
            )
        ),
        stale_win_notifications as (
          select nu.id
          from user_notifications nu
          join realization_events re
            on re.id = nu.realization_event_id
          where nu.market_id = $1
            and nu.type = 'win'
            and nu.producer_type = 'market_resolution'
            and $5::boolean
            and re.market_id = $1
            and re.type = 'resolution_win'
            and re.outcome_id <> $6
        )
        select
          (select count(*)::int from stale_loss_notifications) as loss_notification_count,
          (
            select count(*)::int
            from user_notification_events
            where notification_id in (select id from stale_loss_notifications)
          ) as loss_notification_event_count,
          (select count(*)::int from stale_win_notifications) as win_notification_count,
          (
            select count(*)::int
            from user_notification_events
            where notification_id in (select id from stale_win_notifications)
          ) as win_notification_event_count
      `,
      [
        options.marketId,
        realizationIds,
        userIds,
        hasLossCandidates,
        canCleanWrongWins,
        options.correctWinningOutcomeId
      ]
    );

    return {
      clearedLossNotificationCount: result.rows[0]?.loss_notification_count ?? 0,
      clearedLossNotificationEventCount: result.rows[0]?.loss_notification_event_count ?? 0,
      clearedWinNotificationCount: result.rows[0]?.win_notification_count ?? 0,
      clearedWinNotificationEventCount: result.rows[0]?.win_notification_event_count ?? 0
    };
  }

  const result = await db.query<{
    deleted_loss_notification_count: number;
    deleted_loss_notification_event_count: number;
    deleted_win_notification_count: number;
    deleted_win_notification_event_count: number;
  }>(
    `
      with stale_loss_notifications as (
        select id
        from user_notifications
        where market_id = $1
          and type = 'loss'
          and producer_type = 'market_resolution'
          and $4::boolean
          and (
            realization_event_id = any($2::text[])
            or user_id = any($3::text[])
          )
      ),
      stale_win_notifications as (
        select nu.id
        from user_notifications nu
        join realization_events re
          on re.id = nu.realization_event_id
        where nu.market_id = $1
          and nu.type = 'win'
          and nu.producer_type = 'market_resolution'
          and $5::boolean
          and re.market_id = $1
          and re.type = 'resolution_win'
          and re.outcome_id <> $6
      ),
      stale_loss_notification_events as (
        select id
        from user_notification_events
        where notification_id in (select id from stale_loss_notifications)
      ),
      stale_win_notification_events as (
        select id
        from user_notification_events
        where notification_id in (select id from stale_win_notifications)
      ),
      deleted_events as (
        delete from user_notification_events
        where notification_id in (
          select id from stale_loss_notifications
          union
          select id from stale_win_notifications
        )
        returning id
      ),
      deleted_notifications as (
        delete from user_notifications
        where id in (
          select id from stale_loss_notifications
          union
          select id from stale_win_notifications
        )
        returning id
      )
      select
        (select count(*)::int from stale_loss_notifications) as deleted_loss_notification_count,
        (select count(*)::int from stale_loss_notification_events) as deleted_loss_notification_event_count,
        (select count(*)::int from stale_win_notifications) as deleted_win_notification_count,
        (select count(*)::int from stale_win_notification_events) as deleted_win_notification_event_count
    `,
    [
      options.marketId,
      realizationIds,
      userIds,
      hasLossCandidates,
      canCleanWrongWins,
      options.correctWinningOutcomeId
    ]
  );

  return {
    clearedLossNotificationCount: result.rows[0]?.deleted_loss_notification_count ?? 0,
    clearedLossNotificationEventCount: result.rows[0]?.deleted_loss_notification_event_count ?? 0,
    clearedWinNotificationCount: result.rows[0]?.deleted_win_notification_count ?? 0,
    clearedWinNotificationEventCount: result.rows[0]?.deleted_win_notification_event_count ?? 0
  };
}

export async function runMarketIncidentCompensation(
  db: Pool,
  options: CompensationOptions,
  now = new Date()
): Promise<CompensationReport> {
  const market = await readMarket(db, options.marketId);
  let candidates: CompensationCandidateRow[] = [];
  const results: CompensationResult[] = [];
  let totalCompensation = toDecimal(0);
  let notificationCleanup = emptyNotificationCleanupCounts();
  let correctionNotifications: CorrectionNotificationCounts = {
    targetCount: 0,
    existingCount: 0,
    insertedCount: 0
  };

  if (!options.execute) {
    candidates = await readCandidates(db, options);

    for (const candidate of candidates) {
      const amount = quantizeMoney(toDecimal(candidate.shares_closed).minus(candidate.actual_proceeds));
      if (toDecimal(amount).lte(0)) {
        continue;
      }
      if (!candidate.already_compensated) {
        totalCompensation = totalCompensation.plus(amount);
      }
      results.push({
        userId: candidate.user_id,
        userLabel: candidate.user_label,
        realizationEventId: candidate.realization_event_id,
        outcomeId: candidate.outcome_id,
        outcomeLabel: candidate.outcome_label,
        amount,
        skipped: candidate.already_compensated,
        ledgerTransactionId: null
      });
    }
    notificationCleanup = await cleanupStaleResolutionNotifications(db, options, candidates, false);
    correctionNotifications = await createIncidentCorrectionNotifications(
      db,
      options,
      market,
      results,
      false
    );
  } else {
    await withTransaction(db, async (client) => {
      await lockMarketIncidentCompensationRun(client, options.marketId);
      candidates = await readCandidates(client, options);

      for (const candidate of candidates) {
        const amount = quantizeMoney(toDecimal(candidate.shares_closed).minus(candidate.actual_proceeds));
        if (toDecimal(amount).lte(0)) {
          continue;
        }
        if (candidate.already_compensated) {
          results.push({
            userId: candidate.user_id,
            userLabel: candidate.user_label,
            realizationEventId: candidate.realization_event_id,
            outcomeId: candidate.outcome_id,
            outcomeLabel: candidate.outcome_label,
            amount,
            skipped: true,
            ledgerTransactionId: null
          });
          continue;
        }

        const transfer = await transferPlatformTreasuryToUser(client, {
          userId: candidate.user_id,
          userCashAccountId: candidate.user_cash_account_id,
          amount,
          referenceType: "market_incident_compensation",
          referenceId: `market_incident_compensation:${options.marketId}:${candidate.realization_event_id}`,
          idempotencyKey: `${options.idempotencyKey}:${candidate.realization_event_id}`,
          createdBy: options.actorId,
          triggeredBy: "market_incident_compensation",
          sourceEntryRole: "debit_platform_treasury_incident_compensation",
          targetEntryRole: "credit_user_cash_incident_compensation"
        });

        totalCompensation = totalCompensation.plus(amount);
        results.push({
          userId: candidate.user_id,
          userLabel: candidate.user_label,
          realizationEventId: candidate.realization_event_id,
          outcomeId: candidate.outcome_id,
          outcomeLabel: candidate.outcome_label,
          amount,
          skipped: false,
          ledgerTransactionId: transfer.ledgerTransactionId
        });
      }

      notificationCleanup = await cleanupStaleResolutionNotifications(client, options, candidates, true);

      if (options.correctResolutionDisplay && options.correctWinningOutcomeId) {
        await client.query(
          `
            update market_resolutions
            set winning_outcome_id = $2,
                source_url = coalesce($3, source_url),
                notes = $4,
                resolved_by = $5
            where market_id = $1
          `,
          [
            options.marketId,
            options.correctWinningOutcomeId,
            options.sourceUrl,
            options.summary,
            options.actorId
          ]
        );

        await client.query(
          `
            update market_outcomes
            set is_winner = (id = $2),
                updated_at = now()
            where market_id = $1
          `,
          [options.marketId, options.correctWinningOutcomeId]
        );

        await client.query(
          `
            update markets
            set updated_at = now()
            where id = $1
          `,
          [options.marketId]
        );
      }

      correctionNotifications = await createIncidentCorrectionNotifications(
        client,
        options,
        market,
        results,
        true
      );

      const auditEventId = await insertAuditEvent(client, {
        actorId: options.actorId,
        action: "market_incident_compensation",
        entityType: "market",
        entityId: options.marketId,
        payload: {
          reason: options.reason,
          summary: options.summary,
          correctWinningOutcomeId: options.correctWinningOutcomeId,
          sourceUrl: options.sourceUrl,
          sourceLabel: options.sourceLabel,
          noteOnly: options.noteOnly,
          correctResolutionDisplay: options.correctResolutionDisplay,
          totalCompensation: quantizeMoney(totalCompensation),
          compensatedCount: results.filter((result) => !result.skipped).length,
          skippedAlreadyCompensatedCount: results.filter((result) => result.skipped).length,
          clearedLossNotificationCount: notificationCleanup.clearedLossNotificationCount,
          clearedLossNotificationEventCount: notificationCleanup.clearedLossNotificationEventCount,
          clearedWinNotificationCount: notificationCleanup.clearedWinNotificationCount,
          clearedWinNotificationEventCount: notificationCleanup.clearedWinNotificationEventCount,
          correctionNotificationTargetCount: correctionNotifications.targetCount,
          correctionNotificationExistingCount: correctionNotifications.existingCount,
          correctionNotificationInsertedCount: correctionNotifications.insertedCount,
          results
        }
      });

      await insertLifecycleEvent(client, {
        marketId: options.marketId,
        eventType: "operator_observed_outcome",
        sourceSystem: "admin",
        actorId: options.actorId,
        occurredAt: now.toISOString(),
        correlationId: options.idempotencyKey,
        dedupeKey: `market_incident_compensation:${options.marketId}:${options.idempotencyKey}`,
        auditEventId,
        payload: {
          objectType: "market_incident_compensation",
          reason: options.reason,
          summary: options.summary,
          correctWinningOutcomeId: options.correctWinningOutcomeId,
          sourceUrl: options.sourceUrl,
          sourceLabel: options.sourceLabel,
          noteOnly: options.noteOnly,
          correctResolutionDisplay: options.correctResolutionDisplay,
          totalCompensation: quantizeMoney(totalCompensation),
          compensatedCount: results.filter((result) => !result.skipped).length,
          clearedLossNotificationCount: notificationCleanup.clearedLossNotificationCount,
          clearedLossNotificationEventCount: notificationCleanup.clearedLossNotificationEventCount,
          clearedWinNotificationCount: notificationCleanup.clearedWinNotificationCount,
          clearedWinNotificationEventCount: notificationCleanup.clearedWinNotificationEventCount,
          correctionNotificationTargetCount: correctionNotifications.targetCount,
          correctionNotificationExistingCount: correctionNotifications.existingCount,
          correctionNotificationInsertedCount: correctionNotifications.insertedCount
        }
      });
    });
  }

  return {
    objectType: "market_incident_compensation",
    generatedAt: now.toISOString(),
    dryRun: !options.execute,
    market,
    correctWinningOutcomeId: options.correctWinningOutcomeId,
    reason: options.reason,
    summary: options.summary,
    sourceUrl: options.sourceUrl,
    sourceLabel: options.sourceLabel,
    candidateCount: candidates.length,
    eligibleCompensationCount: results.filter((result) => !result.skipped).length,
    compensatedCount: options.execute ? results.filter((result) => !result.skipped).length : 0,
    skippedAlreadyCompensatedCount: results.filter((result) => result.skipped).length,
    clearedLossNotificationCount: notificationCleanup.clearedLossNotificationCount,
    clearedLossNotificationEventCount: notificationCleanup.clearedLossNotificationEventCount,
    clearedWinNotificationCount: notificationCleanup.clearedWinNotificationCount,
    clearedWinNotificationEventCount: notificationCleanup.clearedWinNotificationEventCount,
    correctionNotificationTargetCount: correctionNotifications.targetCount,
    correctionNotificationExistingCount: correctionNotifications.existingCount,
    correctionNotificationInsertedCount: correctionNotifications.insertedCount,
    totalCompensation: quantizeMoney(totalCompensation),
    correctedResolutionDisplay: options.execute && options.correctResolutionDisplay,
    results
  };
}

function formatReport(report: CompensationReport): string {
  return [
    `market-incident-compensation: dryRun=${report.dryRun} market=${report.market?.id ?? "missing"} currentWinner=${report.market?.winner_label ?? "none"}`,
    `market-incident-compensation: correctWinningOutcomeId=${report.correctWinningOutcomeId}`,
    `market-incident-compensation: summary=${report.summary}`,
    `market-incident-compensation: candidates=${report.candidateCount} eligible=${report.eligibleCompensationCount} compensated=${report.compensatedCount} skipped=${report.skippedAlreadyCompensatedCount} total=${report.totalCompensation} correctedResolutionDisplay=${report.correctedResolutionDisplay}`,
    `market-incident-compensation: clearedLossNotifications=${report.clearedLossNotificationCount} clearedLossNotificationEvents=${report.clearedLossNotificationEventCount} clearedWinNotifications=${report.clearedWinNotificationCount} clearedWinNotificationEvents=${report.clearedWinNotificationEventCount}`,
    `market-incident-compensation: correctionNotifications target=${report.correctionNotificationTargetCount} existing=${report.correctionNotificationExistingCount} inserted=${report.correctionNotificationInsertedCount}`,
    ...report.results.map((result) =>
      `market-incident-compensation: ${result.skipped ? "skipped" : "candidate"} user=${result.userLabel} outcome=${result.outcomeLabel} amount=${result.amount}`
    )
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const report = await runMarketIncidentCompensation(pool, options);
    const output = options.json
      ? JSON.stringify(report, null, options.renderLogReceipt ? 0 : 2)
      : formatReport(report);

    if (options.renderLogReceipt) {
      console.error(`PROD_MARKET_INCIDENT_COMPENSATION ${output}`);
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
