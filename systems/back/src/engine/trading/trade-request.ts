import { normalizeUserCashAmountInput } from "../../shared/cash-amount";
import { DecimalValidationError } from "../../shared/decimals";
import {
  parseObjectBody,
  parseOptionalNonNegativeIntegerField,
  parseOptionalStringField,
  parseRequiredStringField
} from "../../shared/zod-request-body";
import {
  ContractSideNormalizationError,
  parseContractSide,
  type ContractSide
} from "../contract-side-normalization";
import { TradeServiceError } from "./trade-errors";
import type { TradeRequest } from "./trade-types";

const createTradeRequestError = (message: string) =>
  new TradeServiceError(400, "invalid_request", message);

function readContractSide(body: Record<string, unknown>): ContractSide {
  try {
    return parseContractSide(body.contractSide);
  } catch (error) {
    if (error instanceof ContractSideNormalizationError) {
      throw new TradeServiceError(400, "invalid_request", error.message);
    }

    throw error;
  }
}

function normalizeCashAmount(value: string): string {
  try {
    return normalizeUserCashAmountInput(value);
  } catch (error) {
    if (error instanceof DecimalValidationError) {
      throw new TradeServiceError(400, "invalid_request", error.message);
    }

    throw error;
  }
}

export function parseTradeRequest(body: unknown): TradeRequest {
  const record = parseObjectBody(body, "Trade body must be a JSON object.", createTradeRequestError);

  const side = parseRequiredStringField(record, "side", createTradeRequestError);
  const outcomeKey = parseRequiredStringField(record, "outcomeKey", createTradeRequestError);
  const contractSide = readContractSide(record);
  const idempotencyKey = parseRequiredStringField(record, "idempotencyKey", createTradeRequestError);
  const quoteId = parseOptionalStringField(record, "quoteId", createTradeRequestError);
  const quotedAt = parseOptionalStringField(record, "quotedAt", createTradeRequestError);
  const quoteExpiresAt = parseOptionalStringField(record, "quoteExpiresAt", createTradeRequestError);
  const expectedMarketStateVersion = parseOptionalNonNegativeIntegerField(
    record,
    "expectedMarketStateVersion",
    createTradeRequestError
  );

  if (side === "buy") {
    if ("shareAmount" in record) {
      throw new TradeServiceError(
        400,
        "invalid_request",
        "Buy trade requests must not include shareAmount."
      );
    }

    return {
      side,
      outcomeKey,
      contractSide,
      cashAmount: normalizeCashAmount(parseRequiredStringField(record, "cashAmount", createTradeRequestError)),
      idempotencyKey,
      quoteId,
      quotedAt,
      quoteExpiresAt,
      expectedMarketStateVersion
    };
  }

  if (side === "sell") {
    if ("cashAmount" in record) {
      throw new TradeServiceError(
        400,
        "invalid_request",
        "Sell trade requests must not include cashAmount."
      );
    }

    return {
      side,
      outcomeKey,
      contractSide,
      shareAmount: parseRequiredStringField(record, "shareAmount", createTradeRequestError),
      idempotencyKey,
      quoteId,
      quotedAt,
      quoteExpiresAt,
      expectedMarketStateVersion
    };
  }

  throw new TradeServiceError(400, "invalid_request", "Trade side must be buy or sell.");
}
