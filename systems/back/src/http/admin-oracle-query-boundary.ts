import { z } from "zod";

import type { ReadOracleAlertsOptions } from "../../../oracle/src/oracle-alerts-service";
import type { ReadOracleReviewQueueOptions } from "../../../oracle/src/review-queue-service";
import { resolveMarketIdFromInput } from "../../../oracle/src/inspect-market-service";

export class AdminOracleQueryError extends Error {
  readonly statusCode = 400;
  readonly code = "invalid_request";

  constructor(message: string) {
    super(message);
    this.name = "AdminOracleQueryError";
  }
}

const OracleReviewQueueCaseStatusSchema = z.enum([
  "review_needed",
  "recommended",
  "no_action",
  "all"
]);
const OracleCaseTypeQuerySchema = z.enum([
  "close_condition_check",
  "resolution_check"
]);
const OracleAlertsMarketStatusSchema = z.enum([
  "open",
  "closed",
  "all"
]);
const PositiveIntegerQuerySchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value) && value > 0);
const PositiveNumberQuerySchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0);

function readOptionalQueryParam(searchParams: URLSearchParams, name: string): string | undefined {
  const value = searchParams.get(name);
  return value == null ? undefined : value.trim();
}

function parseOptionalQueryValue<T>(
  schema: z.ZodType<T>,
  value: string | undefined,
  message: string
): T | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AdminOracleQueryError(message);
  }

  return parsed.data;
}

export function readOracleReviewQueueQuery(
  searchParams: URLSearchParams
): ReadOracleReviewQueueOptions {
  const market = readOptionalQueryParam(searchParams, "market");

  return {
    caseStatus:
      parseOptionalQueryValue(
        OracleReviewQueueCaseStatusSchema,
        readOptionalQueryParam(searchParams, "caseStatus"),
        "caseStatus must be one of: review_needed, recommended, no_action, all."
      ) ?? "review_needed",
    caseType: parseOptionalQueryValue(
      OracleCaseTypeQuerySchema,
      readOptionalQueryParam(searchParams, "caseType"),
      "caseType must be one of: close_condition_check, resolution_check."
    ),
    marketId: market ? resolveMarketIdFromInput(market) : undefined,
    limit: parseOptionalQueryValue(
      PositiveIntegerQuerySchema,
      readOptionalQueryParam(searchParams, "limit"),
      "limit must be a positive integer."
    )
  };
}

export function readOracleAlertsQuery(searchParams: URLSearchParams): ReadOracleAlertsOptions {
  return {
    marketStatus:
      parseOptionalQueryValue(
        OracleAlertsMarketStatusSchema,
        readOptionalQueryParam(searchParams, "marketStatus"),
        "marketStatus must be one of: open, closed, all."
      ) ?? "all",
    reviewStaleHours: parseOptionalQueryValue(
      PositiveNumberQuerySchema,
      readOptionalQueryParam(searchParams, "reviewStaleHours"),
      "reviewStaleHours must be a positive number."
    ),
    recommendedStaleHours: parseOptionalQueryValue(
      PositiveNumberQuerySchema,
      readOptionalQueryParam(searchParams, "recommendedStaleHours"),
      "recommendedStaleHours must be a positive number."
    ),
    closedResolutionGraceHours: parseOptionalQueryValue(
      PositiveNumberQuerySchema,
      readOptionalQueryParam(searchParams, "closedResolutionGraceHours"),
      "closedResolutionGraceHours must be a positive number."
    ),
    precloseFetchGapHours: parseOptionalQueryValue(
      PositiveNumberQuerySchema,
      readOptionalQueryParam(searchParams, "precloseFetchGapHours"),
      "precloseFetchGapHours must be a positive number."
    ),
    persistSnapshot: true
  };
}
