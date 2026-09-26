export function normalizeEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();

  if (!normalized || !normalized.includes("@") || normalized.startsWith("@") || normalized.endsWith("@")) {
    throw new Error("identifier must be a valid email.");
  }

  return normalized;
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
