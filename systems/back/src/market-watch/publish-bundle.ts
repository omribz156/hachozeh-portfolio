import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";
import {
  buildSeerMarketId,
  type SeerMarketCreationDraft,
  type SeerMarketWatchPlanDraft
} from "../lifecycle/management/seer-market-creation-service";
import { upsertMarketWatchPlan, type MarketWatchPlan } from "./service";

function resolveNextRunAt(spec: SeerMarketWatchPlanDraft, nowMs = Date.now()): string {
  if (spec.nextRunAt) {
    const timestamp = Date.parse(spec.nextRunAt);
    if (!Number.isFinite(timestamp) || timestamp <= nowMs) {
      throw new Error(`Embedded watch plan ${spec.id} has no future nextRunAt.`);
    }
    return new Date(timestamp).toISOString();
  }

  const nextRun = spec.runAt
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > nowMs)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (nextRun) return nextRun.toISOString();
  if (spec.intervalMinutes) {
    return new Date(nowMs + Math.round(spec.intervalMinutes * 60_000)).toISOString();
  }
  throw new Error(`Embedded watch plan ${spec.id} has no future schedule.`);
}

export function buildEmbeddedWatchPlanInput(
  draft: SeerMarketCreationDraft,
  nowMs = Date.now(),
  materializedTarget: { marketId?: string; eventId?: string } = {}
): Parameters<typeof upsertMarketWatchPlan>[1] | null {
  const spec = draft.watchPlan;
  if (!spec) return null;
  const eventId = spec.target === "event"
    ? materializedTarget.eventId?.trim() || draft.eventId?.trim() || null
    : null;
  const marketId = spec.target === "market"
    ? materializedTarget.marketId?.trim() || buildSeerMarketId(draft.candidateMarketId)
    : null;
  if (!eventId && !marketId) {
    throw new Error(`Embedded watch plan ${spec.id} cannot resolve its ${spec.target} target.`);
  }

  return {
    id: spec.id,
    marketId,
    eventId,
    checkerKind: spec.checkerKind,
    enabled: spec.enabled,
    timezone: spec.timezone,
    runPolicy: {
      ...(spec.runAt.length > 0 ? { runAt: spec.runAt } : {}),
      ...(spec.intervalMinutes ? { intervalMinutes: spec.intervalMinutes } : {}),
      ...(spec.proximityChars ? { proximityChars: spec.proximityChars } : {})
    },
    nextRunAt: resolveNextRunAt(spec, nowMs),
    sourceUrls: spec.sourceUrls,
    entities: spec.entities,
    keywords: spec.keywords,
    note: spec.note
  };
}

export async function installEmbeddedWatchPlan(
  draft: SeerMarketCreationDraft,
  materializedTarget: { marketId?: string; eventId?: string } = {}
): Promise<MarketWatchPlan | null> {
  const input = buildEmbeddedWatchPlanInput(draft, Date.now(), materializedTarget);
  if (!input) return null;
  const pool = createDbPool(loadAppEnv().db);
  try {
    return await upsertMarketWatchPlan(pool as Queryable, input);
  } finally {
    await pool.end();
  }
}
