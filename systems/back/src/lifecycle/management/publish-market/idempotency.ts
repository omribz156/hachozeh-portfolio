import type { PoolClient } from "pg";

import {
  claimIdempotencyRecord,
  completeIdempotencyRecord as completeSharedIdempotencyRecord
} from "../../../shared/idempotency-records";
import { PublishMarketServiceError } from "./errors";
import type { PublishMarketResponse } from "./types";

export async function claimIdempotencyScope(
  client: PoolClient,
  actorId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<{ recordId: string; completedResponse: PublishMarketResponse | null }> {
  return claimIdempotencyRecord<PublishMarketResponse>(client, {
    scope: "publish_market",
    recordIdPrefix: "idempotency_publish_market",
    actorId,
    idempotencyKey,
    requestHash,
    disappearedMessage: "Idempotency record disappeared during publish execution",
    conflictError: () => new PublishMarketServiceError(
      409,
      "idempotency_conflict",
      "Idempotency key was already used with a different publish payload."
    ),
    inProgressError: () => new PublishMarketServiceError(
      409,
      "idempotency_in_progress",
      "Publish with this idempotency key is already in progress."
    )
  });
}

export async function completeIdempotencyRecord(
  client: PoolClient,
  recordId: string,
  marketId: string,
  response: PublishMarketResponse
): Promise<void> {
  await completeSharedIdempotencyRecord(client, {
    recordId,
    resourceType: "market",
    resourceId: marketId,
    response
  });
}
