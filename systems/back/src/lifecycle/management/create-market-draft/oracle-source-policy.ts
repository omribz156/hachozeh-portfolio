import type { OracleSourcePolicy } from "../../../../../oracle/src/contracts";
import { parseObjectBody } from "../../../shared/zod-request-body";
import { CreateMarketDraftServiceError } from "./errors";
import { readBoolean, readOptionalStringArray } from "./field-readers";

const createOracleSourcePolicyError = (message: string) =>
  new CreateMarketDraftServiceError(400, "invalid_request", message);

export function normalizeOracleSourcePolicy(value: unknown): OracleSourcePolicy | null {
  if (value == null) {
    return null;
  }

  const candidate = parseObjectBody(
    value,
    "oracleSourcePolicy must be an object.",
    createOracleSourcePolicyError
  );
  const preferredSourceIds = readOptionalStringArray(
    candidate.preferredSourceIds,
    "oracleSourcePolicy.preferredSourceIds",
    {
      validateIdentifier: true
    }
  );
  const fallbackSourceIds = readOptionalStringArray(
    candidate.fallbackSourceIds,
    "oracleSourcePolicy.fallbackSourceIds",
    {
      validateIdentifier: true
    }
  );
  const contextSourceIds = readOptionalStringArray(
    candidate.contextSourceIds,
    "oracleSourcePolicy.contextSourceIds",
    {
      validateIdentifier: true
    }
  );
  const closeConditionSourceIds = readOptionalStringArray(
    candidate.closeConditionSourceIds,
    "oracleSourcePolicy.closeConditionSourceIds",
    {
      validateIdentifier: true
    }
  );
  const resolutionSourceIds = readOptionalStringArray(
    candidate.resolutionSourceIds,
    "oracleSourcePolicy.resolutionSourceIds",
    {
      validateIdentifier: true
    }
  );
  const notes = readOptionalStringArray(candidate.notes, "oracleSourcePolicy.notes");
  const requiresHumanReviewOnSourceConflict =
    candidate.requiresHumanReviewOnSourceConflict == null
      ? undefined
      : readBoolean(
          candidate.requiresHumanReviewOnSourceConflict,
          "oracleSourcePolicy.requiresHumanReviewOnSourceConflict"
        );
  const requiresHumanReviewOnWeakAuthority =
    candidate.requiresHumanReviewOnWeakAuthority == null
      ? undefined
      : readBoolean(
          candidate.requiresHumanReviewOnWeakAuthority,
          "oracleSourcePolicy.requiresHumanReviewOnWeakAuthority"
        );

  if (
    preferredSourceIds.length === 0 &&
    fallbackSourceIds.length === 0 &&
    contextSourceIds.length === 0 &&
    closeConditionSourceIds.length === 0 &&
    resolutionSourceIds.length === 0 &&
    notes.length === 0 &&
    requiresHumanReviewOnSourceConflict == null &&
    requiresHumanReviewOnWeakAuthority == null
  ) {
    return null;
  }

  return {
    ...(preferredSourceIds.length > 0 ? { preferredSourceIds } : {}),
    ...(fallbackSourceIds.length > 0 ? { fallbackSourceIds } : {}),
    ...(contextSourceIds.length > 0 ? { contextSourceIds } : {}),
    ...(closeConditionSourceIds.length > 0 ? { closeConditionSourceIds } : {}),
    ...(resolutionSourceIds.length > 0 ? { resolutionSourceIds } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(requiresHumanReviewOnSourceConflict != null
      ? { requiresHumanReviewOnSourceConflict }
      : {}),
    ...(requiresHumanReviewOnWeakAuthority != null
      ? { requiresHumanReviewOnWeakAuthority }
      : {})
  };
}
