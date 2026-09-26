import type {
  MarketForm,
  MarketMeasurementKind,
  MarketResultShape,
  OracleCapabilityStatus,
  RecurringEventTemplateId,
  SourceLifecycleCapabilityHint,
  SourceRegistryEntry
} from "./contracts";

export type ContractLifecycleInput = {
  recurringTemplateId?: RecurringEventTemplateId;
  marketForm: MarketForm;
  sourceIds?: string[];
};

export type ResolvedContractLifecycle = {
  measurementKind?: MarketMeasurementKind;
  resultShape?: MarketResultShape;
  oracleCapability?: OracleCapabilityStatus;
};

function inferLifecycleShape(input: ContractLifecycleInput): Pick<
  ResolvedContractLifecycle,
  "measurementKind" | "resultShape"
> {
  switch (input.recurringTemplateId) {
    case "sports-match-winner-v1":
      return {
        measurementKind: "final_winner",
        resultShape: "home_away_winner"
      };
    case "sports-regulation-3way-v1":
      return {
        measurementKind: "final_winner",
        resultShape: "three_way_result"
      };
    case "boi-rate-decision-v1":
    case "fed-rate-decision-v1":
    case "ecb-rate-decision-v1":
      return {
        measurementKind: "rate_direction",
        resultShape: input.marketForm === "binary" ? "yes_no" : "cut_hold_hike"
      };
    case "knesset-dissolution-before-date-v1":
      return {
        measurementKind: "deadline_yes_no",
        resultShape: "yes_no"
      };
    default:
      if (input.marketForm === "date-bucket") {
        return {
          measurementKind: "date_bucket",
          resultShape: "date_bucket"
        };
      }

      if (input.marketForm === "threshold") {
        return {
          measurementKind: "threshold_crossing",
          resultShape: "yes_no"
        };
      }

      if (input.marketForm === "range" || input.marketForm === "multi-outcome") {
        return {
          measurementKind: "official_value",
          resultShape: "multi_outcome"
        };
      }

      return {};
  }
}

function fallbackCapability(input: ContractLifecycleInput): OracleCapabilityStatus | undefined {
  switch (input.recurringTemplateId) {
    case "fed-rate-decision-v1":
    case "ecb-rate-decision-v1":
      return "blocked";
    case "sports-match-winner-v1":
    case "sports-regulation-3way-v1":
    case "boi-rate-decision-v1":
    case "knesset-dissolution-before-date-v1":
      return "manual_resolution_required";
    default:
      if (input.marketForm === "date-bucket") {
        return "manual_resolution_required";
      }

      return undefined;
  }
}

function lifecycleCapabilitiesForSourceIds(
  sourceIds: string[] | undefined,
  sourceRegistry: SourceRegistryEntry[]
): SourceLifecycleCapabilityHint[] {
  const requestedSourceIds = new Set(sourceIds ?? []);

  if (requestedSourceIds.size === 0) {
    return [];
  }

  return sourceRegistry
    .filter((source) => requestedSourceIds.has(source.sourceId))
    .flatMap((source) => source.lifecycleCapabilities ?? []);
}

export function resolveContractLifecycleFromRegistry(
  input: ContractLifecycleInput,
  sourceRegistry: SourceRegistryEntry[]
): ResolvedContractLifecycle {
  const inferred = inferLifecycleShape(input);
  const capabilities = lifecycleCapabilitiesForSourceIds(input.sourceIds, sourceRegistry);
  const exactCapability = capabilities.find(
    (capability) =>
      capability.measurementKind === inferred.measurementKind && capability.resultShape === inferred.resultShape
  );

  if (exactCapability) {
    return {
      measurementKind: exactCapability.measurementKind,
      resultShape: exactCapability.resultShape,
      oracleCapability: exactCapability.oracleCapability
    };
  }

  if (!inferred.measurementKind && !inferred.resultShape && capabilities.length === 1) {
    const [capability] = capabilities;

    return {
      measurementKind: capability.measurementKind,
      resultShape: capability.resultShape,
      oracleCapability: capability.oracleCapability
    };
  }

  if (!inferred.measurementKind && !inferred.resultShape && input.marketForm === "binary") {
    const yesNoCapability = capabilities.find((capability) => capability.resultShape === "yes_no");

    if (yesNoCapability) {
      return {
        measurementKind: yesNoCapability.measurementKind,
        resultShape: yesNoCapability.resultShape,
        oracleCapability: yesNoCapability.oracleCapability
      };
    }
  }

  return {
    ...inferred,
    oracleCapability: fallbackCapability(input)
  };
}
