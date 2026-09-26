import type { PoolClient } from "pg";

import type { OracleSourcePolicy } from "../../../../../oracle/src/contracts";
import type { EventResolutionPolicy, MarketContractV1Snapshot, MarketEnvironment } from "./types";

export async function readLockedMarket(
  client: PoolClient,
  marketId: string
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from markets
      where id = $1
      limit 1
      for update
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

export async function upsertMarketEvent(
  client: PoolClient,
  input: {
    eventId: string;
    slug: string;
    title: string;
    description: string | null;
    icon: string | null;
    categoryKey: string | null;
    familyKey: string | null;
    resolutionPolicy: EventResolutionPolicy;
    showGraph: boolean;
    showParentInDiscovery: boolean | null;
    showChildrenInDiscovery: boolean | null;
  }
): Promise<void> {
  // display_flags is merged (||) on conflict so we only ever set the keys we're
  // given — re-running creation for another child of the same event preserves any
  // other flags already on the row.
  const displayFlags = JSON.stringify({
    ...(input.showGraph ? { showGraph: true } : {}),
    ...(input.showParentInDiscovery === null
      ? {}
      : { showParentInDiscovery: input.showParentInDiscovery }),
    ...(input.showChildrenInDiscovery === null
      ? {}
      : { showChildrenInDiscovery: input.showChildrenInDiscovery })
  });

  await client.query(
    `
      insert into events (
        id,
        slug,
        title,
        description,
        icon,
        category_key,
        market_family_key,
        resolution_policy,
        display_flags,
        sibling_resolution_requires_human_approval,
        status
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, true, 'active')
      on conflict (id) do update
      set
        title = excluded.title,
        description = coalesce(excluded.description, events.description),
        icon = coalesce(excluded.icon, events.icon),
        category_key = coalesce(excluded.category_key, events.category_key),
        market_family_key = coalesce(excluded.market_family_key, events.market_family_key),
        resolution_policy = excluded.resolution_policy,
        display_flags = events.display_flags || excluded.display_flags,
        updated_at = now()
    `,
    [
      input.eventId,
      input.slug,
      input.title,
      input.description,
      input.icon,
      input.categoryKey,
      input.familyKey,
      input.resolutionPolicy,
      displayFlags
    ]
  );
}

export async function insertMarketDraft(
  client: PoolClient,
  input: {
    marketId: string;
    eventId: string;
    eventChildLabel: string | null;
    marketEnvironment: MarketEnvironment;
    familyKey: string | null;
    actorId: string;
    title: string;
    description: string | null;
    categoryKey: string | null;
    openAt: string;
    closeAt: string;
    resolutionSource: string;
    resolutionRules: string;
    oracleSourcePolicy: OracleSourcePolicy | null;
    marketContract: MarketContractV1Snapshot | null;
    liquidityB: string;
    closeOnEventCompletion: boolean;
    eventCompletionCloseRequiresHumanApproval: boolean;
  }
): Promise<void> {
  await client.query(
    `
      insert into markets (
        id,
        status,
        settlement_status,
        market_environment,
        title,
        description,
        category_key,
        market_family_key,
        event_id,
        event_child_label,
        open_at,
        close_at,
        resolution_source,
        resolution_rules,
        oracle_source_policy,
        market_contract,
        liquidity_b,
        created_by,
        close_on_event_completion,
        event_completion_close_requires_human_approval
      )
      values ($1, 'draft', null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18)
    `,
    [
      input.marketId,
      input.marketEnvironment,
      input.title,
      input.description,
      input.categoryKey,
      input.familyKey,
      input.eventId,
      input.eventChildLabel,
      input.openAt,
      input.closeAt,
      input.resolutionSource,
      input.resolutionRules,
      JSON.stringify(input.oracleSourcePolicy ?? {}),
      JSON.stringify(input.marketContract ?? {}),
      input.liquidityB,
      input.actorId,
      input.closeOnEventCompletion,
      input.eventCompletionCloseRequiresHumanApproval
    ]
  );
}

export async function insertMarketOutcome(
  client: PoolClient,
  input: {
    outcomeId: string;
    marketId: string;
    label: string;
    shortLabel: string | null;
    description: string | null;
    colorKey: string | null;
    sortOrder: number;
  }
): Promise<void> {
  await client.query(
    `
      insert into market_outcomes (
        id,
        market_id,
        label,
        short_label,
        description,
        color_key,
        sort_order
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.outcomeId,
      input.marketId,
      input.label,
      input.shortLabel,
      input.description,
      input.colorKey,
      input.sortOrder
    ]
  );
}
