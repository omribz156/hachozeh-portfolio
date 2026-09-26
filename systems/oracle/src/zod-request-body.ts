import { z } from "zod";

type RequestBodyErrorFactory = (message: string) => Error;

const JsonObjectSchema = z.custom<Record<string, unknown>>(
  (body) => typeof body === "object" && body !== null && !Array.isArray(body)
);
const RequiredStringSchema = z.string().trim().min(1);
const NullableStringSchema = z.string().trim();
const OptionalBooleanSchema = z.boolean();
const UnknownArraySchema = z.array(z.unknown());

export function parseObjectBody(
  body: unknown,
  message: string,
  createError: RequestBodyErrorFactory
): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(body);

  if (!parsed.success) {
    throw createError(message);
  }

  return parsed.data;
}

export function parseRequiredStringField(
  body: Record<string, unknown>,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string {
  return parseRequiredStringValue(body[fieldName], fieldName, createError);
}

export function parseRequiredStringValue(
  value: unknown,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string {
  if (typeof value !== "string") {
    throw createError(
      value == null ? `${fieldName} is required.` : `${fieldName} must be a string.`
    );
  }

  const parsed = RequiredStringSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} is required.`);
  }

  return parsed.data;
}

export function parseNullableStringField(
  body: Record<string, unknown>,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string | null {
  return parseNullableStringValue(body[fieldName], fieldName, createError);
}

export function parseNullableStringValue(
  value: unknown,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = NullableStringSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} must be a string.`);
  }

  return parsed.data || null;
}

export function parseHttpsUrlValue(
  value: unknown,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string {
  const parsed = parseRequiredStringValue(value, fieldName, createError);

  try {
    const url = new URL(parsed);
    if (url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // fall through to shared error below
  }

  throw createError(`${fieldName} must be an HTTPS URL.`);
}

export function parseOptionalBooleanValue(
  value: unknown,
  fieldName: string,
  createError: RequestBodyErrorFactory
): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = OptionalBooleanSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} must be a boolean when provided.`);
  }

  return parsed.data;
}

export function parseArrayOrEmptyValue(value: unknown): unknown[] {
  const parsed = UnknownArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
