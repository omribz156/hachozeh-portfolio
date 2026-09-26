import { describe, expect, it } from "vitest";

import { buildIncidentFinalizePlan } from "../../src/scripts/market-incident-finalize-plan";

describe("market incident finalize plan", () => {
  it("preserves a claimed partial win and plans only the missing binary NO settlement", () => {
    const plan = buildIncidentFinalizePlan({
      winningOutcomeId: "no",
      outcomes: [{ id: "yes" }, { id: "no" }],
      contracts: [{
        userId: "user-1",
        requestedOutcomeId: "yes",
        contractSide: "no",
        shares: "2638.031702",
        costBasis: "1500.000000"
      }],
      positions: [{
        userId: "user-1",
        outcomeId: "no",
        shares: "2638.031702",
        costBasis: "1500.000000"
      }],
      realizations: [{
        id: "realization-claimed",
        userId: "user-1",
        outcomeId: "no",
        type: "resolution_win",
        claimStatus: "claimed",
        shares: "69.756702",
        proceeds: "69.756702",
        costBasis: "35.000000",
        resolutionId: null
      }],
      marketTreasuryBalance: "1500.000000"
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.realizationIdsToAttach).toEqual(["realization-claimed"]);
    expect(plan.realizationsToCreate).toEqual([{
      userId: "user-1",
      outcomeId: "no",
      type: "resolution_win",
      claimStatus: "pending",
      shares: "2638.031702",
      proceeds: "2638.031702",
      costBasis: "1500.000000",
      realizedPnl: "1138.031702"
    }]);
    expect(plan.pendingClaimReserve).toBe("2638.031702");
    expect(plan.treasuryTopUp).toBe("1138.031702");
    expect(plan.treasurySweep).toBe("0.000000");
  });
});
