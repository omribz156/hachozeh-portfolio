import type { PoolClient } from "pg";

import {
  claimIdempotencyRecord,
  completeIdempotencyRecord as completeSharedIdempotencyRecord
} from "../../../shared/idempotency-records";
import { CreateMarketDraftServiceError } from "./errors";
import type { CreateMarketDraftResponse } from "./types";

export async function claimIdempotencyScope(
  client: PoolClient,
  actorId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<{ recordId: string; completedResponse: CreateMarketDraftResponse | null }> {
  return claimIdempotencyRecord<CreateMarketDraftResponse>(client, {
    scope: "create_market",
    recordIdPrefix: "idempotency_create_market",
    actorId,
    idempotencyKey,
    requestHash,
    disappearedMessage: "Idempotency record disappeared during create market execution",
    conflictError: () => new CreateMarketDraftServiceError(
      409,
      "idempotency_conflict",
      "Idempotency key was already used with a different create-market payload."
    ),
    inProgressError: () => new CreateMarketDraftServiceError(
      409,
      "idempotency_in_progress",
      "Create market with this idempotency key is already in progress."
    )
  });
}

export async function completeIdempotencyRecord(
  client: PoolClient,
  recordId: string,
  marketId: string,
  response: CreateMarketDraftResponse
): Promise<void> {
  await completeSharedIdempotencyRecord(client, {
    recordId,
    resourceType: "market",
    resourceId: marketId,
    response
  });
}
