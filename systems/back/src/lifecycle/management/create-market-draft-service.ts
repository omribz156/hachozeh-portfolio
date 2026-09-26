import type { Pool } from "pg";

import type { RequestActor } from "../../auth/actor-resolver";
import { withTransaction } from "../../db/tx/with-transaction";
import { insertAuditEvent } from "../../shared/audit-events";
import {
  buildDerivedEventSlug,
  buildDerivedMarketId,
  buildResolvedOutcomes
} from "./create-market-draft/derived-market";
import { addDerivedContractDisplayHints } from "./create-market-draft/contract-display-hints";
import {
  insertMarketDraft,
  insertMarketOutcome,
  readLockedMarket,
  upsertMarketEvent
} from "./create-market-draft/draft-writes";
import { CreateMarketDraftServiceError } from "./create-market-draft/errors";
import {
  claimIdempotencyScope,
  completeIdempotencyRecord
} from "./create-market-draft/idempotency";
import { buildRequestHash } from "./create-market-draft/request-hash";
import type {
  CreateMarketDraftRequest,
  CreateMarketDraftResponse,
  MarketContractV1Snapshot
} from "./create-market-draft/types";
import { resolveMarketCreationLiquidityB } from "./market-creation-liquidity";
import { suggestMarketTags } from "../../markets/market-tags/tag-suggestions";

export { CreateMarketDraftServiceError } from "./create-market-draft/errors";
export { parseCreateMarketDraftRequest } from "./create-market-draft/request-parser";
export type {
  CreateMarketDraftRequest,
  CreateMarketDraftResponse,
  EventResolutionPolicy,
  MarketEnvironment,
  MarketContractV1Snapshot
} from "./create-market-draft/types";

function stampContractEnvironment(
  contract: MarketContractV1Snapshot | null,
  marketEnvironment: CreateMarketDraftRequest["marketEnvironment"],
  request: Pick<CreateMarketDraftRequest, "marketId" | "title" | "categoryKey" | "familyKey">
): MarketContractV1Snapshot | null {
  if (!contract) {
    return contract;
  }

  const relatedTagSuggestions = suggestMarketTags({
    id: request.marketId ?? request.title,
    title: request.title,
    categoryKey: request.categoryKey,
    marketFamilyKey: request.familyKey
  }).map((tag) => ({
    slug: tag.def.slug,
    label: tag.def.label,
    kind: tag.def.kind ?? null,
    weight: tag.weight
  }));

  const operational =
    contract.operational && typeof contract.operational === "object" && !Array.isArray(contract.operational)
      ? (contract.operational as Record<string, unknown>)
      : {};

  return {
    ...contract,
    operational: {
      ...operational,
      environment: marketEnvironment ?? "prod",
      relatedTagSuggestions
    }
  };
}

export async function createMarketDraft(
  pool: Pool,
  request: CreateMarketDraftRequest,
  actor: RequestActor
): Promise<CreateMarketDraftResponse> {
  const marketId = buildDerivedMarketId(actor.actorId, request);
  const eventId = request.eventId ?? `evt_${marketId}`;
  const eventSlug = buildDerivedEventSlug(request, marketId);
  const eventResolutionPolicy = request.eventResolutionPolicy ?? "independent_children";
  const outcomes = buildResolvedOutcomes(marketId, request.outcomes);
  const effectiveLiquidityB = resolveMarketCreationLiquidityB({
    marketId,
    categoryKey: request.categoryKey,
    familyKey: request.familyKey,
    liquidityB: request.liquidityB,
    outcomeCount: outcomes.length
  });
  const effectiveRequest = {
    ...request,
    marketEnvironment: request.marketEnvironment ?? "prod",
    eventResolutionPolicy,
    marketContract: stampContractEnvironment(
      addDerivedContractDisplayHints(
        request.marketContract,
        request.outcomes
      ),
      request.marketEnvironment ?? "prod",
      { ...request, marketId }
    ),
    liquidityB: effectiveLiquidityB
  };
  const requestHash = buildRequestHash(marketId, outcomes, effectiveRequest);

  return withTransaction(pool, async (client) => {
    const idempotency = await claimIdempotencyScope(
      client,
      actor.actorId,
      request.idempotencyKey,
      requestHash
    );

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const existingMarket = await readLockedMarket(client, marketId);

    if (existingMarket) {
      throw new CreateMarketDraftServiceError(
        409,
        "market_already_exists",
        "Market id is already in use."
      );
    }

    const createdAt = new Date().toISOString();

    await upsertMarketEvent(client, {
      eventId,
      slug: eventSlug,
      title: request.eventTitle ?? effectiveRequest.title,
      description: request.eventDescription ?? effectiveRequest.description,
      icon: request.eventIcon,
      categoryKey: effectiveRequest.categoryKey,
      familyKey: effectiveRequest.familyKey,
      resolutionPolicy: eventResolutionPolicy,
      showGraph: request.eventShowGraph === true,
      showParentInDiscovery: request.eventShowParentInDiscovery ?? null,
      showChildrenInDiscovery: request.eventShowChildrenInDiscovery ?? null
    });

    await insertMarketDraft(client, {
      marketId,
      eventId,
      eventChildLabel: effectiveRequest.eventChildLabel ?? null,
      marketEnvironment: effectiveRequest.marketEnvironment,
      familyKey: effectiveRequest.familyKey,
      actorId: actor.actorId,
      title: effectiveRequest.title,
      description: effectiveRequest.description,
      categoryKey: effectiveRequest.categoryKey,
      openAt: effectiveRequest.openAt,
      closeAt: effectiveRequest.closeAt,
      resolutionSource: effectiveRequest.resolutionSource,
      resolutionRules: effectiveRequest.resolutionRules,
      oracleSourcePolicy: effectiveRequest.oracleSourcePolicy,
      marketContract: effectiveRequest.marketContract,
      liquidityB: effectiveRequest.liquidityB,
      closeOnEventCompletion: effectiveRequest.closeOnEventCompletion,
      eventCompletionCloseRequiresHumanApproval:
        effectiveRequest.eventCompletionCloseRequiresHumanApproval
    });

    for (const [index, outcome] of outcomes.entries()) {
      await insertMarketOutcome(client, {
        outcomeId: outcome.outcomeId,
        marketId,
        label: outcome.label,
        shortLabel: outcome.shortLabel,
        description: outcome.description,
        colorKey: outcome.colorKey,
        sortOrder: index
      });
    }

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "market_draft_created",
      entityType: "market",
      entityId: marketId,
      payload: {
        command: {
          ...effectiveRequest,
          marketId,
          eventId,
          outcomes: outcomes.map((outcome) => ({
            outcomeId: outcome.outcomeId,
            label: outcome.label,
            shortLabel: outcome.shortLabel,
            description: outcome.description,
            colorKey: outcome.colorKey
          }))
        },
        result: {
          status: "draft",
          eventSlug,
          createdAt
        }
      }
    });

    const response: CreateMarketDraftResponse = {
      marketId,
      eventId,
      eventSlug,
      status: "draft",
      createdAt,
      openAt: effectiveRequest.openAt,
      closeAt: effectiveRequest.closeAt,
      outcomeIds: outcomes.map((outcome) => outcome.outcomeId),
      auditEventId
    };

    await completeIdempotencyRecord(client, idempotency.recordId, marketId, response);

    return response;
  });
}
