import { describe, expect, it } from "vitest";

import {
  buildContractCoverage,
  parseResolutionMoneyAuditOptions,
  realizationsMatchWinnerOrCompensation,
  resolveContractExecutionOutcomeIds
} from "../../src/scripts/resolution-money-audit";

const outcomes = [
  { id: "market-outcome-option-1", label: "Brazil", sort_order: 0 },
  { id: "market-outcome-option-2", label: "Japan", sort_order: 1 }
];

describe("resolution money audit", () => {
  it("requires a market id", () => {
    expect(() => parseResolutionMoneyAuditOptions([])).toThrow("--market-id is required.");
  });

  it("parses render receipt mode separately from normal json output", () => {
    expect(parseResolutionMoneyAuditOptions([
      "--market-id=market-1",
      "--json",
      "--render-log-receipt",
      "--fail-on-review"
    ])).toEqual({
      marketId: "market-1",
      json: true,
      renderLogReceipt: true,
      failOnReview: true
    });
  });

  it("maps binary no contracts to the opposite execution outcome", () => {
    expect(resolveContractExecutionOutcomeIds(
      outcomes,
      "market-outcome-option-1",
      "no"
    )).toEqual(["market-outcome-option-2"]);
  });

  it("does not flag a settled binary no contract when realization is on the opposite outcome", () => {
    const coverage = buildContractCoverage(outcomes, [
      {
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        contract_side: "no",
        contract_shares: "30.559479",
        contract_cost: "10.000000",
        settled: true
      }
    ], [
      {
        id: "realization-1",
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-2",
        outcome_label: "Japan",
        type: "resolution_loss",
        claim_status: "not_applicable",
        shares: "30.559479",
        proceeds: "0.000000",
        cost: "10.000000",
        pnl: "-10.000000",
        created_at: "2026-07-13T06:38:15.340Z"
      }
    ]);

    expect(coverage).toMatchObject([
      {
        expected_outcome_ids: ["market-outcome-option-2"],
        realized_rows: 1,
        share_delta: "0.000000",
        cost_delta: "0.000000",
        ok: true
      }
    ]);
  });

  it("excludes preserved pre-resolution realizations from current contract coverage", () => {
    const coverage = buildContractCoverage(outcomes, [
      {
        user_label: "Tam",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        contract_side: "no",
        contract_shares: "2638.031702",
        contract_cost: "1500.000000",
        settled: true
      }
    ], [
      {
        id: "realization-old",
        user_label: "Tam",
        user_id: "user-1",
        outcome_id: "market-outcome-option-2",
        outcome_label: "Japan",
        type: "resolution_win",
        claim_status: "claimed",
        shares: "69.756702",
        proceeds: "69.756702",
        cost: "35.000000",
        pnl: "34.756702",
        created_at: "2026-07-11T16:15:43.663Z"
      },
      {
        id: "realization-current",
        user_label: "Tam",
        user_id: "user-1",
        outcome_id: "market-outcome-option-2",
        outcome_label: "Japan",
        type: "resolution_win",
        claim_status: "pending",
        shares: "2638.031702",
        proceeds: "2638.031702",
        cost: "1500.000000",
        pnl: "1138.031702",
        created_at: "2026-07-13T06:38:15.340Z"
      }
    ], "2026-07-13T06:38:15.340Z");

    expect(coverage).toMatchObject([{
      realized_rows: 1,
      realized_shares: "2638.031702",
      realized_cost: "1500.000000",
      share_delta: "0.000000",
      cost_delta: "0.000000",
      ok: true
    }]);
  });

  it("includes realization rows written just before the market resolved timestamp", () => {
    const coverage = buildContractCoverage(outcomes, [
      {
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        contract_side: "yes",
        contract_shares: "10.000000",
        contract_cost: "6.000000",
        settled: true
      }
    ], [
      {
        id: "realization-1",
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        type: "resolution_win",
        claim_status: "pending",
        shares: "10.000000",
        proceeds: "10.000000",
        cost: "6.000000",
        pnl: "4.000000",
        created_at: "2026-07-13T06:38:15.332Z"
      }
    ], "2026-07-13T06:38:15.340Z");

    expect(coverage[0]).toMatchObject({ realized_rows: 1, ok: true });
  });

  it("accepts an exact make-whole grant for a winning outcome recorded as a loss", () => {
    expect(realizationsMatchWinnerOrCompensation([
      {
        id: "realization-1",
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        type: "resolution_loss",
        claim_status: "not_applicable",
        shares: "10.000000",
        proceeds: "0.000000",
        cost: "6.000000",
        pnl: "-6.000000",
        created_at: "2026-07-13T06:38:15.332Z"
      }
    ], "market-outcome-option-1", [
      { realization_event_id: "realization-1", amount: "10.000000" }
    ])).toBe(true);
  });

  it("rejects an uncompensated loss on the canonical winning outcome", () => {
    expect(realizationsMatchWinnerOrCompensation([
      {
        id: "realization-1",
        user_label: "Geffen",
        user_id: "user-1",
        outcome_id: "market-outcome-option-1",
        outcome_label: "Brazil",
        type: "resolution_loss",
        claim_status: "not_applicable",
        shares: "10.000000",
        proceeds: "0.000000",
        cost: "6.000000",
        pnl: "-6.000000",
        created_at: "2026-07-13T06:38:15.332Z"
      }
    ], "market-outcome-option-1", [])).toBe(false);
  });
});
