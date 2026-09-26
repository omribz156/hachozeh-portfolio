import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
  type RequestActor,
  withTransaction,
  updateAccountBalance,
  readLockedAccountById,
  readLockedPlatformTreasury,
  insertAuditEvent,
  quantizeMoney,
  quantizeShares,
  toDecimal,
  claimIdempotencyRecord,
  completeIdempotencyRecord,
  insertLifecycleEvent,
  hashStablePayload,
  createResolutionNotifications,
  pingMarketIndexNow
} from "../../back/src/platform-surface/oracle";
import { insertLedgerTransactionWithEntries } from "./resolve-market-ledger";
import {
  deletePosition,
  insertRealizationEvent,
  insertResolutionRecord,
  markWinningOutcome,
  readLockedMarket,
  readLockedPositions,
  readMarketOutcomes,
  settleContractPositions,
  updateMarketResolved
} from "./resolve-market-records";
import {
  parseHttpsUrlValue,
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "./zod-request-body";

export type ResolveMarketRequest = {
  winningOutcomeId: string;
  triggerType: "oracle_proposal" | "human_reviewed_oracle_resolution";
  resolutionSourceUrl: string;
  resolutionNote: string;
  oracleCaseId: string | null;
  proposedByOracleId: string | null;
  approvedByHumanId: string | null;
  evidenceSnapshot: string | null;
  idempotencyKey: string;
};

export type ResolveMarketResponse = {
  marketId: string;
  status: "resolved";
  winningOutcomeId: string;
  resolutionId: string;
  resolvedAt: string;
  settlementStatus: "completed";
  auditEventId: string;
};

export class ResolveMarketServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ResolveMarketServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const createResolveRequestError = (message: string) =>
  new ResolveMarketServiceError(400, "invalid_request", message);

export function parseResolveMarketRequest(body: unknown): ResolveMarketRequest {
  const candidate = parseObjectBody(
    body,
    "Resolve request body must be an object.",
    createResolveRequestError
  );

  const triggerType = parseRequiredStringField(candidate, "triggerType", createResolveRequestError);

  if (
    triggerType !== "oracle_proposal" &&
    triggerType !== "human_reviewed_oracle_resolution"
  ) {
    throw new ResolveMarketServiceError(400, "invalid_request", "triggerType is invalid.");
  }

  return {
    winningOutcomeId: parseRequiredStringField(candidate, "winningOutcomeId", createResolveRequestError),
    triggerType,
    resolutionSourceUrl: parseHttpsUrlValue(
      candidate.resolutionSourceUrl,
      "resolutionSourceUrl",
      createResolveRequestError
    ),
    resolutionNote: parseRequiredStringField(candidate, "resolutionNote", createResolveRequestError),
    oracleCaseId: parseNullableStringField(candidate, "oracleCaseId", createResolveRequestError),
    proposedByOracleId: parseNullableStringField(candidate, "proposedByOracleId", createResolveRequestError),
    approvedByHumanId: parseNullableStringField(candidate, "approvedByHumanId", createResolveRequestError),
    evidenceSnapshot: parseNullableStringField(candidate, "evidenceSnapshot", createResolveRequestError),
    idempotencyKey: parseRequiredStringField(candidate, "idempotencyKey", createResolveRequestError)
  };
}

function buildRequestHash(marketId: string, request: ResolveMarketRequest): string {
  return hashStablePayload({
    marketId,
    ...request
  });
}

export async function resolveMarket(
  dbPool: Pool,
  marketId: string,
  request: ResolveMarketRequest,
  actor: RequestActor
): Promise<ResolveMarketResponse> {
  const requestHash = buildRequestHash(marketId, request);

  const result = await withTransaction(dbPool, async (client) => {
    const idempotency = await claimIdempotencyRecord<ResolveMarketResponse>(client, {
      scope: "resolve_market",
      recordIdPrefix: "idempotency_resolve_market",
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      disappearedMessage: "Idempotency record disappeared during resolve execution",
      conflictError: () => new ResolveMarketServiceError(
        409,
        "idempotency_conflict",
        "Idempotency key was already used with a different resolve payload."
      ),
      inProgressError: () => new ResolveMarketServiceError(
        409,
        "idempotency_in_progress",
        "Resolve with this idempotency key is already in progress."
      )
    });

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const market = await readLockedMarket(client, marketId);

    if (!market) {
      throw new ResolveMarketServiceError(404, "market_not_found", "Requested market was not found.");
    }

    if (market.status !== "closed") {
      throw new ResolveMarketServiceError(
        409,
        "market_not_resolvable",
        "Market must be closed before resolution."
      );
    }

    if (!market.market_treasury_account_id) {
      throw new ResolveMarketServiceError(
        409,
        "market_not_resolvable",
        "Market treasury account is missing."
      );
    }

    const outcomes = await readMarketOutcomes(client, marketId);
    const winningOutcome = outcomes.find((outcome) => outcome.id === request.winningOutcomeId);

    if (!winningOutcome) {
      throw new ResolveMarketServiceError(
        404,
        "outcome_not_found",
        "Winning outcome does not belong to the requested market."
      );
    }

    const resolutionId = `resolution_${randomUUID()}`;
    const resolvedAt = new Date().toISOString();

    await insertResolutionRecord(client, {
      resolutionId,
      marketId,
      winningOutcomeId: request.winningOutcomeId,
      actorId: actor.actorId,
      sourceUrl: request.resolutionSourceUrl,
      notes: request.resolutionNote,
      resolvedAt
    });

    await markWinningOutcome(client, marketId, request.winningOutcomeId);
    await updateMarketResolved(client, marketId, resolvedAt, "processing");

    const positions = await readLockedPositions(client, marketId);
    const marketTreasury = await readLockedAccountById(client, market.market_treasury_account_id);
    const platformTreasury = await readLockedPlatformTreasury(client);

    if (!marketTreasury || marketTreasury.status !== "active") {
      throw new ResolveMarketServiceError(
        409,
        "market_not_resolvable",
        "Market treasury account is unavailable."
      );
    }

    if (!platformTreasury || platformTreasury.status !== "active") {
      throw new ResolveMarketServiceError(
        409,
        "market_not_resolvable",
        "Platform treasury account is unavailable."
      );
    }

    let marketTreasuryBalance = toDecimal(marketTreasury.balance_cached);
    let platformTreasuryBalance = toDecimal(platformTreasury.balance_cached);
    let pendingClaimReserve = toDecimal(0);

    for (const position of positions) {
      const shares = toDecimal(position.shares);
      const removedCostBasis = toDecimal(position.cost_basis);
      const isWinner = position.outcome_id === request.winningOutcomeId;
      const proceeds = isWinner ? shares : toDecimal(0);
      const realizedPnl = proceeds.minus(removedCostBasis);

      if (isWinner) {
        pendingClaimReserve = pendingClaimReserve.plus(proceeds);

        if (pendingClaimReserve.greaterThan(marketTreasuryBalance)) {
          throw new ResolveMarketServiceError(
            409,
            "market_not_resolvable",
            "Market treasury is insufficient for winner settlement."
          );
        }
      }

      await insertRealizationEvent(client, {
        userId: position.user_id,
        marketId,
        outcomeId: position.outcome_id,
        resolutionId,
        type: isWinner ? "resolution_win" : "resolution_loss",
        claimStatus: isWinner ? "pending" : "not_applicable",
        sharesClosed: quantizeShares(shares),
        proceeds: quantizeMoney(proceeds),
        removedCostBasis: quantizeMoney(removedCostBasis),
        realizedPnl: quantizeMoney(realizedPnl)
      });

      await deletePosition(client, position.user_id, marketId, position.outcome_id);
    }

    await settleContractPositions(client, marketId, resolvedAt);
    await createResolutionNotifications(client, resolutionId);

    const sweepableTreasuryBalance = marketTreasuryBalance.minus(pendingClaimReserve);
    if (sweepableTreasuryBalance.isNegative()) {
      throw new ResolveMarketServiceError(
        409,
        "market_not_resolvable",
        "Market treasury is insufficient for pending claims."
      );
    }

    await updateAccountBalance(client, marketTreasury.id, quantizeMoney(marketTreasuryBalance));

    if (sweepableTreasuryBalance.greaterThan(0)) {
      platformTreasuryBalance = platformTreasuryBalance.plus(sweepableTreasuryBalance);

      await updateAccountBalance(client, platformTreasury.id, quantizeMoney(platformTreasuryBalance));
      await updateAccountBalance(client, marketTreasury.id, quantizeMoney(pendingClaimReserve));

      await insertLedgerTransactionWithEntries(client, {
        type: "treasury_sweep",
        referenceType: "market",
        referenceId: marketId,
        idempotencyKey: request.idempotencyKey,
        createdBy: actor.actorId,
        marketId,
        resolutionId,
        triggeredBy: request.triggerType,
        triggeredById: request.proposedByOracleId ?? actor.actorId,
        entries: [
          {
            accountId: marketTreasury.id,
            amount: quantizeMoney(sweepableTreasuryBalance.negated()),
            entryRole: "debit_market_treasury"
          },
          {
            accountId: platformTreasury.id,
            amount: quantizeMoney(sweepableTreasuryBalance),
            entryRole: "credit_platform_treasury"
          }
        ]
      });

      marketTreasuryBalance = pendingClaimReserve;
    }

    await updateMarketResolved(client, marketId, resolvedAt, "completed");

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "market_resolved",
      entityType: "market",
      entityId: marketId,
      payload: {
        command: {
          marketId,
          ...request
        },
        resolutionId,
        result: {
          status: "resolved",
          resolvedAt,
          settlementStatus: "completed",
          winningOutcomeId: request.winningOutcomeId
        }
      }
    });

    const sourceSystem = request.proposedByOracleId ? "oracle" : "back";

    await insertLifecycleEvent(client, {
      marketId,
      eventType: "market_resolved",
      sourceSystem,
      actorId: actor.actorId,
      occurredAt: resolvedAt,
      correlationId: request.idempotencyKey,
      dedupeKey: `market_resolved:${marketId}:${request.idempotencyKey}`,
      auditEventId,
      oracleCaseId: request.oracleCaseId,
      resolutionId,
      payload: {
        winningOutcomeId: request.winningOutcomeId,
        triggerType: request.triggerType,
        resolutionSourceUrl: request.resolutionSourceUrl,
        settlementStatus: "completed"
      }
    });

    await insertLifecycleEvent(client, {
      marketId,
      eventType: "settlement_completed",
      sourceSystem,
      actorId: actor.actorId,
      occurredAt: resolvedAt,
      correlationId: request.idempotencyKey,
      dedupeKey: `settlement_completed:${marketId}:${resolutionId}`,
      auditEventId,
      oracleCaseId: request.oracleCaseId,
      resolutionId,
      payload: {
        winningOutcomeId: request.winningOutcomeId,
        settledPositionCount: positions.length,
        pendingClaimReserve: quantizeMoney(pendingClaimReserve),
        marketTreasurySwept: sweepableTreasuryBalance.greaterThan(0)
      }
    });

    const response: ResolveMarketResponse = {
      marketId,
      status: "resolved",
      winningOutcomeId: request.winningOutcomeId,
      resolutionId,
      resolvedAt,
      settlementStatus: "completed",
      auditEventId
    };

    await completeIdempotencyRecord(client, {
      recordId: idempotency.recordId,
      resourceType: "market",
      resourceId: marketId,
      response
    });

    return response;
  });

  pingMarketIndexNow(dbPool, marketId);
  return result;
}
