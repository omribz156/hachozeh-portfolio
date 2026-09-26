import { quantizeMoney, quantizeShares, toDecimal } from "../shared/decimals";

export type IncidentFinalizeContract = {
  userId: string;
  requestedOutcomeId: string;
  contractSide: "yes" | "no";
  shares: string;
  costBasis: string;
};

export type IncidentFinalizePosition = {
  userId: string;
  outcomeId: string;
  shares: string;
  costBasis: string;
};

export type IncidentFinalizeRealization = {
  id: string;
  userId: string;
  outcomeId: string;
  type: "resolution_win" | "resolution_loss";
  claimStatus: "pending" | "claimed" | "not_applicable";
  shares: string;
  proceeds: string;
  costBasis: string;
  resolutionId: string | null;
};

export type IncidentFinalizeRealizationPlan = {
  userId: string;
  outcomeId: string;
  type: "resolution_win" | "resolution_loss";
  claimStatus: "pending" | "not_applicable";
  shares: string;
  proceeds: string;
  costBasis: string;
  realizedPnl: string;
};

export type IncidentFinalizePlan = {
  blockers: string[];
  realizationIdsToAttach: string[];
  realizationsToCreate: IncidentFinalizeRealizationPlan[];
  positionsToDelete: Array<{ userId: string; outcomeId: string }>;
  pendingClaimReserve: string;
  treasuryTopUp: string;
  treasurySweep: string;
};

type IncidentFinalizePlanInput = {
  winningOutcomeId: string;
  outcomes: Array<{ id: string }>;
  contracts: IncidentFinalizeContract[];
  positions: IncidentFinalizePosition[];
  realizations: IncidentFinalizeRealization[];
  marketTreasuryBalance: string;
};

function contractExecutionOutcomeId(
  outcomes: Array<{ id: string }>,
  contract: IncidentFinalizeContract
): string | null {
  if (contract.contractSide === "yes") {
    return contract.requestedOutcomeId;
  }

  return outcomes.find((outcome) => outcome.id !== contract.requestedOutcomeId)?.id ?? null;
}

function contractKey(userId: string, outcomeId: string): string {
  return `${userId}:${outcomeId}`;
}

export function buildIncidentFinalizePlan(input: IncidentFinalizePlanInput): IncidentFinalizePlan {
  const blockers = new Set<string>();
  const realizationIdsToAttach = new Set<string>();
  const realizationsToCreate: IncidentFinalizeRealizationPlan[] = [];
  const positionsToDelete = new Map<string, { userId: string; outcomeId: string }>();
  let pendingClaimReserve = toDecimal(0);

  if (input.outcomes.length !== 2) {
    blockers.add("binary_market_required");
  }
  if (!input.outcomes.some((outcome) => outcome.id === input.winningOutcomeId)) {
    blockers.add("winning_outcome_missing");
  }
  if (input.contracts.length === 0) {
    blockers.add("unsettled_contracts_missing");
  }

  const expectedKeys = new Set<string>();

  for (const contract of input.contracts) {
    const executionOutcomeId = contractExecutionOutcomeId(input.outcomes, contract);
    if (!executionOutcomeId) {
      blockers.add("contract_execution_outcome_missing");
      continue;
    }

    const key = contractKey(contract.userId, executionOutcomeId);
    if (expectedKeys.has(key)) {
      blockers.add("duplicate_contract_execution_leg");
      continue;
    }
    expectedKeys.add(key);

    const expectedType = executionOutcomeId === input.winningOutcomeId
      ? "resolution_win"
      : "resolution_loss";
    const matchingRealizations = input.realizations.filter((row) => (
      row.userId === contract.userId && row.outcomeId === executionOutcomeId
    ));

    for (const realization of matchingRealizations) {
      if (realization.type !== expectedType) {
        blockers.add("existing_realization_type_mismatch");
      }
      if (realization.resolutionId) {
        blockers.add("existing_realization_already_attached");
      } else {
        realizationIdsToAttach.add(realization.id);
      }
      if (realization.claimStatus === "pending") {
        pendingClaimReserve = pendingClaimReserve.plus(realization.proceeds);
      }
    }

    // contract_positions is the current open remainder. Detached realization
    // rows describe already-settled exposure and must be preserved separately.
    const missingShares = toDecimal(contract.shares);
    const missingCost = toDecimal(contract.costBasis);

    const position = input.positions.find((row) => (
      row.userId === contract.userId && row.outcomeId === executionOutcomeId
    ));
    if (missingShares.lte(0)) {
      blockers.add("invalid_missing_realization_shape");
      continue;
    }
    if (!position) {
      blockers.add("missing_engine_position");
      continue;
    }
    if (!toDecimal(position.shares).eq(missingShares) || !toDecimal(position.costBasis).eq(missingCost)) {
      blockers.add("engine_position_contract_delta_mismatch");
      continue;
    }

    const proceeds = expectedType === "resolution_win" ? missingShares : toDecimal(0);
    if (expectedType === "resolution_win") {
      pendingClaimReserve = pendingClaimReserve.plus(proceeds);
    }

    realizationsToCreate.push({
      userId: contract.userId,
      outcomeId: executionOutcomeId,
      type: expectedType,
      claimStatus: expectedType === "resolution_win" ? "pending" : "not_applicable",
      shares: quantizeShares(missingShares),
      proceeds: quantizeMoney(proceeds),
      costBasis: quantizeMoney(missingCost),
      realizedPnl: quantizeMoney(proceeds.minus(missingCost))
    });
    positionsToDelete.set(key, { userId: contract.userId, outcomeId: executionOutcomeId });
  }

  for (const realization of input.realizations) {
    if (!expectedKeys.has(contractKey(realization.userId, realization.outcomeId))) {
      blockers.add("unexpected_existing_realization");
    }
  }
  for (const position of input.positions) {
    if (!positionsToDelete.has(contractKey(position.userId, position.outcomeId))) {
      blockers.add("unexpected_engine_position");
    }
  }

  const treasuryBalance = toDecimal(input.marketTreasuryBalance);
  const treasuryDelta = pendingClaimReserve.minus(treasuryBalance);

  return {
    blockers: [...blockers],
    realizationIdsToAttach: [...realizationIdsToAttach],
    realizationsToCreate,
    positionsToDelete: [...positionsToDelete.values()],
    pendingClaimReserve: quantizeMoney(pendingClaimReserve),
    treasuryTopUp: quantizeMoney(treasuryDelta.gt(0) ? treasuryDelta : 0),
    treasurySweep: quantizeMoney(treasuryDelta.lt(0) ? treasuryDelta.negated() : 0)
  };
}
