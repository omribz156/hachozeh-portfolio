import type { Queryable } from "../db/client/pool";
import {
  buildMarketLifecycle,
  buildPublicMarketContract
} from "../shared/market-truth";
import {
  readMarketKey,
  resolveMarketId
} from "./market-api/identity";
import {
  clampLimit
} from "./market-api/normalizers";

type MarketLifecycleRow = {
  market_id: string;
  market_status: string;
  persisted_status: string;
  title: string;
  category_key: string | null;
  open_at: Date;
  close_at: Date;
  published_at: Date | null;
  updated_at: Date;
  settlement_status: string | null;
  market_resolved_at: Date | null;
  market_contract: unknown;
};

type LifecycleEventRow = {
  id: string;
  event_type: string;
  source_system: string;
  actor_id: string;
  occurred_at: Date;
  correlation_id: string | null;
  audit_event_id: string | null;
  oracle_case_id: string | null;
  resolution_id: string | null;
  payload: unknown;
  created_at: Date;
};

type ReadLifecycleEventsOptions = {
  limit?: string | null;
  order?: string | null;
};

const DEFAULT_LIFECYCLE_EVENT_LIMIT = 25;
const MAX_LIFECYCLE_EVENT_LIMIT = 100;

const PUBLIC_PAYLOAD_KEYS = new Set([
  "objectType",
  "tier",
  "summary",
  "reason",
  "status",
  "publishedAt",
  "closedAt",
  "triggerType",
  "sourceUrl",
  "sourceLabel",
  "officialJsonUrl",
  "officialStatus",
  "winningOutcomeId",
  "winningOutcomeKey",
  "winningOutcomeLabel",
  "observedOutcomeKey",
  "reviewNote",
  "note",
  "settlementAllowed",
  "settlementStatus",
  "settledPositionCount",
  "pendingClaimReserve",
  "marketTreasurySwept",
  "seedAmount",
  "familyGate",
  "evidencePacketId",
  "resolutionRecommendationId"
]);
const PUBLIC_URL_PAYLOAD_KEYS = new Set(["sourceUrl", "officialJsonUrl"]);

function normalizeOrder(value: string | null | undefined): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizePayload(value: unknown): Record<string, unknown> {
  const payload = readObject(value);
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(payload)) {
    if (!PUBLIC_PAYLOAD_KEYS.has(key)) {
      continue;
    }

    if (PUBLIC_URL_PAYLOAD_KEYS.has(key)) {
      const safeUrl = sanitizePublicPayloadUrl(entry);
      if (safeUrl) {
        sanitized[key] = safeUrl;
      }
      continue;
    }

    sanitized[key] = entry;
  }

  return sanitized;
}

function sanitizePublicPayloadUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildActor(actorId: string, sourceSystem: string) {
  if (actorId.startsWith("system:")) {
    return {
      kind: "system",
      label: actorId.replace(/^system:/, "")
    };
  }

  if (sourceSystem === "admin") {
    return {
      kind: "operator",
      label: "operator"
    };
  }

  return {
    kind: sourceSystem || "unknown",
    label: sourceSystem || "unknown"
  };
}

function buildSource(sourceSystem: string) {
  return {
    system: sourceSystem
  };
}

function buildEvent(row: LifecycleEventRow) {
  return {
    id: row.id,
    type: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    source: buildSource(row.source_system),
    actor: buildActor(row.actor_id, row.source_system),
    payload: sanitizePayload(row.payload)
  };
}

async function readMarketLifecycleRow(
  db: Queryable,
  marketKey: string
): Promise<MarketLifecycleRow | null> {
  const marketId = resolveMarketId(marketKey);
  const result = await db.query<MarketLifecycleRow>(
    `
      select
        m.id as market_id,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.title,
        m.category_key,
        m.open_at,
        m.close_at,
        m.published_at,
        m.updated_at,
        m.settlement_status,
        m.resolved_at as market_resolved_at,
        m.market_contract
      from markets m
      where m.id = $1
      limit 1
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function readLifecycleEventRows(
  db: Queryable,
  marketId: string,
  options: Required<Pick<ReadLifecycleEventsOptions, "order">> & { limit: number }
): Promise<LifecycleEventRow[]> {
  const direction = normalizeOrder(options.order);
  const result = await db.query<LifecycleEventRow>(
    `
      select
        id,
        event_type,
        source_system,
        actor_id,
        occurred_at,
        correlation_id,
        audit_event_id,
        oracle_case_id,
        resolution_id,
        payload,
        created_at
      from lifecycle_events
      where market_id = $1
      order by occurred_at ${direction === "asc" ? "asc" : "desc"},
               created_at ${direction === "asc" ? "asc" : "desc"},
               id ${direction === "asc" ? "asc" : "desc"}
      limit $2
    `,
    [marketId, options.limit]
  );

  return result.rows;
}

export async function readMarketLifecycleEvents(
  db: Queryable,
  marketKey: string,
  options: ReadLifecycleEventsOptions = {}
) {
  const market = await readMarketLifecycleRow(db, marketKey);

  if (!market) {
    return null;
  }

  const limit = clampLimit(
    options.limit ?? null,
    DEFAULT_LIFECYCLE_EVENT_LIMIT,
    MAX_LIFECYCLE_EVENT_LIMIT
  );
  const order = normalizeOrder(options.order);
  const events = await readLifecycleEventRows(db, market.market_id, {
    limit,
    order
  });
  const lifecycle = buildMarketLifecycle({
    market_status: market.market_status,
    persisted_status: market.persisted_status,
    open_at: market.open_at,
    close_at: market.close_at,
    published_at: market.published_at,
    updated_at: market.updated_at,
    settlement_status: market.settlement_status,
    market_resolved_at: market.market_resolved_at,
    market_contract: buildPublicMarketContract(market.market_contract)
  });

  return {
    marketKey: readMarketKey(market.market_id),
    marketId: market.market_id,
    title: market.title,
    marketStatus: market.market_status,
    settlementStatus: market.settlement_status,
    lifecycle,
    order,
    limit,
    count: events.length,
    events: events.map(buildEvent)
  };
}
