import { createHash } from "node:crypto";

const DEFAULT_PUBLIC_HASH_LENGTH = 8;
const RESERVED_PUBLIC_DISPLAY_NAMES = new Set([
  "admin",
  "administrator",
  "hachozeh",
  "moderator",
  "operator",
  "oracle",
  "seer",
  "support",
  "system",
  "the hachozeh",
  "החוזה",
  "מנהל",
  "מנהלת",
  "מערכת",
  "אורקל",
  "תמיכה"
]);

export function buildPublicUserHash(userId: string, length = DEFAULT_PUBLIC_HASH_LENGTH): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, length);
}

export function buildDefaultPublicHandle(userId: string): string {
  return `user_${buildPublicUserHash(userId)}`;
}

function readGeneratedHandleCode(handle: string | null | undefined): string | null {
  const normalized = handle?.trim().toLowerCase() ?? "";
  const match = /^user_([a-f0-9]{6,12})$/.exec(normalized);
  return match?.[1]?.toUpperCase() ?? null;
}

export function buildDefaultPublicDisplayName(userId: string, handle?: string | null): string {
  return `חזאי ${readGeneratedHandleCode(handle) ?? buildPublicUserHash(userId).toUpperCase()}`;
}

export function resolvePublicDisplayName(
  userId: string,
  displayName: string | null | undefined,
  handle?: string | null
): string {
  return displayName?.trim() || buildDefaultPublicDisplayName(userId, handle);
}

export function normalizeReservedPublicName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

export function isReservedPublicDisplayName(value: string): boolean {
  return RESERVED_PUBLIC_DISPLAY_NAMES.has(normalizeReservedPublicName(value));
}
