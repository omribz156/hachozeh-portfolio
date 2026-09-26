import {
  findOracleLifecycleSourceAdapter,
  getOracleLifecycleSourceAdapters
} from "./source-adapter-registry";
import type { OracleLifecycleSourceContext } from "./source-adapter-contracts";

export type OracleSourceCapabilityCheckStatus =
  | "full_cycle_supported"
  | "final_only_supported"
  | "credible_reporting_supported"
  | "close_only_supported"
  | "registered_no_credentials"
  | "adapter_not_implemented";

export type OracleSourceCapabilityCheckInput = {
  sourceId: string;
  measurementKind: string;
  resultShape: string;
  sourceUrl?: string | null;
};

export type OracleSourceCapabilityCheck = {
  objectType: "oracle_source_capability_check";
  sourceId: string;
  measurementKind: string;
  resultShape: string;
  sourceUrl: string | null;
  status: OracleSourceCapabilityCheckStatus;
  adapterFamily: string | null;
  adapterLabel: string | null;
  nextAction: "none" | "build_oracle_adapter" | "configure_credentials";
  reason: string;
};

function buildSyntheticContext(input: OracleSourceCapabilityCheckInput): OracleLifecycleSourceContext {
  return {
    marketId: "capability-check",
    marketTitle: "Capability check",
    marketStatus: "open",
    closeAt: new Date(0).toISOString(),
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: input.sourceUrl ?? "",
    resolutionRules: "Capability check only.",
    oracleSourcePolicy: {
      preferredSourceIds: [input.sourceId],
      resolutionSourceIds: [input.sourceId]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: input.measurementKind,
      resultShape: input.resultShape,
      resolutionSource: {
        url: input.sourceUrl ?? null,
        sourceIds: [input.sourceId]
      }
    },
    outcomes: []
  };
}

export function checkOracleSourceCapability(
  input: OracleSourceCapabilityCheckInput
): OracleSourceCapabilityCheck {
  if (
    input.sourceId === "src_credible_reporting_bundle" &&
    input.measurementKind === "reported_claim" &&
    (input.resultShape === "yes_no" || input.resultShape === "multi_outcome")
  ) {
    return {
      objectType: "oracle_source_capability_check",
      sourceId: input.sourceId,
      measurementKind: input.measurementKind,
      resultShape: input.resultShape,
      sourceUrl: input.sourceUrl ?? null,
      status: "credible_reporting_supported",
      adapterFamily: "credible_reporting",
      adapterLabel: "Credible reporting evaluator",
      nextAction: "none",
      reason:
        "Oracle can evaluate stored candidate evidence for independent-source agreement and create a human-gated case."
    };
  }

  const context = buildSyntheticContext(input);
  const adapter = findOracleLifecycleSourceAdapter(context, getOracleLifecycleSourceAdapters());

  if (!adapter) {
    return {
      objectType: "oracle_source_capability_check",
      sourceId: input.sourceId,
      measurementKind: input.measurementKind,
      resultShape: input.resultShape,
      sourceUrl: input.sourceUrl ?? null,
      status: "adapter_not_implemented",
      adapterFamily: null,
      adapterLabel: null,
      nextAction: "build_oracle_adapter",
      reason: "No Oracle source adapter supports this sourceId + measurementKind + resultShape."
    };
  }

  const missingEnvVars = (adapter.requiredEnvVars ?? []).filter((name) => !process.env[name]?.trim());

  if (missingEnvVars.length > 0) {
    return {
      objectType: "oracle_source_capability_check",
      sourceId: input.sourceId,
      measurementKind: input.measurementKind,
      resultShape: input.resultShape,
      sourceUrl: input.sourceUrl ?? null,
      status: "registered_no_credentials",
      adapterFamily: adapter.sourceFamily,
      adapterLabel: adapter.sourceLabel,
      nextAction: "configure_credentials",
      reason: `Oracle has an adapter for this source family, but missing required env: ${missingEnvVars.join(", ")}.`
    };
  }

  const status: OracleSourceCapabilityCheckStatus =
    adapter.capabilities.closeCondition && adapter.capabilities.resolution
      ? "full_cycle_supported"
      : adapter.capabilities.resolution
        ? "final_only_supported"
        : adapter.capabilities.closeCondition
          ? "close_only_supported"
          : "adapter_not_implemented";

  return {
    objectType: "oracle_source_capability_check",
    sourceId: input.sourceId,
    measurementKind: input.measurementKind,
    resultShape: input.resultShape,
    sourceUrl: input.sourceUrl ?? null,
    status,
    adapterFamily: adapter.sourceFamily,
    adapterLabel: adapter.sourceLabel,
    nextAction: status === "adapter_not_implemented" ? "build_oracle_adapter" : "none",
    reason:
      status === "full_cycle_supported"
        ? "Oracle has close-condition and final-resolution adapter support."
        : status === "final_only_supported"
          ? "Oracle has final-resolution adapter support; scheduled/manual close remains separate."
          : status === "close_only_supported"
            ? "Oracle has close-condition adapter support but no final-resolution support."
            : "No Oracle source adapter supports this source family."
  };
}
