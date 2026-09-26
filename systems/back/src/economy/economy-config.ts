import { toDecimal } from "../shared/decimals";

export const ECONOMY_TIME_ZONE = "Asia/Jerusalem";

export const STARTER_GRANT_AMOUNT = "1000.000000";

export const DAILY_LOGIN_BASELINE_REWARD = "25.000000";

export const DAILY_LOGIN_STREAK_REWARDS = [
  "100.000000",
  "150.000000",
  "200.000000",
  "250.000000",
  "300.000000",
  "350.000000",
  "400.000000"
] as const;

export const DAILY_LOGIN_GRACE_HOUR = 4;

export const EMERGENCY_GRANT_AMOUNT = "100.000000";

export const EMERGENCY_GRANT_COOLDOWN_HOURS = 24;

// Referral: credit for the SHARER when a signup attributed to their shared win
// link lands (decided 2026-07-02). The daily cap is the anti-farming guard —
// breaching it records a referral_velocity abuse flag instead of paying out.
export const REFERRAL_GRANT_AMOUNT = "1000.000000";

export const REFERRAL_DAILY_GRANT_CAP = 5;

export const PLATFORM_TREASURY_LOW_WATERMARK = "100000.000000";

export type FaucetType = "daily_login" | "emergency_bankruptcy";

export const MIN_STAKE_POLICY = {
  defaultMinCashAmount: "10.000000",
  byLiquidityClass: {
    toy_test: "25.000000",
    small_social: "10.000000",
    normal_public: "10.000000",
    serious_economy_politics: "10.000000",
    flagship_proof: "10.000000"
  }
} as const;

export function readDailyStreakReward(streakDay: number): string {
  if (!Number.isInteger(streakDay) || streakDay < 1 || streakDay > DAILY_LOGIN_STREAK_REWARDS.length) {
    throw new Error("Daily streak day must be between 1 and 7.");
  }

  return DAILY_LOGIN_STREAK_REWARDS[streakDay - 1];
}

export function readNextDailyStreakDay(currentStreakDay: number): number {
  if (!Number.isInteger(currentStreakDay) || currentStreakDay < 0) {
    return 1;
  }

  return (currentStreakDay % DAILY_LOGIN_STREAK_REWARDS.length) + 1;
}

export function readMinStakeForLiquidityB(liquidityB: string): string {
  const liquidity = toDecimal(liquidityB);

  if (liquidity.lte("1500.00000000")) {
    return MIN_STAKE_POLICY.byLiquidityClass.toy_test;
  }

  if (liquidity.lte("7500.00000000")) {
    return MIN_STAKE_POLICY.byLiquidityClass.small_social;
  }

  if (liquidity.lte("25000.00000000")) {
    return MIN_STAKE_POLICY.byLiquidityClass.normal_public;
  }

  if (liquidity.lte("75000.00000000")) {
    return MIN_STAKE_POLICY.byLiquidityClass.serious_economy_politics;
  }

  return MIN_STAKE_POLICY.byLiquidityClass.flagship_proof;
}
