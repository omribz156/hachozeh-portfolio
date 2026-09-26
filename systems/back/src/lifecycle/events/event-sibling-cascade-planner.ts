import type { Queryable } from "../../db/client/pool";
import type { EventResolutionPolicy } from "../management/create-market-draft-service";

type MarketLifecycleStatus = "draft" | "open" | "closed" | "resolved" | "voided";

type EventRow = {
  id: string;
  resolution_policy: EventResolutionPolicy;
  sibling_resolution_requires_human_approval: boolean;
  status: "active" | "completed";
};

type EventChildOutcomeRow = {
  market_id: string;
  market_status: MarketLifecycleStatus;
  winning_outcome_id: string | null;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

type EventChildOutcome = {
  outcomeId: string;
  label: string;
  sortOrder: number;
};

type EventChildMarket = {
  marketId: string;
  status: MarketLifecycleStatus;
  winningOutcomeId: string | null;
  outcomes: EventChildOutcome[];
};

export type EventSiblingCascadeTrigger = {
  triggerMarketId: string;
  triggerWinningOutcomeId: string;
  approvedByHuman: boolean;
  oracleCaseId?: string | null;
  reviewId?: string | null;
};

type EventSiblingCascadeAction = {
  marketId: string;
  action: "resolve_no";
  noOutcomeId: string;
  currentStatus: MarketLifecycleStatus;
  reason: "exclusive_first_hit";
};

type EventSiblingCascadeSkippedChild = {
  marketId: string;
  reason: "trigger_market" | "already_terminal" | "single_child_event";
};

export type EventSiblingCascadePlan = {
  objectType: "event_sibling_resolution_cascade_plan";
  eventId: string;
  resolutionPolicy: EventResolutionPolicy | null;
  triggerMarketId: string;
  triggerWinningOutcomeId: string;
  action: "none" | "resolve_siblings_no" | "blocked";
  requiresHumanApproval: boolean;
  siblingActions: EventSiblingCascadeAction[];
  skippedChildren: EventSiblingCascadeSkippedChild[];
  blockers: string[];
  context: {
    childCount: number;
    oracleCaseId: string | null;
    reviewId: string | null;
  };
};

type BinaryOutcomeMap = {
  yesOutcomeId: string;
  noOutcomeId: string;
};

const TERMINAL_STATUSES = new Set<MarketLifecycleStatus>(["resolved", "voided"]);

function buildPlan(input: {
  eventId: string;
  resolutionPolicy: EventResolutionPolicy | null;
  trigger: EventSiblingCascadeTrigger;
  action: EventSiblingCascadePlan["action"];
  requiresHumanApproval: boolean;
  siblingActions?: EventSiblingCascadeAction[];
  skippedChildren?: EventSiblingCascadeSkippedChild[];
  blockers?: string[];
  childCount?: number;
}): EventSiblingCascadePlan {
  return {
    objectType: "event_sibling_resolution_cascade_plan",
    eventId: input.eventId,
    resolutionPolicy: input.resolutionPolicy,
    triggerMarketId: input.trigger.triggerMarketId,
    triggerWinningOutcomeId: input.trigger.triggerWinningOutcomeId,
    action: input.action,
    requiresHumanApproval: input.requiresHumanApproval,
    siblingActions: input.siblingActions ?? [],
    skippedChildren: input.skippedChildren ?? [],
    blockers: input.blockers ?? [],
    context: {
      childCount: input.childCount ?? 0,
      oracleCaseId: input.trigger.oracleCaseId ?? null,
      reviewId: input.trigger.reviewId ?? null
    }
  };
}

function normalizeOutcomeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function isYesOutcome(outcome: EventChildOutcome): boolean {
  const label = normalizeOutcomeLabel(outcome.label);
  const outcomeId = outcome.outcomeId.toLowerCase();
  return label === "yes" || label === "כן" || /(^|-)(yes|ken|true)$/.test(outcomeId);
}

function isNoOutcome(outcome: EventChildOutcome): boolean {
  const label = normalizeOutcomeLabel(outcome.label);
  const outcomeId = outcome.outcomeId.toLowerCase();
  return label === "no" || label === "לא" || /(^|-)(no|lo|false)$/.test(outcomeId);
}

function readBinaryOutcomeMap(child: EventChildMarket): BinaryOutcomeMap | null {
  if (child.outcomes.length !== 2) {
    return null;
  }

  const yesOutcome = child.outcomes.find(isYesOutcome);
  const noOutcome = child.outcomes.find(isNoOutcome);

  if (!yesOutcome || !noOutcome || yesOutcome.outcomeId === noOutcome.outcomeId) {
    return null;
  }

  return {
    yesOutcomeId: yesOutcome.outcomeId,
    noOutcomeId: noOutcome.outcomeId
  };
}

function mapChildRows(rows: EventChildOutcomeRow[]): EventChildMarket[] {
  const byMarket = new Map<string, EventChildMarket>();

  for (const row of rows) {
    const child = byMarket.get(row.market_id) ?? {
      marketId: row.market_id,
      status: row.market_status,
      winningOutcomeId: row.winning_outcome_id,
      outcomes: []
    };

    child.outcomes.push({
      outcomeId: row.outcome_id,
      label: row.outcome_label,
      sortOrder: row.sort_order
    });
    byMarket.set(row.market_id, child);
  }

  return Array.from(byMarket.values()).map((child) => ({
    ...child,
    outcomes: child.outcomes.sort((left, right) => left.sortOrder - right.sortOrder)
  }));
}

async function readEvent(db: Queryable, eventId: string): Promise<EventRow | null> {
  const result = await db.query<EventRow>(
    `
      select
        id,
        resolution_policy,
        sibling_resolution_requires_human_approval,
        status
      from events
      where id = $1
      limit 1
    `,
    [eventId]
  );

  return result.rows[0] ?? null;
}

async function readEventChildren(db: Queryable, eventId: string): Promise<EventChildMarket[]> {
  const result = await db.query<EventChildOutcomeRow>(
    `
      select
        m.id as market_id,
        m.status as market_status,
        mr.winning_outcome_id,
        mo.id as outcome_id,
        mo.label as outcome_label,
        mo.sort_order
      from markets m
      join market_outcomes mo
        on mo.market_id = m.id
      left join market_resolutions mr
        on mr.market_id = m.id
      where m.event_id = $1
      order by m.published_at asc nulls last, m.close_at asc, m.id asc, mo.sort_order asc
    `,
    [eventId]
  );

  return mapChildRows(result.rows);
}

export async function planEventSiblingResolutionCascade(
  db: Queryable,
  eventId: string,
  trigger: EventSiblingCascadeTrigger
): Promise<EventSiblingCascadePlan> {
  const event = await readEvent(db, eventId);

  if (!event) {
    return buildPlan({
      eventId,
      resolutionPolicy: null,
      trigger,
      action: "blocked",
      requiresHumanApproval: true,
      blockers: ["event_not_found"]
    });
  }

  const children = await readEventChildren(db, eventId);
  const triggerChild = children.find((child) => child.marketId === trigger.triggerMarketId);

  if (event.resolution_policy === "independent_children") {
    return buildPlan({
      eventId,
      resolutionPolicy: event.resolution_policy,
      trigger,
      action: "none",
      requiresHumanApproval: event.sibling_resolution_requires_human_approval,
      childCount: children.length
    });
  }

  const blockers: string[] = [];
  const binaryMaps = new Map<string, BinaryOutcomeMap>();

  if (!trigger.approvedByHuman) {
    blockers.push("trigger_not_human_approved");
  }

  if (!triggerChild) {
    blockers.push("trigger_market_not_in_event");
  }

  if (children.length <= 1) {
    return buildPlan({
      eventId,
      resolutionPolicy: event.resolution_policy,
      trigger,
      action: blockers.length > 0 ? "blocked" : "none",
      requiresHumanApproval: event.sibling_resolution_requires_human_approval,
      blockers,
      childCount: children.length,
      skippedChildren: triggerChild
        ? [{ marketId: triggerChild.marketId, reason: "single_child_event" }]
        : []
    });
  }

  for (const child of children) {
    const binaryMap = readBinaryOutcomeMap(child);

    if (!binaryMap) {
      blockers.push(`child_not_yes_no_binary:${child.marketId}`);
      continue;
    }

    binaryMaps.set(child.marketId, binaryMap);
  }

  const triggerMap = triggerChild ? binaryMaps.get(triggerChild.marketId) : null;

  if (triggerMap && trigger.triggerWinningOutcomeId !== triggerMap.yesOutcomeId) {
    blockers.push("trigger_winner_not_yes");
  }

  for (const child of children) {
    if (child.marketId === trigger.triggerMarketId) {
      continue;
    }

    const binaryMap = binaryMaps.get(child.marketId);

    if (
      child.status === "resolved" &&
      binaryMap &&
      child.winningOutcomeId === binaryMap.yesOutcomeId
    ) {
      blockers.push(`existing_yes_sibling:${child.marketId}`);
    }
  }

  if (blockers.length > 0) {
    return buildPlan({
      eventId,
      resolutionPolicy: event.resolution_policy,
      trigger,
      action: "blocked",
      requiresHumanApproval: event.sibling_resolution_requires_human_approval,
      blockers,
      childCount: children.length
    });
  }

  const siblingActions: EventSiblingCascadeAction[] = [];
  const skippedChildren: EventSiblingCascadeSkippedChild[] = [];

  for (const child of children) {
    if (child.marketId === trigger.triggerMarketId) {
      skippedChildren.push({ marketId: child.marketId, reason: "trigger_market" });
      continue;
    }

    if (TERMINAL_STATUSES.has(child.status)) {
      skippedChildren.push({ marketId: child.marketId, reason: "already_terminal" });
      continue;
    }

    const binaryMap = binaryMaps.get(child.marketId)!;
    siblingActions.push({
      marketId: child.marketId,
      action: "resolve_no",
      noOutcomeId: binaryMap.noOutcomeId,
      currentStatus: child.status,
      reason: "exclusive_first_hit"
    });
  }

  return buildPlan({
    eventId,
    resolutionPolicy: event.resolution_policy,
    trigger,
    action: siblingActions.length > 0 ? "resolve_siblings_no" : "none",
    requiresHumanApproval: event.sibling_resolution_requires_human_approval,
    siblingActions,
    skippedChildren,
    childCount: children.length
  });
}
