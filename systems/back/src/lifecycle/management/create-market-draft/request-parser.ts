import { normalizeDecimal, parseDecimalString } from "../../../shared/decimals";
import { parseObjectBody } from "../../../shared/zod-request-body";
import { CreateMarketDraftServiceError } from "./errors";
import {
  readBoolean,
  readIsoTimestamp,
  readOptionalIdentifier,
  readTrimmedString
} from "./field-readers";
import { normalizeOracleSourcePolicy } from "./oracle-source-policy";
import type { CreateMarketDraftRequest } from "./types";

const LIQUIDITY_SCALE = 8;
const EVENT_RESOLUTION_POLICIES = new Set([
  "independent_children",
  "exclusive_first_hit"
]);
const MARKET_ENVIRONMENTS = new Set(["prod", "test"]);
const createDraftRequestError = (message: string) =>
  new CreateMarketDraftServiceError(400, "invalid_request", message);

function normalizeMarketContract(value: unknown): CreateMarketDraftRequest["marketContract"] {
  if (value == null) {
    return null;
  }

  const candidate = parseObjectBody(
    value,
    "marketContract must be a market_contract_v1 object.",
    createDraftRequestError
  );

  if (candidate.objectType !== "market_contract_v1") {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "marketContract.objectType must be market_contract_v1."
    );
  }

  return candidate as CreateMarketDraftRequest["marketContract"];
}

function normalizeEventResolutionPolicy(
  value: unknown
): CreateMarketDraftRequest["eventResolutionPolicy"] {
  const policy = readTrimmedString(value, "eventResolutionPolicy", {
    nullable: true
  });

  if (policy === null) {
    return null;
  }

  if (!EVENT_RESOLUTION_POLICIES.has(policy)) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "eventResolutionPolicy must be independent_children or exclusive_first_hit."
    );
  }

  return policy as CreateMarketDraftRequest["eventResolutionPolicy"];
}

function normalizeMarketEnvironment(value: unknown): CreateMarketDraftRequest["marketEnvironment"] {
  const environment = readTrimmedString(value, "marketEnvironment", {
    nullable: true
  });

  if (environment === null) {
    return "prod";
  }

  if (!MARKET_ENVIRONMENTS.has(environment)) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "marketEnvironment must be prod or test."
    );
  }

  return environment as CreateMarketDraftRequest["marketEnvironment"];
}

export function parseCreateMarketDraftRequest(body: unknown): CreateMarketDraftRequest {
  const candidate = parseObjectBody(
    body,
    "Create market request body must be an object.",
    createDraftRequestError
  );
  const openAt = readIsoTimestamp(candidate.openAt, "openAt");
  const closeAt = readIsoTimestamp(candidate.closeAt, "closeAt");

  if (new Date(closeAt).getTime() <= new Date(openAt).getTime()) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "closeAt must be after openAt."
    );
  }

  const liquidityBInput = readTrimmedString(candidate.liquidityB, "liquidityB")!;

  try {
    parseDecimalString(liquidityBInput, {
      fieldName: "liquidityB",
      allowNegative: false,
      allowZero: false,
      maxScale: LIQUIDITY_SCALE
    });
  } catch (error) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "liquidityB is invalid."
    );
  }

  const outcomesInput = candidate.outcomes;

  if (!Array.isArray(outcomesInput)) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "outcomes must be an array."
    );
  }

  if (outcomesInput.length < 2) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "outcomes must include at least two options."
    );
  }

  const outcomes = outcomesInput.map((entry, index) => {
    const outcome = parseObjectBody(
      entry,
      `outcomes[${index}] must be an object.`,
      createDraftRequestError
    );

    return {
      outcomeId: readOptionalIdentifier(outcome.outcomeId, `outcomes[${index}].outcomeId`),
      label: readTrimmedString(outcome.label, `outcomes[${index}].label`)!,
      shortLabel: readTrimmedString(outcome.shortLabel, `outcomes[${index}].shortLabel`, {
        nullable: true
      }),
      description: readTrimmedString(outcome.description, `outcomes[${index}].description`, {
        nullable: true
      }),
      colorKey: readTrimmedString(outcome.colorKey, `outcomes[${index}].colorKey`, {
        nullable: true
      })
    };
  });

  const normalizedLabels = new Set<string>();

  for (const [index, outcome] of outcomes.entries()) {
    const normalizedLabel = outcome.label.trim().toLowerCase();

    if (normalizedLabels.has(normalizedLabel)) {
      throw new CreateMarketDraftServiceError(
        400,
        "invalid_request",
        `outcomes[${index}].label must be unique within the market.`
      );
    }

    normalizedLabels.add(normalizedLabel);
  }

  const closeOnEventCompletion = readBoolean(
    candidate.closeOnEventCompletion,
    "closeOnEventCompletion"
  );
  const eventCompletionCloseRequiresHumanApproval = readBoolean(
    candidate.eventCompletionCloseRequiresHumanApproval,
    "eventCompletionCloseRequiresHumanApproval"
  );

  if (!closeOnEventCompletion && eventCompletionCloseRequiresHumanApproval) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      "eventCompletionCloseRequiresHumanApproval requires closeOnEventCompletion."
    );
  }

  return {
    marketId: readOptionalIdentifier(candidate.marketId, "marketId"),
    familyKey: readOptionalIdentifier(candidate.familyKey, "familyKey"),
    eventId: readOptionalIdentifier(candidate.eventId, "eventId"),
    eventSlug: readTrimmedString(candidate.eventSlug, "eventSlug", {
      nullable: true
    }),
    eventTitle: readTrimmedString(candidate.eventTitle, "eventTitle", {
      nullable: true
    }),
    eventDescription: readTrimmedString(candidate.eventDescription, "eventDescription", {
      nullable: true
    }),
    eventIcon: readTrimmedString(candidate.eventIcon, "eventIcon", {
      nullable: true
    }),
    eventResolutionPolicy: normalizeEventResolutionPolicy(candidate.eventResolutionPolicy),
    eventChildLabel: readTrimmedString(candidate.eventChildLabel, "eventChildLabel", {
      nullable: true
    }),
    eventShowGraph: readBoolean(candidate.eventShowGraph, "eventShowGraph"),
    eventShowParentInDiscovery: Object.prototype.hasOwnProperty.call(candidate, "eventShowParentInDiscovery")
      ? readBoolean(candidate.eventShowParentInDiscovery, "eventShowParentInDiscovery")
      : null,
    eventShowChildrenInDiscovery: Object.prototype.hasOwnProperty.call(candidate, "eventShowChildrenInDiscovery")
      ? readBoolean(candidate.eventShowChildrenInDiscovery, "eventShowChildrenInDiscovery")
      : null,
    marketEnvironment: normalizeMarketEnvironment(candidate.marketEnvironment),
    title: readTrimmedString(candidate.title, "title")!,
    description: readTrimmedString(candidate.description, "description", {
      nullable: true
    }),
    categoryKey: readOptionalIdentifier(candidate.categoryKey, "categoryKey"),
    openAt,
    closeAt,
    resolutionSource: readTrimmedString(candidate.resolutionSource, "resolutionSource")!,
    resolutionRules: readTrimmedString(candidate.resolutionRules, "resolutionRules")!,
    oracleSourcePolicy: normalizeOracleSourcePolicy(candidate.oracleSourcePolicy),
    marketContract: normalizeMarketContract(candidate.marketContract),
    liquidityB: normalizeDecimal(liquidityBInput, LIQUIDITY_SCALE),
    closeOnEventCompletion,
    eventCompletionCloseRequiresHumanApproval,
    outcomes,
    idempotencyKey: readTrimmedString(candidate.idempotencyKey, "idempotencyKey")!
  };
}
