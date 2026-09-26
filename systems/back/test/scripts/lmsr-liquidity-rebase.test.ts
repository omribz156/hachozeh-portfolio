import { describe, expect, it } from "vitest";

import { parseLiquidityRebaseArgs } from "../../src/scripts/lmsr-liquidity-rebase";

describe("parseLiquidityRebaseArgs", () => {
  it("requires a market id", () => {
    expect(() => parseLiquidityRebaseArgs([])).toThrow("--market=<market-id> is required");
  });

  it("uses safe dry-run defaults", () => {
    expect(parseLiquidityRebaseArgs(["--market=market-1"])).toEqual({
      allowShrink: false,
      execute: false,
      format: "markdown",
      marketId: "market-1",
      reason: null,
      targetLiquidityB: null
    });
  });

  it("parses all supported options", () => {
    expect(parseLiquidityRebaseArgs([
      "--market=market-1",
      "--execute",
      "--reason=operator approved",
      "--allow-shrink",
      "--format=json",
      "--target-b=50000.00000000"
    ])).toEqual({
      allowShrink: true,
      execute: true,
      format: "json",
      marketId: "market-1",
      reason: "operator approved",
      targetLiquidityB: "50000.00000000"
    });
  });

  it("requires a reason for execute mode", () => {
    expect(() => parseLiquidityRebaseArgs([
      "--market=market-1",
      "--execute"
    ])).toThrow("--execute requires --reason=<operator reason>");
  });

  it("rejects unsupported output formats", () => {
    expect(() => parseLiquidityRebaseArgs([
      "--market=market-1",
      "--format=csv"
    ])).toThrow("--format must be markdown or json");
  });
});
