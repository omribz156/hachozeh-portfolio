import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import type { Queryable } from "../db/client/pool";
import { planDependentResolutionCascade } from "../lifecycle/events/dependent-resolution-cascade-planner";
import { inferRepoRoot, readEnvValue } from "./script-args";

const execFileAsync = promisify(execFile);
const repoRoot = inferRepoRoot("EVENT_AUDIT_REPO_ROOT");

type Options = {
  event?: string;
  allActive?: boolean;
  json?: boolean;
  jsonl?: boolean;
  quietIfClean?: boolean;
  alert?: boolean;
  alertScript?: string;
  failOnFindings?: boolean;
};

export type EventRow = {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  resolution_policy: string;
  sibling_resolution_requires_human_approval: boolean;
};

export type ChildRow = {
  id: string;
  title: string;
  status: string;
  close_at: Date;
  resolved_at: Date | null;
  market_contract: Record<string, unknown>;
  winner_count: number;
  affirmative_winner_count: number;
  winner_label: string | null;
  expected_resolution_at: string | null;
  resolution_case_count: number;
  settlement_status: string | null;
};

type ResolvedCascadeTriggerRow = {
  market_id: string;
  winning_outcome_id: string;
};

export type EventDependencyReceipt = {
  objectType: "event_dependency_doctor";
  generatedAt: string;
  status: "clean" | "findings";
  event: EventRow;
  childCount: number;
  warnings: string[];
  children: Array<{
    id: string;
    title: string;
    status: string;
    closeAt: string;
    resolvedAt: string | null;
    expectedResolutionAt: string | null;
    resolutionCaseCount: number;
    settlementStatus: string | null;
    winnerCount: number;
    winnerLabel: string | null;
    affirmativeWinner: boolean;
    flags: Record<string, unknown>;
  }>;
};

export type ActiveEventLifecycleAuditReport = {
  objectType: "active_event_lifecycle_audit";
  generatedAt: string;
  status: "clean" | "findings";
  auditedEventCount: number;
  findingEventCount: number;
  warningCount: number;
  events: EventDependencyReceipt[];
};

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function boolAt(value: unknown): boolean {
  return value === true || value === "true";
}

function childFlags(child: ChildRow): Record<string, unknown> {
  const contract = readObject(child.market_contract);
  const operational = readObject(contract.operational);
  const dependency = readObject(contract.dependencyResolution);
  return {
    marketKindId: contract.marketKindId ?? null,
    resultShape: contract.resultShape ?? null,
    acceptFact: dependency.acceptFact ?? null,
    entityKey: dependency.entityKey ?? null,
    earlyEliminationClose: boolAt(operational.earlyEliminationClose),
    terminalEvidenceAutoClose: boolAt(operational.terminalEvidenceAutoClose),
    eventCompletionCloseRequiresHumanApproval: contract.eventCompletionCloseRequiresHumanApproval ?? null
  };
}

function isTerminal(status: string): boolean {
  return status === "resolved" || status === "voided";
}

function normalizeWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings));
}

export function inspectEventDependencies(
  event: EventRow,
  children: ChildRow[],
  now = new Date()
): string[] {
  const warnings: string[] = [];
  if (children.length <= 1) {
    warnings.push("single_child_event");
  }
  if (event.resolution_policy === "exclusive_first_hit") {
    const affirmativeWinnerCount = children.reduce(
      (sum, child) => sum + child.affirmative_winner_count,
      0
    );
    if (affirmativeWinnerCount > 1) {
      warnings.push("exclusive_first_hit_has_multiple_winners");
    }
    if (event.status === "completed" && affirmativeWinnerCount === 0) {
      warnings.push("exclusive_first_hit_has_no_affirmative_winner");
    }
    if (
      affirmativeWinnerCount === 1 &&
      children.some((child) => !isTerminal(child.status))
    ) {
      warnings.push("exclusive_first_hit_has_nonterminal_siblings_after_affirmative_winner");
    }
  }

  const allChildrenTerminal = children.length > 0 && children.every((child) => isTerminal(child.status));
  if (event.status === "active" && allChildrenTerminal) {
    warnings.push("active_event_has_only_terminal_children");
  }
  if (event.status === "completed" && children.some((child) => !isTerminal(child.status))) {
    warnings.push("completed_event_has_nonterminal_children");
  }

  for (const child of children) {
    const flags = childFlags(child);
    if (flags.marketKindId === "sports.tournament-winner") {
      if (!flags.earlyEliminationClose) {
        warnings.push(`${child.id}: tournament child lacks early-elimination policy`);
      }
      if (flags.acceptFact !== "entity_eliminated" && !flags.terminalEvidenceAutoClose) {
        warnings.push(`${child.id}: tournament child has no executable elimination route`);
      }
      if (
        flags.acceptFact === "entity_eliminated" &&
        (typeof flags.entityKey !== "string" || !flags.entityKey.trim())
      ) {
        warnings.push(`${child.id}: elimination receiver has no entity key`);
      }
    }
    if (child.status === "open" && child.close_at.getTime() <= now.getTime()) {
      warnings.push(`${child.id}: open past close_at`);
    }
    if (
      child.status === "closed" &&
      !child.resolved_at &&
      child.resolution_case_count === 0
    ) {
      warnings.push(`${child.id}: closed without resolution case`);
    }
    if (child.status === "resolved" && child.winner_count !== 1) {
      warnings.push(`${child.id}: resolved market winner_count=${child.winner_count}`);
    }
    if (child.status === "resolved" && child.settlement_status !== "completed") {
      warnings.push(`${child.id}: resolved market settlement_status=${child.settlement_status ?? "missing"}`);
    }
  }

  return normalizeWarnings(warnings);
}

async function readEvent(
  db: Queryable,
  eventId: string
): Promise<EventRow | null> {
  return (
    await db.query<EventRow>(
        `
          select id, slug, title, status, resolution_policy, sibling_resolution_requires_human_approval
          from events
          where id = $1 or slug = $1
          limit 1
        `,
        [eventId]
      )
  ).rows[0] ?? null;
}

async function readEventChildren(db: Queryable, eventId: string): Promise<ChildRow[]> {
  return (
    await db.query<ChildRow>(
        `
          select
            m.id,
            m.title,
            m.status,
            m.close_at,
            m.resolved_at,
            m.market_contract,
            nullif(m.market_contract #>> '{timeline,expectedResolutionAt}', '') as expected_resolution_at,
            m.settlement_status,
            count(distinct mo.id) filter (where mo.is_winner is true)::int as winner_count,
            count(distinct mo.id) filter (where mo.is_winner is true and mo.sort_order = 0)::int as affirmative_winner_count,
            max(mo.label) filter (where mo.is_winner is true) as winner_label,
            (
              select count(*)::int
              from oracle_cases oc
              where oc.market_id = m.id
                and oc.case_type = 'resolution_check'
                and oc.case_status in ('recommended', 'review_needed')
            ) as resolution_case_count
          from markets m
          left join market_outcomes mo on mo.market_id = m.id
          where m.event_id = $1
          group by m.id
          order by m.close_at asc, m.published_at asc, m.id asc
        `,
        [eventId]
      )
  ).rows;
}

async function readAuditableMultiChildEventIds(db: Queryable): Promise<string[]> {
  return (
    await db.query<{ id: string }>(
      `
        select e.id
        from events e
        join markets m on m.event_id = e.id
        where e.status = 'active'
           or (e.status = 'completed' and e.updated_at >= now() - interval '7 days')
        group by e.id
        having count(m.id) > 1
        order by min(m.close_at) asc, e.id asc
      `
    )
  ).rows.map((row) => row.id);
}

async function readResolvedCascadeTriggers(
  db: Queryable,
  targetEventIds: Set<string>
): Promise<ResolvedCascadeTriggerRow[]> {
  if (targetEventIds.size === 0) {
    return [];
  }

  const eventIds = [...targetEventIds];
  const includeLegacyFifaBridge = targetEventIds.has("evt-fifa-world-cup-2026-winner");

  return (
    await db.query<ResolvedCascadeTriggerRow>(
      `
        select
          m.id as market_id,
          mr.winning_outcome_id
        from markets m
        join market_resolutions mr
          on mr.market_id = m.id
        where m.status = 'resolved'
          and mr.winning_outcome_id is not null
          and (
            (
              m.market_contract #>> '{dependentResolution,emitFact}' = 'entity_eliminated'
              and coalesce(
                nullif(m.market_contract #>> '{dependentResolution,targetEventId}', ''),
                nullif(m.market_contract #>> '{operational,dependentEventId}', '')
              ) = any($1::text[])
            )
            or (
              $2::boolean is true
              and m.market_contract->>'marketKindId' = 'sports.game-winner'
              and m.market_contract->>'resultShape' = 'home_away_winner'
              and m.market_contract #>> '{resolutionSource,sourceIds}' like '%src_fifa_match_centre%'
            )
          )
        order by coalesce(m.resolved_at, m.updated_at, m.close_at) desc, m.id asc
      `,
      [eventIds, includeLegacyFifaBridge]
    )
  ).rows;
}

async function readStaleDependentCascadeWarnings(
  db: Queryable,
  childMarketIds: Set<string>,
  targetEventIds: Set<string>
): Promise<Map<string, string[]>> {
  if (childMarketIds.size === 0) {
    return new Map();
  }

  const triggers = await readResolvedCascadeTriggers(db, targetEventIds);
  const warnings = new Map<string, string[]>();

  for (const trigger of triggers) {
    const plan = await planDependentResolutionCascade(db, {
      triggerMarketId: trigger.market_id,
      triggerWinningOutcomeId: trigger.winning_outcome_id,
      approvedByHuman: true
    });

    for (const action of plan.dependentActions) {
      if (!childMarketIds.has(action.marketId)) {
        continue;
      }
      const existing = warnings.get(action.marketId) ?? [];
      existing.push(
        `${action.marketId}: stale dependent cascade from ${trigger.market_id} still needs NO resolution for ${action.entityLabel}`
      );
      warnings.set(action.marketId, existing);
    }

    for (const blocker of plan.blockers) {
      const marketId = blocker.split(":")[1];
      if (!marketId || !childMarketIds.has(marketId)) {
        continue;
      }
      const existing = warnings.get(marketId) ?? [];
      existing.push(`${marketId}: dependent cascade blocked after ${trigger.market_id}: ${blocker}`);
      warnings.set(marketId, existing);
    }
  }

  return warnings;
}

function buildEventReceipt(
  event: EventRow,
  children: ChildRow[],
  generatedAt: string,
  now: Date,
  staleCascadeWarnings = new Map<string, string[]>()
): EventDependencyReceipt {
  const warnings = normalizeWarnings([
    ...inspectEventDependencies(event, children, now),
    ...children.flatMap((child) => staleCascadeWarnings.get(child.id) ?? [])
  ]);
  return {
    objectType: "event_dependency_doctor",
    generatedAt,
    status: warnings.length > 0 ? "findings" : "clean",
    event,
    childCount: children.length,
    warnings,
    children: children.map((child) => ({
      id: child.id,
      title: child.title,
      status: child.status,
      closeAt: child.close_at.toISOString(),
      resolvedAt: child.resolved_at?.toISOString() ?? null,
      expectedResolutionAt: child.expected_resolution_at,
      resolutionCaseCount: child.resolution_case_count,
      settlementStatus: child.settlement_status,
      winnerCount: child.winner_count,
      winnerLabel: child.winner_label,
      affirmativeWinner: child.affirmative_winner_count === 1,
      flags: childFlags(child)
    }))
  };
}

async function inspectOneEvent(
  db: Queryable,
  eventId: string,
  generatedAt: string,
  now: Date,
  staleCascadeWarnings?: Map<string, string[]>
): Promise<EventDependencyReceipt | null> {
  const event = await readEvent(db, eventId);
  if (!event) return null;
  const children = await readEventChildren(db, event.id);
  const effectiveStaleCascadeWarnings =
    staleCascadeWarnings ??
    await readStaleDependentCascadeWarnings(
      db,
      new Set(children.map((child) => child.id)),
      new Set([event.id])
    );
  return buildEventReceipt(event, children, generatedAt, now, effectiveStaleCascadeWarnings);
}

export async function auditActiveEvents(
  db: Queryable,
  now = new Date()
): Promise<ActiveEventLifecycleAuditReport> {
  const generatedAt = now.toISOString();
  const eventIds = await readAuditableMultiChildEventIds(db);
  const eventInputs = (
    await Promise.all(eventIds.map(async (eventId) => {
      const event = await readEvent(db, eventId);
      if (!event) return null;
      const children = await readEventChildren(db, event.id);
      return { event, children };
    }))
  ).filter((input): input is { event: EventRow; children: ChildRow[] } => input !== null);
  const staleCascadeWarnings = await readStaleDependentCascadeWarnings(
    db,
    new Set(eventInputs.flatMap((input) => input.children.map((child) => child.id))),
    new Set(eventInputs.map((input) => input.event.id))
  );
  const receipts = eventInputs.map((input) =>
    buildEventReceipt(input.event, input.children, generatedAt, now, staleCascadeWarnings)
  );
  const warningCount = receipts.reduce((sum, receipt) => sum + receipt.warnings.length, 0);

  return {
    objectType: "active_event_lifecycle_audit",
    generatedAt,
    status: warningCount > 0 ? "findings" : "clean",
    auditedEventCount: receipts.length,
    findingEventCount: receipts.filter((receipt) => receipt.warnings.length > 0).length,
    warningCount,
    events: receipts
  };
}

export function formatEventAuditAlert(report: ActiveEventLifecycleAuditReport): string {
  const details = report.events
    .filter((event) => event.warnings.length > 0)
    .flatMap((event) => event.warnings.map((warning) => `${event.event.slug ?? event.event.id}: ${warning}`));
  const visible = details.slice(0, 8);
  const omitted = Math.max(0, details.length - visible.length);
  return [
    `event-audit: findings at ${report.generatedAt}; events=${report.findingEventCount}/${report.auditedEventCount}; warnings=${report.warningCount}`,
    ...visible,
    ...(omitted > 0 ? [`+${omitted} more; run event-audit for the full report`] : [])
  ].join("\n");
}

async function sendPlatformAlert(scriptPath: string, message: string): Promise<void> {
  try {
    const result = await execFileAsync(scriptPath, ["--require-delivery", "send", message], {
      timeout: 15_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) console.error(`[event-audit] platform alert result: ${output}`);
  } catch (error) {
    console.error(
      `[event-audit] platform alert failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function printReport(payload: unknown, jsonl: boolean): void {
  console.log(JSON.stringify(payload, null, jsonl ? 0 : 2));
}

async function run(options: Options): Promise<void> {
  const eventId = options.event?.trim();
  if ((!eventId && !options.allActive) || (eventId && options.allActive)) {
    throw new Error("Pass exactly one of --event <id-or-slug> or --all-active.");
  }

  const pool = createDbPool(loadAppEnv().db);
  try {
    const now = new Date();
    if (eventId) {
      const receipt = await inspectOneEvent(pool, eventId, now.toISOString(), now);
      if (!receipt) {
        printReport({ objectType: "event_dependency_doctor", status: "missing_event", event: eventId }, Boolean(options.jsonl));
        process.exitCode = 2;
        return;
      }
      printReport(receipt, Boolean(options.jsonl));
      if (receipt.warnings.length > 0) process.exitCode = 2;
      return;
    }

    const report = await auditActiveEvents(pool, now);
    if (!(options.quietIfClean && report.status === "clean")) {
      printReport(report, Boolean(options.jsonl));
    }
    if (report.status === "findings" && options.alert) {
      const alertScript = resolve(
        repoRoot,
        options.alertScript ?? readEnvValue("PLATFORM_ALERT_SCRIPT", "workspace/scripts/platform-alert.sh")
      );
      await sendPlatformAlert(alertScript, formatEventAuditAlert(report));
    }
    if (report.status === "findings" && options.failOnFindings) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("event-dependency-doctor")
  .description("Read-only event/child dependency and lifecycle audit.")
  .option("--event <event-id-or-slug>")
  .option("--all-active", "Audit active and recently completed multi-child events.")
  .option("--json")
  .option("--jsonl")
  .option("--quiet-if-clean", "Print nothing when an all-active audit is clean.")
  .option("--alert", "Send a platform alert when an all-active audit has findings.")
  .option("--alert-script <path>")
  .option("--fail-on-findings", "Exit non-zero when findings exist.")
  .action(run);

if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
