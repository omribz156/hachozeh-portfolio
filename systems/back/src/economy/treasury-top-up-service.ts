import type { Pool } from "pg";

import type { RequestActor } from "../auth/actor-resolver";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import { parseDecimalString, quantizeMoney } from "../shared/decimals";
import {
  claimIdempotencyRecord,
  completeIdempotencyRecord
} from "../shared/idempotency-records";
import { hashStablePayload } from "../shared/stable-hash";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";
import { EconomyLedgerError, topUpPlatformTreasury } from "./economy-ledger";

export type TreasuryTopUpRequest = {
  amount: string;
  reason: string;
  idempotencyKey: string;
};

export type TreasuryTopUpResponse = {
  amount: string;
  ledgerTransactionId: string;
  platformTreasuryBefore: string;
  platformTreasuryAfter: string;
  mintSourceBefore: string;
  mintSourceAfter: string;
  auditEventId: string;
};

export class TreasuryTopUpServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "TreasuryTopUpServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const createTopUpRequestError = (message: string) =>
  new TreasuryTopUpServiceError(400, "invalid_request", message);

const MAX_TREASURY_TOP_UP_REASON_LENGTH = 240;
const MAX_TREASURY_TOP_UP_IDEMPOTENCY_KEY_LENGTH = 160;

function rejectControlChars(value: string, fieldName: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw createTopUpRequestError(`${fieldName} cannot contain control characters.`);
  }
}

function normalizeReason(value: string): string {
  rejectControlChars(value, "reason");

  if (value.length > MAX_TREASURY_TOP_UP_REASON_LENGTH) {
    throw createTopUpRequestError(
      `reason must be ${MAX_TREASURY_TOP_UP_REASON_LENGTH} characters or fewer.`
    );
  }

  return value;
}

function normalizeIdempotencyKey(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  rejectControlChars(value, "idempotencyKey");

  if (value.length > MAX_TREASURY_TOP_UP_IDEMPOTENCY_KEY_LENGTH) {
    throw createTopUpRequestError(
      `idempotencyKey must be ${MAX_TREASURY_TOP_UP_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`
    );
  }

  return value;
}

export function parseTreasuryTopUpRequest(body: unknown): TreasuryTopUpRequest {
  const candidate = parseObjectBody(
    body,
    "Treasury top-up request body must be an object.",
    createTopUpRequestError
  );
  const amount = parseRequiredStringField(candidate, "amount", createTopUpRequestError);

  try {
    parseDecimalString(amount, {
      allowZero: false,
      maxScale: 6,
      fieldName: "amount"
    });
  } catch (error) {
    throw createTopUpRequestError(error instanceof Error ? error.message : "amount is invalid.");
  }

  return {
    amount: quantizeMoney(amount),
    reason: normalizeReason(parseRequiredStringField(candidate, "reason", createTopUpRequestError)),
    idempotencyKey: normalizeIdempotencyKey(
      parseNullableStringField(candidate, "idempotencyKey", createTopUpRequestError)
    )
      ?? `treasury_top_up:${Date.now()}`
  };
}

function mapLedgerError(error: unknown): never {
  if (error instanceof EconomyLedgerError) {
    throw new TreasuryTopUpServiceError(500, error.code, error.message);
  }

  throw error;
}

export async function topUpPlatformTreasuryForAdmin(
  db: Pool,
  request: TreasuryTopUpRequest,
  actor: RequestActor
): Promise<TreasuryTopUpResponse> {
  return withTransaction(db, async (client) => {
    const requestHash = hashStablePayload({
      amount: request.amount,
      reason: request.reason
    });
    const idempotency = await claimIdempotencyRecord<TreasuryTopUpResponse>(client, {
      scope: "platform_treasury_top_up",
      recordIdPrefix: "idempotency_platform_treasury_top_up",
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      disappearedMessage: "Treasury top-up idempotency record disappeared during claim.",
      conflictError: () => new TreasuryTopUpServiceError(
        409,
        "idempotency_conflict",
        "This idempotency key was already used with a different treasury top-up request."
      ),
      inProgressError: () => new TreasuryTopUpServiceError(
        409,
        "idempotency_in_progress",
        "Treasury top-up with this idempotency key is already in progress."
      )
    });

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    let transfer;
    try {
      transfer = await topUpPlatformTreasury(client, {
        actorId: actor.actorId,
        amount: request.amount,
        referenceId: `platform_treasury_top_up:${request.idempotencyKey}`,
        idempotencyKey: request.idempotencyKey,
        createdBy: actor.actorId
      });
    } catch (error) {
      mapLedgerError(error);
    }

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "admin.economy.platform_treasury_top_up",
      entityType: "account",
      entityId: transfer.targetAccountId,
      payload: {
        amount: transfer.amount,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
        ledgerTransactionId: transfer.ledgerTransactionId
      }
    });

    const response = {
      amount: transfer.amount,
      ledgerTransactionId: transfer.ledgerTransactionId,
      platformTreasuryBefore: transfer.targetBalanceBefore,
      platformTreasuryAfter: transfer.targetBalanceAfter,
      mintSourceBefore: transfer.sourceBalanceBefore,
      mintSourceAfter: transfer.sourceBalanceAfter,
      auditEventId
    };

    await completeIdempotencyRecord(client, {
      recordId: idempotency.recordId,
      resourceType: "ledger_transaction",
      resourceId: response.ledgerTransactionId,
      response
    });

    return response;
  });
}
