import { describe, expect, it } from "vitest";

import {
  buildMigrationPlan,
  parseMigrationPrefix,
  parseMigrateArgs,
  detectPrefixCollisions
} from "../../src/scripts/migrate";

describe("parseMigrationPrefix", () => {
  it("extracts the leading numeric prefix", () => {
    expect(parseMigrationPrefix("010_market_family_keys.sql")).toBe(10);
    expect(parseMigrationPrefix("001_core_market_tables.sql")).toBe(1);
    expect(parseMigrationPrefix("029_market_event_child_labels.sql")).toBe(29);
  });

  it("returns null when there is no numeric prefix", () => {
    expect(parseMigrationPrefix("no_prefix.sql")).toBeNull();
    expect(parseMigrationPrefix("README.md")).toBeNull();
    expect(parseMigrationPrefix("")).toBeNull();
  });

  it("handles zero-padded prefixes", () => {
    expect(parseMigrationPrefix("011_oracle_case_review_actions.sql")).toBe(11);
    expect(parseMigrationPrefix("011_oracle_runtime_snapshots.sql")).toBe(11);
  });
});

describe("detectPrefixCollisions", () => {
  it("returns empty when all prefixes are unique and none applied", () => {
    const files = [
      "001_core.sql",
      "002_economy.sql",
      "003_trading.sql"
    ];
    expect(detectPrefixCollisions(files, new Set())).toEqual([]);
  });

  it("flags a collision when two files share a prefix and neither is applied", () => {
    const files = [
      "032_new_feature.sql",
      "032_new_feature_indexes.sql",
      "011_other.sql"
    ];
    const collisions = detectPrefixCollisions(files, new Set());
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain("032");
    expect(collisions[0]).toContain("032_new_feature.sql");
    expect(collisions[0]).toContain("032_new_feature_indexes.sql");
  });

  it("flags a collision when two files share a prefix and only one is applied", () => {
    const files = [
      "032_new_feature.sql",
      "032_new_feature_indexes.sql"
    ];
    // Only one of the pair is applied — still ambiguous.
    const applied = new Set(["032_new_feature.sql"]);
    const collisions = detectPrefixCollisions(files, applied);
    expect(collisions).toHaveLength(1);
  });

  it("grandfathers known historical duplicate prefixes on fresh databases", () => {
    const files = [
      "010_market_family_keys.sql",
      "010_oracle_case_reviews.sql",
      "011_oracle_case_review_actions.sql",
      "011_oracle_runtime_snapshots.sql",
      "012_trade_contract_side.sql"
    ];
    expect(detectPrefixCollisions(files, new Set())).toEqual([]);
  });

  it("grandfathers duplicate prefixes when ALL files in the group are already applied", () => {
    // Mirrors the real 010 and 011 pairs that exist in the repo and are applied.
    const files = [
      "010_market_family_keys.sql",
      "010_oracle_case_reviews.sql",
      "011_oracle_case_review_actions.sql",
      "011_oracle_runtime_snapshots.sql",
      "012_trade_contract_side.sql"
    ];
    const applied = new Set([
      "010_market_family_keys.sql",
      "010_oracle_case_reviews.sql",
      "011_oracle_case_review_actions.sql",
      "011_oracle_runtime_snapshots.sql",
      "012_trade_contract_side.sql"
    ]);
    expect(detectPrefixCollisions(files, applied)).toEqual([]);
  });

  it("reports multiple independent collisions separately", () => {
    const files = [
      "005_a.sql",
      "005_b.sql",
      "007_c.sql",
      "007_d.sql"
    ];
    const collisions = detectPrefixCollisions(files, new Set());
    expect(collisions).toHaveLength(2);
    expect(collisions.some((c) => c.includes("005"))).toBe(true);
    expect(collisions.some((c) => c.includes("007"))).toBe(true);
  });

  it("ignores files without a numeric prefix", () => {
    const files = [
      "001_core.sql",
      "README.md",
      "no_prefix.sql"
    ];
    expect(detectPrefixCollisions(files, new Set())).toEqual([]);
  });
});

describe("parseMigrateArgs", () => {
  it("defaults to apply mode", () => {
    expect(parseMigrateArgs([])).toEqual({
      allowProductionRecoveryGuardBypass: false,
      plan: false,
      reason: null
    });
  });

  it("enables read-only plan mode", () => {
    expect(parseMigrateArgs(["--plan"])).toEqual({
      allowProductionRecoveryGuardBypass: false,
      plan: true,
      reason: null
    });
    expect(parseMigrateArgs(["--check"])).toEqual({
      allowProductionRecoveryGuardBypass: false,
      plan: true,
      reason: null
    });
  });
});

describe("buildMigrationPlan", () => {
  it("separates applied and pending migrations in sorted order", () => {
    const plan = buildMigrationPlan(
      [
        "003_trading.sql",
        "001_core.sql",
        "002_economy.sql"
      ],
      new Set(["001_core.sql"])
    );

    expect(plan).toEqual({
      applied: ["001_core.sql"],
      pending: ["002_economy.sql", "003_trading.sql"],
      total: 3,
      collisions: []
    });
  });

  it("includes prefix collisions without applying anything", () => {
    const plan = buildMigrationPlan(
      [
        "032_new_feature.sql",
        "032_new_feature_indexes.sql"
      ],
      new Set()
    );

    expect(plan.collisions).toHaveLength(1);
    expect(plan.pending).toEqual([
      "032_new_feature.sql",
      "032_new_feature_indexes.sql"
    ]);
  });
});
