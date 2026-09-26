import { describe, expect, it } from "vitest";

import {
  DAILY_LOGIN_BASELINE_REWARD,
  DAILY_LOGIN_STREAK_REWARDS,
  ECONOMY_TIME_ZONE,
  EMERGENCY_GRANT_AMOUNT,
  MIN_STAKE_POLICY,
  STARTER_GRANT_AMOUNT,
  readDailyStreakReward,
  readMinStakeForLiquidityB,
  readNextDailyStreakDay
} from "../../src/economy/economy-config";

describe("economy config", () => {
  it("locks starter, baseline, emergency, timezone, and daily streak reward values", () => {
    expect(STARTER_GRANT_AMOUNT).toBe("1000.000000");
    expect(DAILY_LOGIN_BASELINE_REWARD).toBe("25.000000");
    expect(EMERGENCY_GRANT_AMOUNT).toBe("100.000000");
    expect(ECONOMY_TIME_ZONE).toBe("Asia/Jerusalem");
    expect(DAILY_LOGIN_STREAK_REWARDS).toEqual([
      "100.000000",
      "150.000000",
      "200.000000",
      "250.000000",
      "300.000000",
      "350.000000",
      "400.000000"
    ]);
  });

  it("loops day 8 back to day 1", () => {
    expect(readNextDailyStreakDay(0)).toBe(1);
    expect(readNextDailyStreakDay(1)).toBe(2);
    expect(readNextDailyStreakDay(7)).toBe(1);
  });

  it("rejects invalid direct daily reward reads", () => {
    expect(readDailyStreakReward(1)).toBe("100.000000");
    expect(readDailyStreakReward(7)).toBe("400.000000");
    expect(() => readDailyStreakReward(8)).toThrow(/between 1 and 7/);
  });

  it("maps liquidity depth to min stake policy", () => {
    expect(MIN_STAKE_POLICY.defaultMinCashAmount).toBe("10.000000");
    expect(readMinStakeForLiquidityB("1000.00000000")).toBe("25.000000");
    expect(readMinStakeForLiquidityB("5000.00000000")).toBe("10.000000");
    expect(readMinStakeForLiquidityB("25000.00000000")).toBe("10.000000");
    expect(readMinStakeForLiquidityB("75000.00000000")).toBe("10.000000");
    expect(readMinStakeForLiquidityB("100000.00000000")).toBe("10.000000");
  });
});
