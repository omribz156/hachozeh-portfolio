export type LiquidityDepthClass =
  | "toy_test"
  | "small_social"
  | "normal_public"
  | "serious_economy_politics"
  | "flagship_proof";

export type LiquidityDepthPreset = {
  depthClass: LiquidityDepthClass;
  label: string;
  liquidityB: string;
  range: {
    min: string;
    max: string;
  };
  intendedTradeSize: string;
  useWhen: string;
};

export const LMSR_LIQUIDITY_DEPTH_PRESETS: readonly LiquidityDepthPreset[] = [
  {
    depthClass: "toy_test",
    label: "Toy/test",
    liquidityB: "1000.00000000",
    range: {
      min: "500.00000000",
      max: "1500.00000000"
    },
    intendedTradeSize: "100.000000",
    useWhen: "Local fixtures, throwaway stress markets, and mechanics proofs."
  },
  {
    depthClass: "small_social",
    label: "Small/social",
    liquidityB: "5000.00000000",
    range: {
      min: "2500.00000000",
      max: "7500.00000000"
    },
    intendedTradeSize: "500.000000",
    useWhen: "Low-stakes social markets where visible movement is acceptable."
  },
  {
    depthClass: "normal_public",
    label: "Normal public",
    liquidityB: "25000.00000000",
    range: {
      min: "10000.00000000",
      max: "25000.00000000"
    },
    intendedTradeSize: "2000.000000",
    useWhen: "Default public market posture until a stronger class is chosen."
  },
  {
    depthClass: "serious_economy_politics",
    label: "Serious economy/politics",
    liquidityB: "75000.00000000",
    range: {
      min: "25000.00000000",
      max: "75000.00000000"
    },
    intendedTradeSize: "10000.000000",
    useWhen: "BOI, FX, elections, macro, and other trust-sensitive markets."
  },
  {
    depthClass: "flagship_proof",
    label: "Flagship/proof",
    liquidityB: "100000.00000000",
    range: {
      min: "100000.00000000",
      max: "250000.00000000"
    },
    intendedTradeSize: "25000.000000",
    useWhen: "Featured proof markets and whale-behavior gauntlet markets."
  }
] as const;

export function listLiquidityDepthPresets(): readonly LiquidityDepthPreset[] {
  return LMSR_LIQUIDITY_DEPTH_PRESETS;
}

export function getLiquidityDepthPreset(
  depthClass: LiquidityDepthClass
): LiquidityDepthPreset {
  const preset = LMSR_LIQUIDITY_DEPTH_PRESETS.find(
    (candidate) => candidate.depthClass === depthClass
  );

  if (!preset) {
    throw new Error(`Unknown liquidity depth class: ${depthClass}`);
  }

  return preset;
}

export function recommendLiquidityDepth(params: {
  categoryKey?: string | null;
  familyKey?: string | null;
  outcomeCount: number;
}): LiquidityDepthPreset {
  const categoryKey = (params.categoryKey ?? "").toLowerCase();
  const familyKey = (params.familyKey ?? "").toLowerCase();

  if (
    familyKey.includes("boi") ||
    familyKey.includes("rate-decision") ||
    familyKey.includes("fx") ||
    categoryKey === "economy" ||
    categoryKey === "economics" ||
    categoryKey === "politics"
  ) {
    return getLiquidityDepthPreset("serious_economy_politics");
  }

  if (params.outcomeCount >= 6) {
    return getLiquidityDepthPreset("normal_public");
  }

  return getLiquidityDepthPreset("normal_public");
}
