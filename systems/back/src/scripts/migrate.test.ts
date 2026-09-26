import { describe, expect, it } from "vitest";

import {
  ensureProductionMigrationRecoveryGuard,
  parseMigrateArgs
} from "./migrate";

function productionEnv() {
  return {
    nodeEnv: "production",
    deployEnv: "production"
  } as Parameters<typeof ensureProductionMigrationRecoveryGuard>[0];
}

describe("migrate args", () => {
  it("parses the production recovery guard bypass and reason", () => {
    expect(
      parseMigrateArgs([
        "--allow-production-recovery-guard-bypass",
        "--reason=fresh-launch-schema-repair"
      ])
    ).toMatchObject({
      allowProductionRecoveryGuardBypass: true,
      plan: false,
      reason: "fresh-launch-schema-repair"
    });
  });

  it("requires a reason when bypassing the production recovery guard", () => {
    expect(() =>
      ensureProductionMigrationRecoveryGuard(
        productionEnv(),
        parseMigrateArgs(["--allow-production-recovery-guard-bypass"])
      )
    ).toThrow("--reason=<short-reason> is required");
  });

  it("skips recovery receipts for migration plans", () => {
    expect(() =>
      ensureProductionMigrationRecoveryGuard(productionEnv(), parseMigrateArgs(["--plan"]))
    ).not.toThrow();
  });
});
