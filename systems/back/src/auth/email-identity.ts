import { z } from "zod";
import { AuthSessionError } from "./session/errors";

const SingleEmailSchema = z.email().max(254);

export function normalizeEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();

  if (!SingleEmailSchema.safeParse(normalized).success || normalized.split("@")[0].length > 64) {
    throw new Error("identifier must be a valid email.");
  }

  return normalized;
}

export function assertAllowedAuthEmail(identifier: string): void {
  if (!SingleEmailSchema.safeParse(identifier).success || identifier.split("@")[1]?.toLowerCase() !== "gmail.com") {
    throw new AuthSessionError(403, "email_domain_not_allowed", "Sign-in requires a gmail.com address.");
  }
}

export function maskEmail(identifier: string): string {
  const [localPart, domainPart] = identifier.split("@");

  if (!localPart || !domainPart) {
    return identifier;
  }

  const safeLocal =
    localPart.length <= 2
      ? `${localPart[0] ?? "*"}*`
      : `${localPart.slice(0, 2)}***`;
  const [domainName, ...rest] = domainPart.split(".");
  const safeDomain = domainName.length <= 1 ? "*" : `${domainName[0]}***`;
  const safeSuffix = rest.length ? `.${rest.join(".")}` : "";

  return `${safeLocal}@${safeDomain}${safeSuffix}`;
}
