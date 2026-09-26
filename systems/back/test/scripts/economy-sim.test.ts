import { describe, expect, it } from "vitest";

import {
  formatEconomySimReport,
  parseEconomySimArgs,
  runEconomySimulation
} from "../../src/scripts/economy-sim";

describe("economy simulation args", () => {
  it("requires a mode", () => {
    expect(() => parseEconomySimArgs(["--users=10", "--days=1"])).toThrow(
      "Missing simulation mode"
    );
  });

  it("rejects unknown mode", () => {
    expect(() => parseEconomySimArgs(["wrong-mode", "--seed=42"])).toThrow("Unknown simulation mode");
  });

  it("requires users and days for faucet-sizing", () => {
    expect(() => parseEconomySimArgs(["faucet-sizing", "--days=7"])).toThrow("--users is required.");
    expect(() => parseEconomySimArgs(["faucet-sizing", "--users=10"])).toThrow("--days is required.");
  });

  it("defaults seed and validates positive integer options", () => {
    const options = parseEconomySimArgs(["faucet-sizing", "--users=10", "--days=5"]);

    expect(options.seed).toBe(42);
    expect(() => parseEconomySimArgs(["faucet-sizing", "--users=0", "--days=5"])).toThrow(
      "--users must be a positive integer."
    );
    expect(() => parseEconomySimArgs(["faucet-sizing", "--users=10", "--days=-2"])).toThrow(
      "--days must be a positive integer."
    );
    expect(() => parseEconomySimArgs(["faucet-sizing", "--users=10.2", "--days=5"])).toThrow(
      "--users must be a positive integer."
    );
    expect(() => parseEconomySimArgs(["faucet-sizing", "--users=10", "--days=12abc"])).toThrow(
      "--days must be a positive integer."
    );
    expect(() => parseEconomySimArgs(["wash-transfer", "--seed=0"])).toThrow(
      "--seed must be a positive integer."
    );
  });
});

describe("economy simulation deterministic outputs", () => {
  it("is deterministic for matching options", () => {
    const optionsA = parseEconomySimArgs([
      "faucet-sizing",
      "--users=80",
      "--days=5",
      "--seed=77"
    ]);
    const optionsB = parseEconomySimArgs([
      "faucet-sizing",
      "--users=80",
      "--days=5",
      "--seed=77"
    ]);

    const resultA = runEconomySimulation(optionsA);
    const resultB = runEconomySimulation(optionsB);

    expect(resultA).toEqual(resultB);
  });

  it("matches expected faucet report shape", () => {
    const result = runEconomySimulation(
      parseEconomySimArgs(["faucet-sizing", "--users=12", "--days=3", "--seed=11", "--json"])
    );

    expect(result.mode).toBe("faucet-sizing");
    if (result.mode === "faucet-sizing") {
      expect(result).toMatchObject({
        users: 12,
        days: 3,
        seed: 11,
        bustRate: expect.any(Number),
        balanceGini: expect.any(Number),
        treasuryOutflow: expect.stringMatching(/^\d+\.\d{6}$/),
        byType: {
          sharp: { users: expect.any(Number), bustRate: expect.any(Number), meanBalance: expect.any(String), gini: expect.any(Number) },
          noise: { users: expect.any(Number), bustRate: expect.any(Number), meanBalance: expect.any(String), gini: expect.any(Number) },
          "anti-sharp": {
            users: expect.any(Number),
            bustRate: expect.any(Number),
            meanBalance: expect.any(String),
            gini: expect.any(Number)
          }
        }
      });

      expect(result.bustRate).toBeGreaterThanOrEqual(0);
      expect(result.bustRate).toBeLessThanOrEqual(1);
      expect(result.balanceGini).toBeGreaterThanOrEqual(0);
      expect(result.byType.sharp.users + result.byType.noise.users + result.byType["anti-sharp"].users).toBe(12);
    }
  });

  it("keeps json mode as explicit output mode flag", () => {
    const options = parseEconomySimArgs(["faucet-sizing", "--users=5", "--days=2", "--seed=13", "--json"]);

    expect(options.json).toBe(true);

    const result = runEconomySimulation(options);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"mode":"faucet-sizing"');
  });

  it("starts users on the no-active-position baseline faucet", () => {
    const result = runEconomySimulation(
      parseEconomySimArgs(["faucet-sizing", "--users=1", "--days=1", "--seed=1"])
    );

    expect(result.mode).toBe("faucet-sizing");
    if (result.mode === "faucet-sizing") {
      expect(result.treasuryOutflow).toBe("25.000000");
    }
  });
});

describe("economy simulation wash-transfer", () => {
  it("builds transfer efficiency per liquidity class and amount", () => {
    const result = runEconomySimulation(parseEconomySimArgs(["wash-transfer", "--seed=19"]));

    expect(result.mode).toBe("wash-transfer");
    expect(result.summary).toMatchObject({
      lowestEfficiencyClass: expect.any(String),
      mostEfficientClass: expect.any(String),
      highestLossRate: expect.any(String),
      lowestLossRate: expect.any(String)
    });

    if (result.mode === "wash-transfer") {
      const classes = Object.keys(result.transferEfficiency);
      expect(classes.sort()).toEqual(["major", "standard", "toy"]);

      for (const rows of Object.values(result.transferEfficiency)) {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row).toMatchObject({
            liquidityB: expect.any(String),
            amount: expect.any(String),
            shares: expect.any(String),
            cashSpent: expect.any(String),
            cashReturned: expect.any(String),
            efficiency: expect.any(String),
            lossRate: expect.any(String),
            lossAmount: expect.any(String)
          });
          expect(Number.parseFloat(row.efficiency)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("reports transfer sweep in human-readable mode", () => {
    const result = runEconomySimulation(parseEconomySimArgs(["wash-transfer", "--seed=19"]));
    const report = formatEconomySimReport(result);

    expect(report).toContain("Economy simulation (wash-transfer)");
    expect(report).toContain("Transfer efficiency sweep");
  });
});
