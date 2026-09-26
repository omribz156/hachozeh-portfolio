import { parseDecimalString } from "../../../shared/decimals";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../../../shared/zod-request-body";
import { PublishMarketServiceError } from "./errors";
import type { PublishMarketRequest } from "./types";

const createPublishRequestError = (message: string) =>
  new PublishMarketServiceError(400, "invalid_request", message);

export function parsePublishMarketRequest(body: unknown): PublishMarketRequest {
  const candidate = parseObjectBody(body, "Publish request body must be an object.", createPublishRequestError);

  const seedAmountInput = parseRequiredStringField(candidate, "seedAmount", createPublishRequestError);

  try {
    parseDecimalString(seedAmountInput, {
      fieldName: "seedAmount",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });
  } catch (error) {
    throw new PublishMarketServiceError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "seedAmount is invalid."
    );
  }

  return {
    publishAt: parseNullableStringField(candidate, "publishAt", createPublishRequestError),
    seedAmount: seedAmountInput,
    note: parseNullableStringField(candidate, "note", createPublishRequestError),
    reviewId: parseNullableStringField(candidate, "reviewId", createPublishRequestError),
    checklistVersion: parseNullableStringField(candidate, "checklistVersion", createPublishRequestError),
    managementApprovedAt: parseNullableStringField(candidate, "managementApprovedAt", createPublishRequestError),
    eventStartAt: parseNullableStringField(candidate, "eventStartAt", createPublishRequestError),
    eventCategory: parseNullableStringField(candidate, "eventCategory", createPublishRequestError),
    idempotencyKey: parseRequiredStringField(candidate, "idempotencyKey", createPublishRequestError)
  };
}
