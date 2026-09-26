import {
  recommendLiquidityDepth,
  type LiquidityDepthClass,
  type LiquidityDepthPreset
} from "./liquidity-policy";

export type LiquidityAuditFlag =
  | "missing_outcomes"
  | "below_recommended"
  | "below_recommended_min"
  | "legacy_shallow_pool"
  | "volume_depth_mismatch";

export type LiquidityAuditSeverity = "ok" | "watch" | "warning" | "critical";

export type LiquidityAuditInput = {
  marketId: string;
  title: string;
  status: string;
  categoryKey?: string | null;
  familyKey?: string | null;
  outcomeCount: number;
  liquidityB: string;
  tradeCount: number;
  tradeVolume: string;
};

export type LiquidityAuditResult = LiquidityAuditInput & {
  recommendedDepthClass: LiquidityDepthClass;
  recommendedLiquidityB: string;
  recommendedMinLiquidityB: string;
  recommendedMaxLiquidityB: string;
  liquidityRatio: string;
  volumeToDepthRatio: string;
  flags: LiquidityAuditFlag[];
  severity: LiquidityAuditSeverity;
};

function parseAmount(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function isStressLike(input: LiquidityAuditInput): boolean {
  const haystack = [
    input.marketId,
    input.title,
    input.categoryKey ?? "",
    input.familyKey ?? ""
  ].join(" ").toLowerCase();

  return haystack.includes("stress") || haystack.includes("gauntlet");
}

function buildFlags(
  input: LiquidityAuditInput,
  preset: LiquidityDepthPreset
): LiquidityAuditFlag[] {
  const flags = new Set<LiquidityAuditFlag>();
  const liquidityB = parseAmount(input.liquidityB);
  const recommendedB = parseAmount(preset.liquidityB);
  const recommendedMin = parseAmount(preset.range.min);
  const tradeVolume = parseAmount(input.tradeVolume);

  if (input.outcomeCount < 2) {
    flags.add("missing_outcomes");
  }

  if (liquidityB < recommendedB) {
    flags.add("below_recommended");
  }

  if (liquidityB < recommendedMin) {
    flags.add("below_recommended_min");
  }

  if (liquidityB <= 1500 && !isStressLike(input)) {
    flags.add("legacy_shallow_pool");
  }

  if (tradeVolume >= 250000 && liquidityB > 0 && tradeVolume / liquidityB >= 25) {
    flags.add("volume_depth_mismatch");
  }

  return Array.from(flags);
}

function deriveSeverity(flags: readonly LiquidityAuditFlag[]): LiquidityAuditSeverity {
  if (flags.includes("missing_outcomes") || flags.includes("below_recommended_min")) {
    return "critical";
  }

  if (flags.includes("legacy_shallow_pool")) {
    return "warning";
  }

  if (flags.includes("below_recommended") || flags.includes("volume_depth_mismatch")) {
    return "watch";
  }

  return "ok";
}

export function classifyLiquidityAuditRow(input: LiquidityAuditInput): LiquidityAuditResult {
  const preset = recommendLiquidityDepth({
    categoryKey: input.categoryKey,
    familyKey: input.familyKey,
    outcomeCount: input.outcomeCount
  });
  const liquidityB = parseAmount(input.liquidityB);
  const recommendedB = parseAmount(preset.liquidityB);
  const tradeVolume = parseAmount(input.tradeVolume);
  const flags = buildFlags(input, preset);

  return {
    ...input,
    recommendedDepthClass: preset.depthClass,
    recommendedLiquidityB: preset.liquidityB,
    recommendedMinLiquidityB: preset.range.min,
    recommendedMaxLiquidityB: preset.range.max,
    liquidityRatio:
      recommendedB > 0 ? (liquidityB / recommendedB).toFixed(4) : "0.0000",
    volumeToDepthRatio:
      liquidityB > 0 ? (tradeVolume / liquidityB).toFixed(4) : "0.0000",
    flags,
    severity: deriveSeverity(flags)
  };
}
