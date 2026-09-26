import { resolveOutcomeId, resolveOutcomeKey } from "../shared/market-identity";

export type ContractSide = "yes" | "no";

export type ContractExecutionLeg = {
  outcomeKey: string;
  outcomeId: string;
};

export type ContractExecutionResolution = {
  contractSide: ContractSide;
  requestedOutcomeKey: string;
  requestedOutcomeId: string;
  executionOutcomeKey: string | null;
  executionOutcomeId: string | null;
  executionLegs: ContractExecutionLeg[];
};

type ContractSideMarketRow = {
  outcome_id: string;
};

type NormalizeContractExecutionParams = {
  marketKey: string;
  requestedOutcomeKey: string;
  contractSide: ContractSide;
  marketRows: readonly ContractSideMarketRow[];
};

export class ContractSideNormalizationError extends Error {
  readonly code: "outcome_not_found" | "unsupported_contract_side";

  constructor(
    code: "outcome_not_found" | "unsupported_contract_side",
    message: string
  ) {
    super(message);
    this.name = "ContractSideNormalizationError";
    this.code = code;
  }
}

export function parseContractSide(value: unknown): ContractSide {
  if (value === undefined || value === null || value === "") {
    return "yes";
  }

  if (value === "yes" || value === "no") {
    return value;
  }

  throw new ContractSideNormalizationError(
    "unsupported_contract_side",
    "contractSide must be yes or no."
  );
}

export function normalizeContractExecution(
  params: NormalizeContractExecutionParams
): ContractExecutionResolution {
  const requestedOutcomeId = resolveOutcomeId(
    params.marketKey,
    params.requestedOutcomeKey
  );

  if (!requestedOutcomeId) {
    throw new ContractSideNormalizationError(
      "outcome_not_found",
      "Requested outcome was not found."
    );
  }

  const requestedIndex = params.marketRows.findIndex(
    (row) => row.outcome_id === requestedOutcomeId
  );

  if (requestedIndex < 0) {
    throw new ContractSideNormalizationError(
      "outcome_not_found",
      "Requested outcome was not found."
    );
  }

  if (params.contractSide === "yes") {
    return {
      contractSide: params.contractSide,
      requestedOutcomeKey: params.requestedOutcomeKey,
      requestedOutcomeId,
      executionOutcomeId: requestedOutcomeId,
      executionOutcomeKey: resolveOutcomeKey(requestedOutcomeId) ?? requestedOutcomeId,
      executionLegs: [
        {
          outcomeId: requestedOutcomeId,
          outcomeKey: resolveOutcomeKey(requestedOutcomeId) ?? requestedOutcomeId
        }
      ]
    };
  }

  if (params.marketRows.length === 2) {
    const executionOutcomeId = resolveBinaryNoExecutionOutcomeId(
      params.marketRows,
      requestedIndex
    );
    const executionOutcomeKey =
      resolveOutcomeKey(executionOutcomeId) ?? executionOutcomeId;

    return {
      contractSide: params.contractSide,
      requestedOutcomeKey: params.requestedOutcomeKey,
      requestedOutcomeId,
      executionOutcomeId,
      executionOutcomeKey,
      executionLegs: [
        {
          outcomeId: executionOutcomeId,
          outcomeKey: executionOutcomeKey
        }
      ]
    };
  }

  return {
    contractSide: params.contractSide,
    requestedOutcomeKey: params.requestedOutcomeKey,
    requestedOutcomeId,
    executionOutcomeId: null,
    executionOutcomeKey: null,
    executionLegs: params.marketRows
      .filter((_, index) => index !== requestedIndex)
      .map((row) => ({
        outcomeId: row.outcome_id,
        outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id
      }))
  };
}

function resolveBinaryNoExecutionOutcomeId(
  marketRows: readonly ContractSideMarketRow[],
  requestedIndex: number
): string {
  if (marketRows.length !== 2) {
    throw new ContractSideNormalizationError(
      "unsupported_contract_side",
      "contractSide=no is only supported on binary markets."
    );
  }

  return marketRows[requestedIndex === 0 ? 1 : 0].outcome_id;
}
