import { BOI_RATE_DECISION_SOURCE_ADAPTER } from "./adapters/boi-rate-decision-source-adapter";
import { BOI_EXCHANGE_RATES_SOURCE_ADAPTER } from "./adapters/boi-exchange-rates-source-adapter";
import { COINBASE_CANDLES_SOURCE_ADAPTER } from "./adapters/coinbase-candles-source-adapter";
import { EUROVISION_SCOREBOARD_SOURCE_ADAPTER } from "./adapters/eurovision-scoreboard-source-adapter";
import { FIBA_BASKETBALL_SOURCE_ADAPTER } from "./adapters/fiba-basketball-source-adapter";
import { FIFA_MATCH_CENTRE_SOURCE_ADAPTER } from "./adapters/fifa-match-centre-source-adapter";
import { IFA_SOURCE_ADAPTER } from "./adapters/ifa-source-adapter";
import { IBBA_SOURCE_ADAPTER } from "./adapters/ibba-source-adapter";
import { KNESSET_OFFICIAL_SOURCE_ADAPTER } from "./adapters/knesset-official-source-adapter";
import { IMS_WEATHER_SOURCE_ADAPTER } from "./adapters/ims-weather-source-adapter";
import { NBA_SOURCE_ADAPTER } from "./adapters/nba-source-adapter";
import { NIKE_LIGA_SOURCE_ADAPTER } from "./adapters/nike-liga-source-adapter";
import { SHOW_OFFICIAL_SOURCE_ADAPTER } from "./adapters/show-official-source-adapter";
import { CBS_TIME_SERIES_SOURCE_ADAPTER } from "./adapters/cbs-time-series-source-adapter";
import { TRADINGVIEW_FX_SOURCE_ADAPTER } from "./adapters/tradingview-fx-source-adapter";
import { WIMBLEDON_OFFICIAL_SOURCE_ADAPTER } from "./adapters/wimbledon-official-source-adapter";
import { WINNER_LEAGUE_SOURCE_ADAPTER } from "./adapters/winner-league-source-adapter";
import type {
  OracleLifecycleSourceAdapter,
  OracleLifecycleSourceContext
} from "./source-adapter-contracts";
import { readContractSourceIds } from "./source-adapter-contracts";

export type OracleLifecycleCapabilityClassification =
  | "supported_close_and_resolution"
  | "supported_scheduled_close_only"
  | "supported_resolution_only"
  | "supported_credible_reporting"
  | "supported_close_only"
  | "manual_resolution_required"
  | "blocked_by_contract"
  | "contract_incomplete"
  | "registered_no_credentials"
  | "unsupported_source_family";

export type OracleLifecycleCapabilityBlocker = {
  blockerCode:
    | "contract_incomplete"
    | "registered_no_credentials"
    | "unsupported_source_family"
    | "manual_resolution_required"
    | "blocked_by_contract";
  reason: string;
};

export type OracleLifecycleCapability = {
  objectType: "oracle_lifecycle_capability";
  marketId: string;
  marketTitle: string;
  classification: OracleLifecycleCapabilityClassification;
  close: {
    supported: boolean;
    sourceFamily: string | null;
    sourceLabel: string | null;
    scheduledCloseSupported: true;
    eventCompletionSupported: boolean;
    requiresHumanApproval: boolean;
  };
  resolution: {
    supported: boolean;
    sourceFamily: string | null;
    sourceLabel: string | null;
  };
  blockers: OracleLifecycleCapabilityBlocker[];
};

const DEFAULT_ADAPTERS: OracleLifecycleSourceAdapter[] = [
  NBA_SOURCE_ADAPTER,
  NIKE_LIGA_SOURCE_ADAPTER,
  BOI_RATE_DECISION_SOURCE_ADAPTER,
  BOI_EXCHANGE_RATES_SOURCE_ADAPTER,
  TRADINGVIEW_FX_SOURCE_ADAPTER,
  IBBA_SOURCE_ADAPTER,
  IMS_WEATHER_SOURCE_ADAPTER,
  COINBASE_CANDLES_SOURCE_ADAPTER,
  EUROVISION_SCOREBOARD_SOURCE_ADAPTER,
  FIBA_BASKETBALL_SOURCE_ADAPTER,
  FIFA_MATCH_CENTRE_SOURCE_ADAPTER,
  IFA_SOURCE_ADAPTER,
  KNESSET_OFFICIAL_SOURCE_ADAPTER,
  CBS_TIME_SERIES_SOURCE_ADAPTER,
  WINNER_LEAGUE_SOURCE_ADAPTER,
  WIMBLEDON_OFFICIAL_SOURCE_ADAPTER,
  SHOW_OFFICIAL_SOURCE_ADAPTER
];

export function getOracleLifecycleSourceAdapters(): OracleLifecycleSourceAdapter[] {
  return [...DEFAULT_ADAPTERS];
}

export function findOracleLifecycleSourceAdapter(
  context: OracleLifecycleSourceContext,
  adapters: OracleLifecycleSourceAdapter[] = DEFAULT_ADAPTERS
): OracleLifecycleSourceAdapter | null {
  const sourceIds = readContractSourceIds(context);
  const contract = context.marketContract;

  return (
    adapters.find((adapter) => {
      const sourceMatches =
        sourceIds.length === 0 ||
        adapter.sourceIds.length === 0 ||
        sourceIds.some((sourceId) => adapter.sourceIds.includes(sourceId));
      const measurementMatches =
        !contract?.measurementKind ||
        adapter.measurementKinds.length === 0 ||
        adapter.measurementKinds.includes(contract.measurementKind);
      const shapeMatches =
        !contract?.resultShape ||
        adapter.resultShapes.length === 0 ||
        adapter.resultShapes.includes(contract.resultShape);
      const explicitRouteMatches =
        !contract?.measurementKind ||
        !contract?.resultShape ||
        !adapter.routes?.length ||
        adapter.routes.some(
          (route) =>
            route.measurementKind === contract.measurementKind &&
            route.resultShape === contract.resultShape
        );

      return sourceMatches && measurementMatches && shapeMatches && explicitRouteMatches && adapter.supportsSource(context);
    }) ?? null
  );
}

export function classifyOracleLifecycleSupport(
  context: OracleLifecycleSourceContext,
  adapters: OracleLifecycleSourceAdapter[] = DEFAULT_ADAPTERS
): OracleLifecycleCapability {
  const blockers: OracleLifecycleCapabilityBlocker[] = [];
  const adapter = findOracleLifecycleSourceAdapter(context, adapters);
  const contract = context.marketContract;
  const contractResolutionSource = contract?.resolutionSource?.url?.trim() ?? "";
  const hasResolutionSource = Boolean(context.resolutionSource.trim() || contractResolutionSource);

  if (!hasResolutionSource) {
    blockers.push({
      blockerCode: "contract_incomplete",
      reason: "Market is missing a durable resolution source, so Oracle cannot classify lifecycle support."
    });
  }

  if (contract?.oracleCapability === "blocked") {
    blockers.push({
      blockerCode: "blocked_by_contract",
      reason:
        "Seer market_contract marks this market blocked for Oracle lifecycle handling; do not treat it as an autonomous full-cycle market."
    });
  }

  if (contract?.oracleCapability === "manual_resolution_required") {
    blockers.push({
      blockerCode: "manual_resolution_required",
      reason:
        "Seer market_contract marks this market as manual-resolution required; route through explicit human/manual Oracle handling."
    });
  }

  if (contract?.oracleCapability === "credible_reporting" && blockers.length === 0) {
    return {
      objectType: "oracle_lifecycle_capability",
      marketId: context.marketId,
      marketTitle: context.marketTitle,
      classification: "supported_credible_reporting",
      close: {
        supported: false,
        sourceFamily: null,
        sourceLabel: null,
        scheduledCloseSupported: true,
        eventCompletionSupported: false,
        requiresHumanApproval: context.eventCompletionCloseRequiresHumanApproval
      },
      resolution: {
        supported: true,
        sourceFamily: "credible_reporting",
        sourceLabel: "Credible reporting evaluator"
      },
      blockers: []
    };
  }

  if (!adapter && blockers.length === 0) {
    blockers.push({
      blockerCode: "unsupported_source_family",
      reason: "No Oracle lifecycle source adapter supports this market's official source family."
    });
  }

  const missingEnvVars = (adapter?.requiredEnvVars ?? []).filter((name) => !process.env[name]?.trim());

  if (adapter && missingEnvVars.length > 0 && blockers.length === 0) {
    blockers.push({
      blockerCode: "registered_no_credentials",
      reason: `Oracle has an adapter for this source family, but missing required env: ${missingEnvVars.join(", ")}.`
    });
  }

  const adapterCredentialed = missingEnvVars.length === 0;
  const closeSupported = Boolean(adapter?.capabilities.closeCondition) && adapterCredentialed;
  const resolutionSupported = Boolean(adapter?.capabilities.resolution) && adapterCredentialed;
  const adapterCloseCapable = Boolean(adapter?.capabilities.closeCondition);
  const adapterResolutionCapable = Boolean(adapter?.capabilities.resolution);
  const classification: OracleLifecycleCapabilityClassification =
    blockers.some((blocker) => blocker.blockerCode === "contract_incomplete")
      ? "contract_incomplete"
      : blockers.some((blocker) => blocker.blockerCode === "blocked_by_contract")
        ? "blocked_by_contract"
        : blockers.some((blocker) => blocker.blockerCode === "manual_resolution_required")
          ? "manual_resolution_required"
          : blockers.some((blocker) => blocker.blockerCode === "registered_no_credentials")
            ? "registered_no_credentials"
      : !adapter
        ? "unsupported_source_family"
        : adapterCloseCapable && adapterResolutionCapable
          ? "supported_close_and_resolution"
          : adapterCloseCapable
            ? "supported_close_only"
            : adapterResolutionCapable
              ? "supported_resolution_only"
              : "supported_scheduled_close_only";

  return {
    objectType: "oracle_lifecycle_capability",
    marketId: context.marketId,
    marketTitle: context.marketTitle,
    classification,
    close: {
      supported: closeSupported,
      sourceFamily: adapterCloseCapable ? adapter?.sourceFamily ?? null : null,
      sourceLabel: adapterCloseCapable ? adapter?.sourceLabel ?? null : null,
      scheduledCloseSupported: true,
      eventCompletionSupported: closeSupported && context.closeOnEventCompletion,
      requiresHumanApproval: context.eventCompletionCloseRequiresHumanApproval
    },
    resolution: {
      supported: resolutionSupported && missingEnvVars.length === 0,
      sourceFamily: adapterResolutionCapable ? adapter?.sourceFamily ?? null : null,
      sourceLabel: adapterResolutionCapable ? adapter?.sourceLabel ?? null : null
    },
    blockers
  };
}
