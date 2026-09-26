import { z } from "zod";

type RequestBodyErrorFactory = (message: string) => Error;

const JsonObjectSchema = z.custom<Record<string, unknown>>(
  (body) => typeof body === "object" && body !== null && !Array.isArray(body)
);
const RequiredStringSchema = z.string().trim().min(1);
const OptionalStringSchema = z.string().trim();
const OptionalNonNegativeIntegerSchema = z.number().int().nonnegative();

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
  const parsed = RequiredStringSchema.safeParse(body[fieldName]);

  if (!parsed.success) {
    throw createError(`${fieldName} is required.`);
  }

  return parsed.data;
}

export function parseOptionalStringField(
  body: Record<string, unknown>,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string | null {
  const value = body[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = OptionalStringSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} must be a string.`);
  }

  return parsed.data;
}

export function parseNullableStringField(
  body: Record<string, unknown>,
  fieldName: string,
  createError: RequestBodyErrorFactory
): string | null {
  const value = body[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = OptionalStringSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} must be a string.`);
  }

  return parsed.data || null;
}

export function parseOptionalNonNegativeIntegerField(
  body: Record<string, unknown>,
  fieldName: string,
  createError: RequestBodyErrorFactory
): number | null {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return null;
  }

  const parsed = OptionalNonNegativeIntegerSchema.safeParse(value);

  if (!parsed.success) {
    throw createError(`${fieldName} must be a non-negative integer.`);
  }

  return parsed.data;
}
