import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type IdempotencyRecordRow<TResponse> = {
  id: string;
  request_hash: string;
  status: "in_progress" | "completed" | "failed";
  response_snapshot: TResponse | null;
};

type ClaimIdempotencyRecordInput = {
  scope: string;
  recordIdPrefix: string;
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  disappearedMessage: string;
  conflictError: () => Error;
  inProgressError: () => Error;
};

type CompleteIdempotencyRecordInput<TResponse> = {
  recordId: string;
  resourceType: string;
  resourceId: string;
  response: TResponse;
};

function assertSafeScope(scope: string): void {
  if (!/^[a-z_]+$/.test(scope)) {
    throw new Error(`Invalid idempotency scope: ${scope}`);
  }
}

export async function claimIdempotencyRecord<TResponse>(
  client: PoolClient,
  input: ClaimIdempotencyRecordInput
): Promise<{ recordId: string; completedResponse: TResponse | null }> {
  assertSafeScope(input.scope);

  const recordId = `${input.recordIdPrefix}_${randomUUID()}`;
  const insertResult = await client.query<{ id: string }>(
    `
      insert into idempotency_records (
        id,
        scope,
        actor_id,
        idempotency_key,
        request_hash,
        status
      )
      values ($1, $2, $3, $4, $5, 'in_progress')
      on conflict (scope, actor_id, idempotency_key) do nothing
      returning id
    `,
    [recordId, input.scope, input.actorId, input.idempotencyKey, input.requestHash]
  );

  if (insertResult.rowCount && insertResult.rows[0]) {
    return {
      recordId: insertResult.rows[0].id,
      completedResponse: null
    };
  }

  const existingResult = await client.query<IdempotencyRecordRow<TResponse>>(
    `
      select id, request_hash, status, response_snapshot
      from idempotency_records
      where scope = $1
        and actor_id = $2
        and idempotency_key = $3
      limit 1
      for update
    `,
    [input.scope, input.actorId, input.idempotencyKey]
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    throw new Error(input.disappearedMessage);
  }

  if (existing.request_hash !== input.requestHash) {
    throw input.conflictError();
  }

  if (existing.status === "completed" && existing.response_snapshot) {
    return {
      recordId: existing.id,
      completedResponse: existing.response_snapshot
    };
  }

  throw input.inProgressError();
}

export async function completeIdempotencyRecord<TResponse>(
  client: PoolClient,
  input: CompleteIdempotencyRecordInput<TResponse>
): Promise<void> {
  await client.query(
    `
      update idempotency_records
      set status = 'completed',
          response_snapshot = $2::jsonb,
          resource_type = $3,
          resource_id = $4,
          completed_at = now()
      where id = $1
    `,
    [input.recordId, JSON.stringify(input.response), input.resourceType, input.resourceId]
  );
}
