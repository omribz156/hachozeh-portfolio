import { OracleReviewActionError } from "./review-action-errors";
import type { OracleCaseReviewAction } from "./review-action-records";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "./zod-request-body";

export type ReviewOracleCaseRequest = {
  reviewNote?: string | null;
  idempotencyKey: string;
};

export type ExecuteOracleReviewActionRequest = ReviewOracleCaseRequest & {
  caseId: string;
  action: OracleCaseReviewAction;
};

export type ApproveOracleResolutionCaseRequest = ReviewOracleCaseRequest;
export type ApproveOracleCloseConditionCaseRequest = ReviewOracleCaseRequest;

const createReviewActionRequestError = (message: string) =>
  new OracleReviewActionError(400, "invalid_request", message);

export function parseExecuteOracleReviewActionRequest(
  body: unknown
): ExecuteOracleReviewActionRequest {
  const candidate = parseObjectBody(
    body,
    "Review action body must be an object.",
    createReviewActionRequestError
  );

  const action = parseRequiredStringField(candidate, "action", createReviewActionRequestError);

  if (
    action !== "approve_resolution" &&
    action !== "approve_close_condition" &&
    action !== "reject_case" &&
    action !== "request_more_evidence"
  ) {
    throw new OracleReviewActionError(400, "invalid_request", "action is invalid.");
  }

  return {
    caseId: parseRequiredStringField(candidate, "caseId", createReviewActionRequestError),
    action,
    reviewNote: parseNullableStringField(candidate, "reviewNote", createReviewActionRequestError),
    idempotencyKey: parseRequiredStringField(candidate, "idempotencyKey", createReviewActionRequestError)
  };
}
