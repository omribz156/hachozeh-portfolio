import type { normalizeContractExecution } from "../contract-side-normalization";

export function buildResponseExecutionLegs(
  contractResolution: ReturnType<typeof normalizeContractExecution>,
  shareAmount: string
) {
  return contractResolution.executionLegs.map((leg) => ({
    outcomeKey: leg.outcomeKey,
    outcomeId: leg.outcomeId,
    shareAmount
  }));
}
