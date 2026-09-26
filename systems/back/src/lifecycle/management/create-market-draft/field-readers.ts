import { z } from "zod";

import { CreateMarketDraftServiceError } from "./errors";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_REFERENCE_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;
const StringSchema = z.string();
const BooleanSchema = z.boolean();
const ArraySchema = z.array(z.unknown());

export function readTrimmedString(
  value: unknown,
  fieldName: string,
  options?: {
    nullable?: boolean;
  }
): string | null {
  if (value == null) {
    if (options?.nullable) {
      return null;
    }

    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} is required.`
    );
  }

  const parsed = StringSchema.safeParse(value);

  if (!parsed.success) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} must be a string.`
    );
  }

  const trimmed = parsed.data.trim();

  if (!trimmed) {
    if (options?.nullable) {
      return null;
    }

    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} is required.`
    );
  }

  return trimmed;
}

export function readOptionalIdentifier(value: unknown, fieldName: string): string | null {
  const identifier = readTrimmedString(value, fieldName, {
    nullable: true
  });

  if (identifier === null) {
    return null;
  }

  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} must use lowercase letters, numbers, and hyphens only.`
    );
  }

  return identifier;
}

export function readBoolean(value: unknown, fieldName: string): boolean {
  if (value == null) {
    return false;
  }

  const parsed = BooleanSchema.safeParse(value);

  if (!parsed.success) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} must be a boolean.`
    );
  }

  return parsed.data;
}

export function readOptionalStringArray(
  value: unknown,
  fieldName: string,
  options?: {
    validateIdentifier?: boolean;
  }
): string[] {
  if (value == null) {
    return [];
  }

  const parsed = ArraySchema.safeParse(value);

  if (!parsed.success) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} must be an array.`
    );
  }

  return parsed.data.map((entry, index) => {
    const trimmed = readTrimmedString(entry, `${fieldName}[${index}]`)!;

    if (options?.validateIdentifier && !SOURCE_REFERENCE_PATTERN.test(trimmed)) {
      throw new CreateMarketDraftServiceError(
        400,
        "invalid_request",
        `${fieldName}[${index}] must use lowercase letters, numbers, underscores, and hyphens only.`
      );
    }

    return trimmed;
  });
}

export function readIsoTimestamp(value: unknown, fieldName: string): string {
  const raw = readTrimmedString(value, fieldName)!;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new CreateMarketDraftServiceError(
      400,
      "invalid_request",
      `${fieldName} must be a valid ISO timestamp.`
    );
  }

  return parsed.toISOString();
}
