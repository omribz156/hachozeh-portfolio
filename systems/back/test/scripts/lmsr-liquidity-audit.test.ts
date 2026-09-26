import { describe, expect, it } from "vitest";

import { parseLiquidityAuditArgs } from "../../src/scripts/lmsr-liquidity-audit";

describe("parseLiquidityAuditArgs", () => {
  it("uses audit defaults", () => {
    expect(parseLiquidityAuditArgs([])).toEqual({
      format: "markdown",
      limit: 40,
      marketId: null,
      onlyFlagged: false,
      requireClean: false,
      status: null,
      withRebasePlan: false
    });
  });

  it("parses all supported options", () => {
    expect(parseLiquidityAuditArgs([
      "--format=json",
      "--limit=25",
      "--market=market-1",
      "--only-flagged",
      "--require-clean",
      "--status=open",
      "--with-rebase-plan"
    ])).toEqual({
      format: "json",
      limit: 25,
      marketId: "market-1",
      onlyFlagged: true,
      requireClean: true,
      status: "open",
      withRebasePlan: true
    });
  });

  it("rejects unsupported output formats", () => {
    expect(() => parseLiquidityAuditArgs(["--format=csv"])).toThrow(
      "--format must be markdown or json"
    );
  });

  it("rejects invalid limits", () => {
    for (const arg of ["--limit=0", "--limit=501", "--limit=nope"]) {
      expect(() => parseLiquidityAuditArgs([arg])).toThrow(
        "--limit must be an integer between 1 and 500"
      );
    }
  });

  it("keeps sparse flags independent", () => {
    expect(parseLiquidityAuditArgs(["--only-flagged"])).toMatchObject({
      onlyFlagged: true,
      requireClean: false,
      withRebasePlan: false
    });
  });
});
