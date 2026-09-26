import type { Queryable } from "../../db/client/pool";

type MarketLifecycleStatus = "draft" | "open" | "closed" | "resolved" | "voided";

type JsonRecord = Record<string, unknown>;

type TriggerOutcomeRow = {
  market_id: string;
  market_status: MarketLifecycleStatus;
  market_title: string;
  market_contract: unknown | null;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

type CandidateOutcomeRow = {
  event_id: string | null;
  market_id: string;
  market_status: MarketLifecycleStatus;
  market_title: string;
  market_contract: unknown | null;
  winning_outcome_id: string | null;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

type Outcome = {
  outcomeId: string;
  label: string;
  sortOrder: number;
};

type TriggerMarket = {
  marketId: string;
  status: MarketLifecycleStatus;
  title: string;
  contract: JsonRecord | null;
  outcomes: Outcome[];
};

type CandidateMarket = {
  eventId: string | null;
  marketId: string;
  status: MarketLifecycleStatus;
  title: string;
  contract: JsonRecord | null;
  winningOutcomeId: string | null;
  outcomes: Outcome[];
};

type BinaryOutcomeMap = {
  yesOutcomeId: string;
  noOutcomeId: string;
};

type DependentResolutionFact = {
  factType: "entity_eliminated";
  entityLabel: string;
  entityKeys: string[];
  targetEventId: string | null;
};

export type DependentResolutionCascadeTrigger = {
  triggerMarketId: string;
  triggerWinningOutcomeId: string;
  approvedByHuman: boolean;
  trustedOfficialFinal?: boolean;
  oracleCaseId?: string | null;
  reviewId?: string | null;
};

export type DependentResolutionCascadeAction = {
  marketId: string;
  action: "resolve_no";
  noOutcomeId: string;
  currentStatus: MarketLifecycleStatus;
  reason: "dependent_entity_eliminated";
  entityLabel: string;
  entityKeys: string[];
};

export type DependentResolutionCascadeSkippedMarket = {
  marketId: string;
  reason: "already_terminal" | "not_matching_dependency" | "not_yes_no_binary";
};

export type DependentResolutionCascadePlan = {
  objectType: "dependent_resolution_cascade_plan";
  triggerMarketId: string;
  triggerWinningOutcomeId: string;
  action: "none" | "resolve_dependents_no" | "blocked";
  facts: DependentResolutionFact[];
  dependentActions: DependentResolutionCascadeAction[];
  skippedMarkets: DependentResolutionCascadeSkippedMarket[];
  blockers: string[];
  context: {
    oracleCaseId: string | null;
    reviewId: string | null;
    candidateCount: number;
  };
};

const TERMINAL_STATUSES = new Set<MarketLifecycleStatus>(["resolved", "voided"]);
const FIFA_WORLD_CUP_WINNER_EVENT_PACK = "fifa-world-cup-2026-winner";
const FIFA_WORLD_CUP_WINNER_EVENT_ID = "evt-fifa-world-cup-2026-winner";

function buildPlan(input: {
  trigger: DependentResolutionCascadeTrigger;
  action: DependentResolutionCascadePlan["action"];
  facts?: DependentResolutionFact[];
  dependentActions?: DependentResolutionCascadeAction[];
  skippedMarkets?: DependentResolutionCascadeSkippedMarket[];
  blockers?: string[];
  candidateCount?: number;
}): DependentResolutionCascadePlan {
  return {
    objectType: "dependent_resolution_cascade_plan",
    triggerMarketId: input.trigger.triggerMarketId,
    triggerWinningOutcomeId: input.trigger.triggerWinningOutcomeId,
    action: input.action,
    facts: input.facts ?? [],
    dependentActions: input.dependentActions ?? [],
    skippedMarkets: input.skippedMarkets ?? [],
    blockers: input.blockers ?? [],
    context: {
      oracleCaseId: input.trigger.oracleCaseId ?? null,
      reviewId: input.trigger.reviewId ?? null,
      candidateCount: input.candidateCount ?? 0
    }
  };
}

function readObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [item.trim()];
    }

    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as JsonRecord;
      return [record.id, record.key, record.slug, record.label, record.name]
        .map(readString)
        .filter((candidate): candidate is string => Boolean(candidate));
    }

    return [];
  });
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[״״"']/g, "")
    .replace(/\s+/g, " ");
}

function normalizeToken(value: string): string {
  return normalizeKey(value).replace(/[^a-z0-9\u0590-\u05ff]+/g, "-").replace(/^-|-$/g, "");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeKey).filter(Boolean)));
}

function isYesOutcome(outcome: Outcome): boolean {
  const label = normalizeKey(outcome.label);
  const outcomeId = outcome.outcomeId.toLowerCase();
  return label === "yes" || label === "כן" || /(^|-)(yes|ken|true)$/.test(outcomeId);
}

function isNoOutcome(outcome: Outcome): boolean {
  const label = normalizeKey(outcome.label);
  const outcomeId = outcome.outcomeId.toLowerCase();
  return label === "no" || label === "לא" || /(^|-)(no|lo|false)$/.test(outcomeId);
}

function readBinaryOutcomeMap(market: CandidateMarket): BinaryOutcomeMap | null {
  if (market.outcomes.length !== 2) {
    return null;
  }

  const yesOutcome = market.outcomes.find(isYesOutcome);
  const noOutcome = market.outcomes.find(isNoOutcome);

  if (!yesOutcome || !noOutcome || yesOutcome.outcomeId === noOutcome.outcomeId) {
    return null;
  }

  return {
    yesOutcomeId: yesOutcome.outcomeId,
    noOutcomeId: noOutcome.outcomeId
  };
}

function readContractPathString(contract: JsonRecord | null, path: string[]): string | null {
  let current: unknown = contract;
  for (const part of path) {
    const object = readObject(current);
    if (!object) return null;
    current = object[part];
  }
  return readString(current);
}

function readContractPathBoolean(contract: JsonRecord | null, path: string[]): boolean | null {
  let current: unknown = contract;
  for (const part of path) {
    const object = readObject(current);
    if (!object) return null;
    current = object[part];
  }
  return readBoolean(current);
}

function readContractValues(contract: JsonRecord | null): string[] {
  if (!contract) {
    return [];
  }

  const taxonomy = readObject(contract.taxonomy);
  const timeline = readObject(contract.timeline);
  const operational = readObject(contract.operational);
  const dependencyResolution = readObject(contract.dependencyResolution);

  return unique([
    readString(timeline?.targetEntity),
    readString(dependencyResolution?.entityKey),
    readString(dependencyResolution?.entityLabel),
    ...readStringArray(taxonomy?.entities),
    ...readStringArray(taxonomy?.aliases),
    ...readStringArray(taxonomy?.visibleTags),
    readString(operational?.eventPack),
    readString(operational?.entityKey)
  ].filter((value): value is string => Boolean(value)));
}

function mapTriggerRows(rows: TriggerOutcomeRow[]): TriggerMarket | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  return {
    marketId: first.market_id,
    status: first.market_status,
    title: first.market_title,
    contract: readObject(first.market_contract),
    outcomes: rows
      .map((row) => ({
        outcomeId: row.outcome_id,
        label: row.outcome_label,
        sortOrder: row.sort_order
      }))
      .sort((left, right) => left.sortOrder - right.sortOrder)
  };
}

function mapCandidateRows(rows: CandidateOutcomeRow[]): CandidateMarket[] {
  const byMarket = new Map<string, CandidateMarket>();

  for (const row of rows) {
    const market = byMarket.get(row.market_id) ?? {
      eventId: row.event_id,
      marketId: row.market_id,
      status: row.market_status,
      title: row.market_title,
      contract: readObject(row.market_contract),
      winningOutcomeId: row.winning_outcome_id,
      outcomes: []
    };

    market.outcomes.push({
      outcomeId: row.outcome_id,
      label: row.outcome_label,
      sortOrder: row.sort_order
    });
    byMarket.set(row.market_id, market);
  }

  return Array.from(byMarket.values()).map((market) => ({
    ...market,
    outcomes: market.outcomes.sort((left, right) => left.sortOrder - right.sortOrder)
  }));
}

function isEligibleTrigger(triggerMarket: TriggerMarket): boolean {
  const contract = triggerMarket.contract;
  const marketKindId = readContractPathString(contract, ["marketKindId"]);
  const resultShape = readContractPathString(contract, ["resultShape"]);
  const sourceIds = readStringArray(readObject(contract?.resolutionSource)?.sourceIds);

  if (
    readContractPathString(contract, ["dependentResolution", "emitFact"]) === "entity_eliminated" &&
    readDependentTargetEventId(contract)
  ) {
    return true;
  }

  // Temporary bridge for live FIFA contracts published before explicit event links.
  if (
    marketKindId === "sports.game-winner" &&
    resultShape === "home_away_winner" &&
    sourceIds.includes("src_fifa_match_centre")
  ) {
    return true;
  }

  return false;
}

function readDependentTargetEventId(contract: JsonRecord | null): string | null {
  return (
    readContractPathString(contract, ["dependentResolution", "targetEventId"]) ??
    readContractPathString(contract, ["operational", "dependentEventId"])
  );
}

function readOutcomeDependencyKeys(contract: JsonRecord | null, outcome: Outcome): string[] {
  const outcomeMap = Array.isArray(contract?.outcomeMap) ? contract.outcomeMap : [];
  const mapped = outcomeMap
    .map(readObject)
    .find((item) => normalizeKey(readString(item?.outcomeLabel) ?? "") === normalizeKey(outcome.label));

  return unique([
    outcome.label,
    normalizeToken(outcome.label),
    readString(mapped?.eliminatesEntityKey),
    readString(mapped?.eliminatedEntityKey),
    readString(mapped?.entityKey),
    readString(mapped?.teamKey),
    readString(mapped?.resolutionPath)?.split(/\s+/)[0] ?? null
  ].filter((value): value is string => Boolean(value)));
}

function readExplicitEliminationFact(
  contract: JsonRecord | null,
  outcome: Outcome,
  targetEventId: string | null
): DependentResolutionFact | null {
  const outcomeMap = Array.isArray(contract?.outcomeMap) ? contract.outcomeMap : [];
  const mapped = outcomeMap
    .map(readObject)
    .find((item) => normalizeKey(readString(item?.outcomeLabel) ?? "") === normalizeKey(outcome.label));
  const entityKey =
    readString(mapped?.eliminatesEntityKey) ??
    readString(mapped?.eliminatedEntityKey);

  if (!entityKey || !targetEventId) return null;

  return {
    factType: "entity_eliminated",
    entityLabel:
      readString(mapped?.eliminatesEntityLabel) ??
      readString(mapped?.eliminatedEntityLabel) ??
      outcome.label,
    entityKeys: unique([entityKey, normalizeToken(entityKey)]),
    targetEventId
  };
}

function deriveEliminationFacts(
  triggerMarket: TriggerMarket,
  triggerWinningOutcomeId: string
): DependentResolutionFact[] {
  if (!isEligibleTrigger(triggerMarket)) {
    return [];
  }

  const winner = triggerMarket.outcomes.find((outcome) => outcome.outcomeId === triggerWinningOutcomeId);
  if (!winner) {
    return [];
  }

  const targetEventId =
    readDependentTargetEventId(triggerMarket.contract) ??
    (readContractPathString(triggerMarket.contract, ["operational", "eventPack"]) === "fifa-world-cup-2026-semifinals"
      ? FIFA_WORLD_CUP_WINNER_EVENT_ID
      : null);
  const explicitFact = readExplicitEliminationFact(triggerMarket.contract, winner, targetEventId);
  if (explicitFact) return [explicitFact];

  if (triggerMarket.outcomes.length !== 2 || !targetEventId) {
    return [];
  }

  const loser = triggerMarket.outcomes.find((outcome) => outcome.outcomeId !== triggerWinningOutcomeId);
  if (!loser) {
    return [];
  }

  return [
    {
      factType: "entity_eliminated",
      entityLabel: loser.label,
      entityKeys: readOutcomeDependencyKeys(triggerMarket.contract, loser),
      targetEventId
    }
  ];
}

function candidateCanResolveEarly(candidate: CandidateMarket): boolean {
  const contract = candidate.contract;
  const marketKindId = readContractPathString(contract, ["marketKindId"]);
  const operationalPack = readContractPathString(contract, ["operational", "eventPack"]);
  const earlyEliminationClose = readContractPathBoolean(contract, ["operational", "earlyEliminationClose"]);
  const dependencyResolution = readObject(contract?.dependencyResolution);

  if (readString(dependencyResolution?.acceptFact) === "entity_eliminated") {
    return true;
  }

  return (
    marketKindId === "sports.tournament-winner" &&
    operationalPack === FIFA_WORLD_CUP_WINNER_EVENT_PACK &&
    earlyEliminationClose === true
  );
}

function candidateMatchesFact(candidate: CandidateMarket, fact: DependentResolutionFact): boolean {
  if (fact.targetEventId && candidate.eventId !== fact.targetEventId) {
    return false;
  }
  const candidateValues = readContractValues(candidate.contract);
  const hasExplicitDependency =
    readContractPathString(candidate.contract, ["dependencyResolution", "acceptFact"]) === "entity_eliminated";
  const titleToken = normalizeKey(candidate.title);
  const marketIdToken = normalizeKey(candidate.marketId);

  return fact.entityKeys.some((entityKey) => {
    const normalized = normalizeKey(entityKey);
    if (!normalized) return false;
    return (
      candidateValues.includes(normalized) ||
      (!hasExplicitDependency && (
        titleToken.includes(normalized) ||
        marketIdToken.includes(normalizeToken(normalized))
      ))
    );
  });
}

async function readTriggerMarket(
  db: Queryable,
  marketId: string
): Promise<TriggerMarket | null> {
  const result = await db.query<TriggerOutcomeRow>(
    `
      select
        m.id as market_id,
        m.status as market_status,
        m.title as market_title,
        m.market_contract,
        mo.id as outcome_id,
        mo.label as outcome_label,
        mo.sort_order
      from markets m
      join market_outcomes mo
        on mo.market_id = m.id
      where m.id = $1
      order by mo.sort_order asc
    `,
    [marketId]
  );

  return mapTriggerRows(result.rows);
}

async function readCandidateMarkets(
  db: Queryable,
  triggerMarketId: string
): Promise<CandidateMarket[]> {
  const result = await db.query<CandidateOutcomeRow>(
    `
      select
        m.event_id,
        m.id as market_id,
        m.status as market_status,
        m.title as market_title,
        m.market_contract,
        mr.winning_outcome_id,
        mo.id as outcome_id,
        mo.label as outcome_label,
        mo.sort_order
      from markets m
      join market_outcomes mo
        on mo.market_id = m.id
      left join market_resolutions mr
        on mr.market_id = m.id
      where m.id <> $1
        and m.status in ('open', 'closed', 'resolved')
        and (
          m.market_contract->>'marketKindId' = 'sports.tournament-winner'
          or m.market_contract #>> '{dependencyResolution,acceptFact}' = 'entity_eliminated'
        )
      order by m.published_at asc nulls last, m.close_at asc, m.id asc, mo.sort_order asc
    `,
    [triggerMarketId]
  );

  return mapCandidateRows(result.rows);
}

export async function planDependentResolutionCascade(
  db: Queryable,
  trigger: DependentResolutionCascadeTrigger
): Promise<DependentResolutionCascadePlan> {
  if (!trigger.approvedByHuman && !trigger.trustedOfficialFinal) {
    return buildPlan({
      trigger,
      action: "blocked",
      blockers: ["trigger_not_human_approved"]
    });
  }

  const triggerMarket = await readTriggerMarket(db, trigger.triggerMarketId);
  if (!triggerMarket) {
    return buildPlan({
      trigger,
      action: "blocked",
      blockers: ["trigger_market_not_found"]
    });
  }

  const facts = deriveEliminationFacts(triggerMarket, trigger.triggerWinningOutcomeId);
  if (facts.length === 0) {
    return buildPlan({
      trigger,
      action: "none"
    });
  }

  const candidates = await readCandidateMarkets(db, trigger.triggerMarketId);
  const dependentActions: DependentResolutionCascadeAction[] = [];
  const skippedMarkets: DependentResolutionCascadeSkippedMarket[] = [];
  const blockers: string[] = [];

  for (const candidate of candidates) {
    if (!candidateCanResolveEarly(candidate)) {
      skippedMarkets.push({ marketId: candidate.marketId, reason: "not_matching_dependency" });
      continue;
    }

    const matchingFact = facts.find((fact) => candidateMatchesFact(candidate, fact));
    if (!matchingFact) {
      skippedMarkets.push({ marketId: candidate.marketId, reason: "not_matching_dependency" });
      continue;
    }

    const binaryMap = readBinaryOutcomeMap(candidate);
    if (!binaryMap) {
      blockers.push(`dependent_not_yes_no_binary:${candidate.marketId}`);
      skippedMarkets.push({ marketId: candidate.marketId, reason: "not_yes_no_binary" });
      continue;
    }

    if (candidate.status === "resolved" && candidate.winningOutcomeId === binaryMap.yesOutcomeId) {
      blockers.push(`dependent_already_resolved_yes:${candidate.marketId}`);
      continue;
    }

    if (TERMINAL_STATUSES.has(candidate.status)) {
      skippedMarkets.push({ marketId: candidate.marketId, reason: "already_terminal" });
      continue;
    }

    dependentActions.push({
      marketId: candidate.marketId,
      action: "resolve_no",
      noOutcomeId: binaryMap.noOutcomeId,
      currentStatus: candidate.status,
      reason: "dependent_entity_eliminated",
      entityLabel: matchingFact.entityLabel,
      entityKeys: matchingFact.entityKeys
    });
  }

  if (blockers.length > 0) {
    return buildPlan({
      trigger,
      action: "blocked",
      facts,
      skippedMarkets,
      blockers,
      candidateCount: candidates.length
    });
  }

  return buildPlan({
    trigger,
    action: dependentActions.length > 0 ? "resolve_dependents_no" : "none",
    facts,
    dependentActions,
    skippedMarkets,
    candidateCount: candidates.length
  });
}
