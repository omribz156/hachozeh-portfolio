import {
  parseDecimalString,
  quantizeMoney,
  quantizeShares
} from "../../shared/decimals";
import { hashStablePayload } from "../../shared/stable-hash";
import type { normalizeContractExecution } from "../contract-side-normalization";
import type { TradeRequest } from "./trade-types";

export function hashRequest(payload: unknown): string {
  return hashStablePayload(payload);
}

export function buildBuyPayloadForHash(
  marketId: string,
  contractResolution: ReturnType<typeof normalizeContractExecution>,
  request: Extract<TradeRequest, { side: "buy" }>
) {
  return {
    marketId,
    requestedOutcomeId: contractResolution.requestedOutcomeId,
    executionOutcomeId: contractResolution.executionOutcomeId,
    executionLegOutcomeIds: contractResolution.executionLegs.map((leg) => leg.outcomeId),
    contractSide: contractResolution.contractSide,
    side: request.side,
    cashAmount: quantizeMoney(
      parseDecimalString(request.cashAmount, {
        fieldName: "cashAmount",
        allowNegative: false,
        allowZero: false,
        maxScale: 6
      })
    ),
    quoteId: request.quoteId,
    quotedAt: request.quotedAt,
    quoteExpiresAt: request.quoteExpiresAt,
    expectedMarketStateVersion: request.expectedMarketStateVersion
  };
}

export function buildSellPayloadForHash(
  marketId: string,
  contractResolution: ReturnType<typeof normalizeContractExecution>,
  request: Extract<TradeRequest, { side: "sell" }>
) {
  return {
    marketId,
    requestedOutcomeId: contractResolution.requestedOutcomeId,
    executionOutcomeId: contractResolution.executionOutcomeId,
    executionLegOutcomeIds: contractResolution.executionLegs.map((leg) => leg.outcomeId),
    contractSide: contractResolution.contractSide,
    side: request.side,
    shareAmount: quantizeShares(
      parseDecimalString(request.shareAmount, {
        fieldName: "shareAmount",
        allowNegative: false,
        allowZero: false,
        maxScale: 6
      })
    ),
    quoteId: request.quoteId,
    quotedAt: request.quotedAt,
    quoteExpiresAt: request.quoteExpiresAt,
    expectedMarketStateVersion: request.expectedMarketStateVersion
  };
}
