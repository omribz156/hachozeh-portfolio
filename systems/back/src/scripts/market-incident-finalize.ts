import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { insertEconomyTransferLedgerTransaction } from "../economy/economy-ledger";
import { createResolutionNotifications } from "../notifications/notification-feed-service";
import { insertAuditEvent } from "../shared/audit-events";
import { toDecimal } from "../shared/decimals";
import { insertLifecycleEvent } from "../shared/lifecycle-events";
import { readStringArg } from "./script-args";
import {
  buildIncidentFinalizePlan,
  type IncidentFinalizeContract,
  type IncidentFinalizePlan,
  type IncidentFinalizePosition,
  type IncidentFinalizeRealization
} from "./market-incident-finalize-plan";

export type IncidentFinalizeOptions = {
  marketId: string;
  oracleCaseId: string;
  winningOutcomeId: string;
  actorId: string;
  summary: string;
  sourceUrl: string;
  sourceLabel: string;
  idempotencyKey: string;
  execute: boolean;
  json: boolean;
  renderLogReceipt: boolean;
};

type MarketRow = {
  id: string;
  title: string;
  status: string;
  settlement_status: string | null;
  resolved_at: Date | string | null;
  market_treasury_account_id: string;
  market_treasury_balance: string;
  resolution_id: string | null;
};

type OracleCaseRow = {
  id: string;
  market_id: string;
  case_type: string;
  case_status: string;
  current_winning_outcome_id: string | null;
  evidence_winning_outcome_id: string | null;
};

type Snapshot = {
  market: MarketRow | null;
  oracleCase: OracleCaseRow | null;
  outcomes: Array<{ id: string; label: string }>;
  contracts: IncidentFinalizeContract[];
  positions: IncidentFinalizePosition[];
  realizations: IncidentFinalizeRealization[];
  platformTreasuryBalance: string | null;
};

export type IncidentFinalizeReport = {
  objectType: "market_incident_finalize";
  generatedAt: string;
  dryRun: boolean;
  replayed: boolean;
  marketId: string;
  oracleCaseId: string;
  winningOutcomeId: string;
  summary: string;
  sourceUrl: string;
  sourceLabel: string;
  blockers: string[];
  plan: IncidentFinalizePlan | null;
  resolutionId: string | null;
  auditEventId: string | null;
  notificationCount: number;
};

function readFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function readPayload(args: string[]): Record<string, unknown> {
  const raw = readStringArg(args, "payload-json-b64", "").trim();
  if (!raw) return {};
  const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--payload-json-b64 must decode to a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function payloadString(payload: Record<string, unknown>, key: string, fallback: string): string {
  return typeof payload[key] === "string" ? String(payload[key]) : fallback;
}

function payloadBoolean(payload: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof payload[key] === "boolean" ? Boolean(payload[key]) : fallback;
}

export function parseIncidentFinalizeOptions(args = process.argv.slice(2)): IncidentFinalizeOptions {
  const payload = readPayload(args);
  const marketId = payloadString(payload, "marketId", readStringArg(args, "market-id", "")).trim();
  const oracleCaseId = payloadString(payload, "oracleCaseId", readStringArg(args, "oracle-case-id", "")).trim();
  const winningOutcomeId = payloadString(payload, "winningOutcomeId", readStringArg(args, "winning-outcome-id", "")).trim();
  const sourceUrl = payloadString(payload, "sourceUrl", readStringArg(args, "source-url", "")).trim();

  if (!marketId || !oracleCaseId || !winningOutcomeId || !sourceUrl) {
    throw new Error("--market-id, --oracle-case-id, --winning-outcome-id, and --source-url are required.");
  }

  const actorId = payloadString(payload, "actorId", readStringArg(args, "actor-id", "oracle_incident_operator")).trim();
  const summary = payloadString(payload, "summary", readStringArg(args, "summary", "Incident-aware final settlement")).trim();
  const sourceLabel = payloadString(payload, "sourceLabel", readStringArg(args, "source-label", "Official source")).trim();

  return {
    marketId,
    oracleCaseId,
    winningOutcomeId,
    actorId,
    summary,
    sourceUrl,
    sourceLabel,
    idempotencyKey: payloadString(
      payload,
      "idempotencyKey",
      readStringArg(args, "idempotency-key", `market-incident-finalize:${marketId}:${oracleCaseId}:${winningOutcomeId}`)
    ).trim(),
    execute: payloadBoolean(payload, "execute", readFlag(args, "execute")),
    json: readFlag(args, "json"),
    renderLogReceipt: readFlag(args, "render-log-receipt")
  };
}

async function readSnapshot(db: Queryable, options: IncidentFinalizeOptions, lock: boolean): Promise<Snapshot> {
  const lockSql = lock ? "for update of m, ma" : "";
  const marketResult = await db.query<MarketRow>(
    `
      select
        m.id,
        m.title,
        m.status,
        m.settlement_status,
        m.resolved_at,
        m.market_treasury_account_id,
        ma.balance_cached::numeric(20, 6)::text as market_treasury_balance,
        mr.id as resolution_id
      from markets m
      join accounts ma on ma.id = m.market_treasury_account_id
      left join market_resolutions mr on mr.market_id = m.id
      where m.id = $1
      ${lockSql}
    `,
    [options.marketId]
  );
  const caseResult = await db.query<OracleCaseRow>(
    `
      select
        oc.id,
        oc.market_id,
        oc.case_type,
        oc.case_status,
        oc.current_winning_outcome_id,
        ep.winning_outcome_id as evidence_winning_outcome_id
      from oracle_cases oc
      left join lateral (
        select winning_outcome_id
        from oracle_evidence_packets
        where oracle_case_id = oc.id
        order by created_at desc
        limit 1
      ) ep on true
      where oc.id = $1
      ${lock ? "for update of oc" : ""}
    `,
    [options.oracleCaseId]
  );
  const outcomesResult = await db.query<{ id: string; label: string }>(
    "select id, label from market_outcomes where market_id = $1 order by sort_order",
    [options.marketId]
  );
  const contractsResult = await db.query<{
    user_id: string;
    requested_outcome_id: string;
    contract_side: "yes" | "no";
    shares: string;
    cost_basis: string;
  }>(
    `
      select user_id, requested_outcome_id, contract_side,
             shares::numeric(20, 6)::text as shares,
             cost_basis::numeric(20, 6)::text as cost_basis
      from contract_positions
      where market_id = $1 and settled_at is null
      order by user_id, requested_outcome_id, contract_side
      ${lock ? "for update" : ""}
    `,
    [options.marketId]
  );
  const positionsResult = await db.query<{
    user_id: string;
    outcome_id: string;
    shares: string;
    cost_basis: string;
  }>(
    `
      select user_id, outcome_id,
             shares::numeric(20, 6)::text as shares,
             cost_basis::numeric(20, 6)::text as cost_basis
      from positions
      where market_id = $1
      order by user_id, outcome_id
      ${lock ? "for update" : ""}
    `,
    [options.marketId]
  );
  const realizationsResult = await db.query<{
    id: string;
    user_id: string;
    outcome_id: string;
    type: "resolution_win" | "resolution_loss";
    claim_status: "pending" | "claimed" | "not_applicable";
    shares_closed: string;
    proceeds: string;
    removed_cost_basis: string;
    resolution_id: string | null;
  }>(
    `
      select id, user_id, outcome_id, type, claim_status,
             shares_closed::numeric(20, 6)::text as shares_closed,
             proceeds::numeric(20, 6)::text as proceeds,
             removed_cost_basis::numeric(20, 6)::text as removed_cost_basis,
             resolution_id
      from realization_events
      where market_id = $1 and type in ('resolution_win', 'resolution_loss')
      order by user_id, outcome_id, created_at
      ${lock ? "for update" : ""}
    `,
    [options.marketId]
  );
  const platformResult = await db.query<{ balance: string }>(
    `select balance_cached::numeric(20, 6)::text as balance from accounts where type = 'platform_treasury' and status = 'active' order by created_at limit 1`,
    []
  );

  return {
    market: marketResult.rows[0] ?? null,
    oracleCase: caseResult.rows[0] ?? null,
    outcomes: outcomesResult.rows,
    contracts: contractsResult.rows.map((row) => ({
      userId: row.user_id,
      requestedOutcomeId: row.requested_outcome_id,
      contractSide: row.contract_side,
      shares: row.shares,
      costBasis: row.cost_basis
    })),
    positions: positionsResult.rows.map((row) => ({
      userId: row.user_id,
      outcomeId: row.outcome_id,
      shares: row.shares,
      costBasis: row.cost_basis
    })),
    realizations: realizationsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      outcomeId: row.outcome_id,
      type: row.type,
      claimStatus: row.claim_status,
      shares: row.shares_closed,
      proceeds: row.proceeds,
      costBasis: row.removed_cost_basis,
      resolutionId: row.resolution_id
    })),
    platformTreasuryBalance: platformResult.rows[0]?.balance ?? null
  };
}

function buildReport(
  snapshot: Snapshot,
  options: IncidentFinalizeOptions,
  now: Date,
  extras: Partial<Pick<IncidentFinalizeReport, "replayed" | "resolutionId" | "auditEventId" | "notificationCount">> = {}
): IncidentFinalizeReport {
  const blockers = new Set<string>();
  if (!snapshot.market) blockers.add("market_missing");
  if (snapshot.market && snapshot.market.status !== "closed") blockers.add("market_must_be_closed");
  if (snapshot.market?.settlement_status != null) blockers.add("settlement_status_must_be_empty");
  if (snapshot.market?.resolved_at != null) blockers.add("resolved_at_must_be_empty");
  if (snapshot.market?.resolution_id != null) blockers.add("resolution_must_be_empty");
  if (!snapshot.oracleCase) blockers.add("oracle_case_missing");
  if (snapshot.oracleCase?.market_id !== options.marketId) blockers.add("oracle_case_market_mismatch");
  if (snapshot.oracleCase?.case_type !== "resolution_check") blockers.add("oracle_case_type_mismatch");
  if (snapshot.oracleCase?.case_status !== "recommended") blockers.add("oracle_case_not_recommended");
  if (snapshot.oracleCase?.current_winning_outcome_id !== options.winningOutcomeId) blockers.add("oracle_case_winner_mismatch");
  if (snapshot.oracleCase?.evidence_winning_outcome_id !== options.winningOutcomeId) blockers.add("oracle_evidence_winner_mismatch");
  if (snapshot.platformTreasuryBalance == null) blockers.add("platform_treasury_missing");

  const plan = snapshot.market
    ? buildIncidentFinalizePlan({
        winningOutcomeId: options.winningOutcomeId,
        outcomes: snapshot.outcomes,
        contracts: snapshot.contracts,
        positions: snapshot.positions,
        realizations: snapshot.realizations,
        marketTreasuryBalance: snapshot.market.market_treasury_balance
      })
    : null;
  plan?.blockers.forEach((blocker) => blockers.add(blocker));
  if (plan && snapshot.platformTreasuryBalance != null && toDecimal(snapshot.platformTreasuryBalance).lt(plan.treasuryTopUp)) {
    blockers.add("platform_treasury_insufficient");
  }

  return {
    objectType: "market_incident_finalize",
    generatedAt: now.toISOString(),
    dryRun: !options.execute,
    replayed: extras.replayed ?? false,
    marketId: options.marketId,
    oracleCaseId: options.oracleCaseId,
    winningOutcomeId: options.winningOutcomeId,
    summary: options.summary,
    sourceUrl: options.sourceUrl,
    sourceLabel: options.sourceLabel,
    blockers: [...blockers],
    plan,
    resolutionId: extras.resolutionId ?? null,
    auditEventId: extras.auditEventId ?? null,
    notificationCount: extras.notificationCount ?? 0
  };
}

async function readReplay(db: Queryable, options: IncidentFinalizeOptions): Promise<IncidentFinalizeReport | null> {
  const result = await db.query<{ payload: { receipt?: IncidentFinalizeReport } }>(
    `
      select payload
      from audit_events
      where action = 'market_incident_finalized'
        and entity_type = 'market'
        and entity_id = $1
        and payload->>'idempotencyKey' = $2
      order by created_at desc
      limit 1
    `,
    [options.marketId, options.idempotencyKey]
  );
  const receipt = result.rows[0]?.payload?.receipt;
  return receipt ? { ...receipt, replayed: true } : null;
}

async function executeFinalization(
  db: Pool,
  options: IncidentFinalizeOptions,
  now: Date
): Promise<IncidentFinalizeReport> {
  return withTransaction(db, async (client) => {
    const replay = await readReplay(client, options);
    if (replay) return replay;

    const snapshot = await readSnapshot(client, options, true);
    const preview = buildReport(snapshot, options, now);
    if (!preview.plan || preview.blockers.length > 0) {
      throw new Error(`market_incident_finalize_blocked:${preview.blockers.join(",")}`);
    }

    const resolutionId = `resolution_${randomUUID()}`;
    await client.query(
      `insert into market_resolutions (id, market_id, winning_outcome_id, resolved_by, source_url, notes, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [resolutionId, options.marketId, options.winningOutcomeId, options.actorId, options.sourceUrl, options.summary, now.toISOString()]
    );
    await client.query(
      `update market_outcomes set is_winner = (id = $2), updated_at = now() where market_id = $1`,
      [options.marketId, options.winningOutcomeId]
    );
    await client.query(
      `update markets set status = 'resolved', settlement_status = 'processing', resolved_at = $2, updated_at = now() where id = $1`,
      [options.marketId, now.toISOString()]
    );

    if (preview.plan.realizationIdsToAttach.length > 0) {
      const attached = await client.query(
        `update realization_events set resolution_id = $2 where id = any($1::text[]) and resolution_id is null`,
        [preview.plan.realizationIdsToAttach, resolutionId]
      );
      if (attached.rowCount !== preview.plan.realizationIdsToAttach.length) {
        throw new Error("market_incident_finalize_attach_count_mismatch");
      }
    }

    for (const item of preview.plan.realizationsToCreate) {
      await client.query(
        `
          insert into realization_events (
            id, user_id, market_id, outcome_id, type, shares_closed, proceeds,
            removed_cost_basis, realized_pnl, claim_status, resolution_id, created_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          `realization_${randomUUID()}`,
          item.userId,
          options.marketId,
          item.outcomeId,
          item.type,
          item.shares,
          item.proceeds,
          item.costBasis,
          item.realizedPnl,
          item.claimStatus,
          resolutionId,
          now.toISOString()
        ]
      );
    }

    for (const position of preview.plan.positionsToDelete) {
      const deleted = await client.query(
        `delete from positions where user_id = $1 and market_id = $2 and outcome_id = $3`,
        [position.userId, options.marketId, position.outcomeId]
      );
      if (deleted.rowCount !== 1) throw new Error("market_incident_finalize_position_delete_mismatch");
    }
    const settled = await client.query(
      `update contract_positions set settled_at = $2, updated_at = now() where market_id = $1 and settled_at is null`,
      [options.marketId, now.toISOString()]
    );
    if (settled.rowCount !== snapshot.contracts.length) {
      throw new Error("market_incident_finalize_contract_settle_mismatch");
    }

    if (preview.plan.treasuryTopUp !== "0.000000") {
      await insertEconomyTransferLedgerTransaction(client, {
        type: "market_treasury_topup",
        referenceType: "market_incident_finalize",
        referenceId: options.marketId,
        idempotencyKey: `${options.idempotencyKey}:treasury-top-up`,
        createdBy: options.actorId,
        triggeredBy: "market_incident_finalize",
        triggeredById: options.oracleCaseId,
        marketId: options.marketId,
        resolutionId,
        sourceAccountType: "platform_treasury",
        targetAccountId: snapshot.market!.market_treasury_account_id,
        targetAccountType: "market_treasury",
        amount: preview.plan.treasuryTopUp,
        sourceEntryRole: "debit_platform_treasury_incident_finalize",
        targetEntryRole: "credit_market_treasury_incident_reserve"
      });
    } else if (preview.plan.treasurySweep !== "0.000000") {
      await insertEconomyTransferLedgerTransaction(client, {
        type: "treasury_sweep",
        referenceType: "market_incident_finalize",
        referenceId: options.marketId,
        idempotencyKey: `${options.idempotencyKey}:treasury-sweep`,
        createdBy: options.actorId,
        triggeredBy: "market_incident_finalize",
        triggeredById: options.oracleCaseId,
        marketId: options.marketId,
        resolutionId,
        sourceAccountId: snapshot.market!.market_treasury_account_id,
        sourceAccountType: "market_treasury",
        targetAccountType: "platform_treasury",
        amount: preview.plan.treasurySweep,
        sourceEntryRole: "debit_market_treasury_incident_sweep",
        targetEntryRole: "credit_platform_treasury_incident_sweep"
      });
    }

    await client.query(
      `delete from user_notification_events where notification_id in (
         select id from user_notifications where market_id = $1 and producer_type = 'market_resolution'
       )`,
      [options.marketId]
    );
    await client.query(
      `delete from user_notifications where market_id = $1 and producer_type = 'market_resolution'`,
      [options.marketId]
    );
    const notifications = await createResolutionNotifications(client, resolutionId);

    await client.query(
      `update markets set settlement_status = 'completed', updated_at = now() where id = $1`,
      [options.marketId]
    );
    await client.query(
      `
        insert into oracle_case_reviews (
          id, oracle_case_id, market_id, review_action, result_status, actor_id,
          actor_role, review_note, idempotency_key, resolution_id,
          resolve_response_snapshot, created_at, completed_at
        ) values ($1, $2, $3, 'approve_resolution', 'completed', $4, 'admin', $5, $6, $7, $8::jsonb, now(), now())
      `,
      [
        `oracle_review_${randomUUID()}`,
        options.oracleCaseId,
        options.marketId,
        options.actorId,
        options.summary,
        options.idempotencyKey,
        resolutionId,
        JSON.stringify({
          marketId: options.marketId,
          status: "resolved",
          winningOutcomeId: options.winningOutcomeId,
          resolutionId,
          resolvedAt: now.toISOString(),
          settlementStatus: "completed",
          incidentFinalizer: true
        })
      ]
    );

    const receiptBase = buildReport(snapshot, options, now, {
      resolutionId,
      notificationCount: notifications.insertedCount
    });
    const auditEventId = await insertAuditEvent(client, {
      actorId: options.actorId,
      action: "market_incident_finalized",
      entityType: "market",
      entityId: options.marketId,
      payload: {
        idempotencyKey: options.idempotencyKey,
        oracleCaseId: options.oracleCaseId,
        sourceUrl: options.sourceUrl,
        sourceLabel: options.sourceLabel,
        receipt: receiptBase
      }
    });
    const report = { ...receiptBase, auditEventId };

    await insertLifecycleEvent(client, {
      marketId: options.marketId,
      eventType: "resolution_approved",
      sourceSystem: "oracle",
      actorId: options.actorId,
      occurredAt: now.toISOString(),
      correlationId: options.idempotencyKey,
      dedupeKey: `resolution_approved:${options.oracleCaseId}:${options.idempotencyKey}`,
      auditEventId,
      oracleCaseId: options.oracleCaseId,
      resolutionId,
      payload: { winningOutcomeId: options.winningOutcomeId, incidentFinalizer: true }
    });
    await insertLifecycleEvent(client, {
      marketId: options.marketId,
      eventType: "market_resolved",
      sourceSystem: "oracle",
      actorId: options.actorId,
      occurredAt: now.toISOString(),
      correlationId: options.idempotencyKey,
      dedupeKey: `market_resolved:${options.marketId}:${options.idempotencyKey}`,
      auditEventId,
      oracleCaseId: options.oracleCaseId,
      resolutionId,
      payload: { winningOutcomeId: options.winningOutcomeId, settlementStatus: "completed", incidentFinalizer: true }
    });
    await insertLifecycleEvent(client, {
      marketId: options.marketId,
      eventType: "settlement_completed",
      sourceSystem: "oracle",
      actorId: options.actorId,
      occurredAt: now.toISOString(),
      correlationId: options.idempotencyKey,
      dedupeKey: `settlement_completed:${options.marketId}:${resolutionId}`,
      auditEventId,
      oracleCaseId: options.oracleCaseId,
      resolutionId,
      payload: {
        winningOutcomeId: options.winningOutcomeId,
        pendingClaimReserve: preview.plan.pendingClaimReserve,
        treasuryTopUp: preview.plan.treasuryTopUp,
        incidentFinalizer: true
      }
    });

    await client.query(
      `update audit_events set payload = jsonb_set(payload, '{receipt}', $2::jsonb, true) where id = $1`,
      [auditEventId, JSON.stringify(report)]
    );
    return report;
  });
}

export async function runMarketIncidentFinalize(
  db: Pool,
  options: IncidentFinalizeOptions,
  now = new Date()
): Promise<IncidentFinalizeReport> {
  const replay = await readReplay(db, options);
  if (replay) return replay;
  if (options.execute) return executeFinalization(db, options, now);
  return buildReport(await readSnapshot(db, options, false), options, now);
}

function formatReport(report: IncidentFinalizeReport): string {
  return [
    `market-incident-finalize: dryRun=${report.dryRun} replayed=${report.replayed} market=${report.marketId} case=${report.oracleCaseId}`,
    `market-incident-finalize: winner=${report.winningOutcomeId} blockers=${report.blockers.join(",") || "none"}`,
    `market-incident-finalize: pending=${report.plan?.pendingClaimReserve ?? "n/a"} topUp=${report.plan?.treasuryTopUp ?? "n/a"} sweep=${report.plan?.treasurySweep ?? "n/a"}`,
    `market-incident-finalize: resolution=${report.resolutionId ?? "none"} notifications=${report.notificationCount}`
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseIncidentFinalizeOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  try {
    const report = await runMarketIncidentFinalize(pool, options);
    const output = options.json ? JSON.stringify(report, null, options.renderLogReceipt ? 0 : 2) : formatReport(report);
    if (options.renderLogReceipt) console.error(`PROD_MARKET_INCIDENT_FINALIZE ${output}`);
    else console.log(output);
    if (report.blockers.length > 0) process.exitCode = 1;
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
