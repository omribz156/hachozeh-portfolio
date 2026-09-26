import type { OracleSourcePolicy } from "../../../../../oracle/src/contracts";

export type MarketContractV1Snapshot = {
  objectType: "market_contract_v1";
  [key: string]: unknown;
};

export type EventResolutionPolicy = "independent_children" | "exclusive_first_hit";

export type MarketEnvironment = "prod" | "test";

export type DraftOutcomeInput = {
  outcomeId: string | null;
  label: string;
  shortLabel: string | null;
  description: string | null;
  colorKey: string | null;
};

export type ResolvedDraftOutcomeInput = DraftOutcomeInput & {
  outcomeId: string;
};

export type CreateMarketDraftRequest = {
  marketId: string | null;
  familyKey: string | null;
  eventId: string | null;
  eventSlug?: string | null;
  eventTitle: string | null;
  eventDescription: string | null;
  eventIcon: string | null;
  eventResolutionPolicy?: EventResolutionPolicy | null;
  eventChildLabel?: string | null;
  // Operator display flag stored on events.display_flags.showGraph — render the
  // multi-line probability chart in the event detail view. Default false.
  eventShowGraph?: boolean | null;
  // Discovery display flags stored on events.display_flags. Defaults are
  // parent visible, children collapsed.
  eventShowParentInDiscovery?: boolean | null;
  eventShowChildrenInDiscovery?: boolean | null;
  marketEnvironment?: MarketEnvironment;
  title: string;
  description: string | null;
  categoryKey: string | null;
  openAt: string;
  closeAt: string;
  resolutionSource: string;
  resolutionRules: string;
  oracleSourcePolicy: OracleSourcePolicy | null;
  marketContract: MarketContractV1Snapshot | null;
  liquidityB: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  outcomes: DraftOutcomeInput[];
  idempotencyKey: string;
};

export type CreateMarketDraftResponse = {
  marketId: string;
  eventId: string;
  eventSlug: string;
  status: "draft";
  createdAt: string;
  openAt: string;
  closeAt: string;
  outcomeIds: string[];
  auditEventId: string;
};
