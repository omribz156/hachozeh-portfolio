import type { Queryable } from "../../back/src/platform-surface/oracle";

import type { OracleLifecycleSourceContext } from "./source-adapter-contracts";
import { normalizeMarketContract } from "./source-adapter-contracts";

export type LifecycleMarketRow = {
  id: string;
  title: string;
  status: "closed" | "resolved";
  close_at: Date | null;
  closed_at: Date | null;
  resolved_at: Date | null;
};

export type CapabilityMarketRow = {
  id: string;
  title: string;
  status: "open" | "closed" | "resolved";
  close_at: Date;
  close_on_event_completion: boolean;
  event_completion_close_requires_human_approval: boolean;
  resolution_source: string | null;
  resolution_rules: string | null;
  oracle_source_policy: unknown;
  market_contract: unknown;
};

export type CapabilityOutcomeRow = {
  market_id: string;
  id: string;
  label: string;
};

export type CloseAuditRow = {
  market_id: string;
  audit_event_id: string;
  actor_id: string;
  payload: unknown;
  created_at: Date;
};

export async function readClosedMarkets(
  db: Queryable,
  options: {
    marketId?: string;
    limit: number;
  }
): Promise<LifecycleMarketRow[]> {
  const values: unknown[] = [];
  const where = ["m.status = 'closed'", "m.closed_at is not null"];

  if (options.marketId) {
    values.push(options.marketId);
    where.push(`m.id = $${values.length}`);
  }

  values.push(options.limit);

  const result = await db.query<LifecycleMarketRow>(
    `
      select
        m.id,
        m.title,
        m.status,
        m.close_at,
        m.closed_at,
        m.resolved_at
      from markets m
      where ${where.join(" and ")}
      order by m.closed_at desc, m.id asc
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function readClosedMarketsByIds(
  db: Queryable,
  marketIds: string[]
): Promise<LifecycleMarketRow[]> {
  if (marketIds.length === 0) {
    return [];
  }

  const result = await db.query<LifecycleMarketRow>(
    `
      select
        m.id,
        m.title,
        m.status,
        m.close_at,
        m.closed_at,
        m.resolved_at
      from markets m
      where m.status = 'closed'
        and m.closed_at is not null
        and m.id = any($1::text[])
      order by m.closed_at desc, m.id asc
    `,
    [marketIds]
  );

  return result.rows;
}

export async function readCapabilityMarkets(
  db: Queryable,
  options: {
    marketId?: string;
    limit: number;
  }
): Promise<CapabilityMarketRow[]> {
  const values: unknown[] = [];
  const where = ["m.status in ('open', 'closed')"];

  if (options.marketId) {
    values.push(options.marketId);
    where.push(`m.id = $${values.length}`);
  }

  values.push(options.limit);

  const result = await db.query<CapabilityMarketRow>(
    `
      select
        m.id,
        m.title,
        m.status,
        m.close_at,
        m.close_on_event_completion,
        m.event_completion_close_requires_human_approval,
        m.resolution_source,
        m.resolution_rules,
        m.oracle_source_policy,
        m.market_contract
      from markets m
      where ${where.join(" and ")}
      order by
        case m.status when 'open' then 0 when 'closed' then 1 else 2 end,
        m.close_at asc,
        m.id asc
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function readCapabilityOutcomes(
  db: Queryable,
  marketIds: string[]
): Promise<Map<string, CapabilityOutcomeRow[]>> {
  if (marketIds.length === 0) {
    return new Map();
  }

  const result = await db.query<CapabilityOutcomeRow>(
    `
      select
        market_id,
        id,
        label
      from market_outcomes
      where market_id = any($1::text[])
      order by market_id asc, sort_order asc, id asc
    `,
    [marketIds]
  );
  const byMarketId = new Map<string, CapabilityOutcomeRow[]>();

  for (const row of result.rows) {
    byMarketId.set(row.market_id, [...(byMarketId.get(row.market_id) ?? []), row]);
  }

  return byMarketId;
}

export function buildCapabilityContext(
  market: CapabilityMarketRow,
  outcomes: CapabilityOutcomeRow[]
): OracleLifecycleSourceContext {
  const marketContract = normalizeMarketContract(market.market_contract);
  const contractResolutionSource = marketContract?.resolutionSource?.url?.trim() || null;

  return {
    marketId: market.id,
    marketTitle: market.title,
    marketStatus: market.status,
    closeAt: market.close_at.toISOString(),
    closeOnEventCompletion: market.close_on_event_completion,
    eventCompletionCloseRequiresHumanApproval:
      market.event_completion_close_requires_human_approval,
    resolutionSource: market.resolution_source ?? contractResolutionSource ?? "",
    resolutionRules: market.resolution_rules ?? marketContract?.resolutionRule ?? "",
    oracleSourcePolicy:
      market.oracle_source_policy &&
      typeof market.oracle_source_policy === "object" &&
      !Array.isArray(market.oracle_source_policy)
        ? (market.oracle_source_policy as OracleLifecycleSourceContext["oracleSourcePolicy"])
        : null,
    marketContract,
    outcomes: outcomes.map((outcome) => ({
      outcomeId: outcome.id,
      outcomeKey: outcome.id,
      label: outcome.label
    }))
  };
}

export async function readCloseAuditsByMarketId(
  db: Queryable,
  marketIds: string[]
): Promise<Map<string, CloseAuditRow>> {
  if (marketIds.length === 0) {
    return new Map();
  }

  const result = await db.query<CloseAuditRow>(
    `
      select distinct on (entity_id)
        entity_id as market_id,
        id as audit_event_id,
        actor_id,
        payload,
        created_at
      from audit_events
      where entity_type = 'market'
        and action = 'market_closed'
        and entity_id = any($1::text[])
      order by entity_id, created_at desc
    `,
    [marketIds]
  );

  return new Map(result.rows.map((row) => [row.market_id, row]));
}
