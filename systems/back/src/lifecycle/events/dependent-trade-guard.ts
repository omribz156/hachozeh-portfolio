import type { Queryable } from "../../db/client/pool";

type JsonRecord = Record<string, unknown>;

type ResolvedDependencyTriggerRow = {
  trigger_market_id: string;
  market_contract: unknown;
  winning_outcome_id: string;
  winning_outcome_label: string;
  outcomes: Array<{ outcomeId: string; label: string }> | null;
};

export type KnownDependentResult = {
  triggerMarketId: string;
  entityKey: string;
  winningOutcomeId: string;
};

function readObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u05f4\"']/g, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readDependencyEntityKey(contractValue: unknown): string | null {
  const contract = readObject(contractValue);
  const dependency = readObject(contract?.dependencyResolution);
  if (readString(dependency?.acceptFact) !== "entity_eliminated") {
    return null;
  }

  return readString(dependency?.entityKey);
}

function readEliminatedEntityKeys(row: ResolvedDependencyTriggerRow): string[] {
  const contract = readObject(row.market_contract);
  const outcomeMap = Array.isArray(contract?.outcomeMap) ? contract.outcomeMap : [];
  const winnerKey = normalizeKey(row.winning_outcome_label);
  const winningMap = outcomeMap
    .map(readObject)
    .find((entry) => normalizeKey(readString(entry?.outcomeLabel) ?? "") === winnerKey);
  const explicitKey =
    readString(winningMap?.eliminatesEntityKey) ??
    readString(winningMap?.eliminatedEntityKey);

  if (explicitKey) {
    return [explicitKey];
  }

  const outcomes = Array.isArray(row.outcomes) ? row.outcomes : [];
  if (outcomes.length !== 2) {
    return [];
  }

  const loser = outcomes.find((outcome) => outcome.outcomeId !== row.winning_outcome_id);
  return loser ? [loser.outcomeId, loser.label] : [];
}

export async function findKnownDependentResult(
  db: Queryable,
  input: {
    marketId: string;
    eventId: string | null;
    marketContract: unknown;
  }
): Promise<KnownDependentResult | null> {
  const entityKey = readDependencyEntityKey(input.marketContract);
  if (!entityKey || !input.eventId) {
    return null;
  }

  const result = await db.query<ResolvedDependencyTriggerRow>(
    `
      /* dependency_trade_guard */
      select
        trigger_market.id as trigger_market_id,
        trigger_market.market_contract,
        mr.winning_outcome_id,
        winning_outcome.label as winning_outcome_label,
        jsonb_agg(
          jsonb_build_object('outcomeId', trigger_outcome.id, 'label', trigger_outcome.label)
          order by trigger_outcome.sort_order
        ) as outcomes
      from market_resolutions mr
      join markets trigger_market
        on trigger_market.id = mr.market_id
      join market_outcomes winning_outcome
        on winning_outcome.market_id = trigger_market.id
       and winning_outcome.id = mr.winning_outcome_id
      join market_outcomes trigger_outcome
        on trigger_outcome.market_id = trigger_market.id
      where trigger_market.id <> $1
        and trigger_market.market_contract #>> '{dependentResolution,emitFact}' = 'entity_eliminated'
        and coalesce(
          nullif(trigger_market.market_contract #>> '{dependentResolution,targetEventId}', ''),
          nullif(trigger_market.market_contract #>> '{operational,dependentEventId}', '')
        ) = $2
      group by
        trigger_market.id,
        trigger_market.market_contract,
        mr.winning_outcome_id,
        winning_outcome.label,
        mr.resolved_at
      order by mr.resolved_at desc
    `,
    [input.marketId, input.eventId]
  );
  const normalizedEntityKey = normalizeKey(entityKey);

  for (const row of result.rows) {
    const matches = readEliminatedEntityKeys(row).some(
      (candidate) => normalizeKey(candidate) === normalizedEntityKey
    );
    if (matches) {
      return {
        triggerMarketId: row.trigger_market_id,
        entityKey,
        winningOutcomeId: row.winning_outcome_id
      };
    }
  }

  return null;
}
