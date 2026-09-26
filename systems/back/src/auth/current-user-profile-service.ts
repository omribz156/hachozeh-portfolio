import type { Queryable } from "../db/client/pool";
import { containsBlockedTerm } from "../shared/display-name-guard";
import {
  buildDefaultPublicDisplayName,
  isReservedPublicDisplayName,
  resolvePublicDisplayName
} from "../shared/public-user-identity";
import {
  parseNullableStringField,
  parseObjectBody
} from "../shared/zod-request-body";

type CurrentUserProfileRow = {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  showcase_categories: string[];
  updated_at: Date;
};

type CurrentUserDisplayIdentityRow = {
  id: string;
  handle: string;
  display_name: string | null;
  handle_updated_at: Date | null;
};

export type CurrentUserProfileResponse = {
  user: {
    userId: string;
    handle: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    showcaseCategories?: string[];
    updatedAt: string;
  };
};

export type CurrentUserHandleAvailabilityResponse = {
  handle: string;
  available: boolean;
  reason: "available" | "current" | "taken";
};

export class CurrentUserProfileServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserProfileServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createProfileRequestError(message: string): CurrentUserProfileServiceError {
  return new CurrentUserProfileServiceError(400, "invalid_request", message);
}

function createNameNotAllowedError(): CurrentUserProfileServiceError {
  // Deliberately vague: never echo the offending word/term back to the
  // caller, so the response can't be used to probe the blocklist contents.
  return new CurrentUserProfileServiceError(400, "name_not_allowed", "displayName is not allowed.");
}

function rejectControlChars(value: string, fieldName: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 31 && code !== 127) continue;
    throw createProfileRequestError(`${fieldName} cannot contain control characters.`);
  }
}

function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  rejectControlChars(normalized, "displayName");
  if (normalized.length > 40) {
    throw createProfileRequestError("displayName must be 40 characters or fewer.");
  }
  if (isReservedPublicDisplayName(normalized)) {
    throw createProfileRequestError("displayName is reserved.");
  }
  if (containsBlockedTerm(normalized)) {
    throw createNameNotAllowedError();
  }
  return normalized;
}

// Shared entry point for both call sites that accept a user-chosen display
// name (name-change via PATCH /api/me/profile, and any future signup flow
// that lets a user set a display name at account-creation time). Both must
// route through this function rather than re-implementing checks, so the
// blocklist enforcement in name-blocklist.ts / display-name-guard.ts can
// never be bypassed by a second code path.
export function validateDisplayName(value: string | null): string | null {
  return normalizeDisplayName(value);
}

function normalizeBio(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;
  rejectControlChars(normalized.replace(/\n/g, ""), "bio");
  if (normalized.length > 100) {
    throw createProfileRequestError("bio must be 100 characters or fewer.");
  }
  return normalized;
}

export const RESERVED_HANDLES = new Set([
  "404",
  "about",
  "accessibility",
  "admin",
  "admin-market-management",
  "api",
  "achievements",
  "auth",
  "breaking",
  "breaking-markets",
  "closing-markets",
  "community",
  "cookies",
  "deposit",
  "event",
  "explore",
  "fallback",
  "feeds",
  "fragments",
  "graphs-and-accuracy",
  "hachozeh",
  "help",
  "leaderboard",
  "login",
  "logout",
  "llms",
  "llms-full",
  "market-detail",
  "markets",
  "me",
  "moderator",
  "new",
  "new-markets",
  "notifications",
  "operator",
  "oracle",
  "portfolio",
  "pitch",
  "privacy",
  "profile",
  "qanda",
  "quickbuy",
  "register",
  "robots",
  "search",
  "seer",
  "series",
  "settings",
  "share",
  "signup",
  "sitemap",
  "sitemaps",
  "status",
  "start",
  "support",
  "system",
  "terms",
  "t",
  "topics",
  "traders",
  "trending",
  "u",
  "wallet"
]);

function normalizeHandle(value: string | null): string {
  if (value === null) {
    throw createProfileRequestError("handle is required.");
  }

  const normalized = value.replace(/^@/, "").trim().toLowerCase();
  rejectControlChars(normalized, "handle");

  if (normalized.length < 3 || normalized.length > 24) {
    throw createProfileRequestError("handle must be between 3 and 24 characters.");
  }

  if (!/^[a-z0-9][a-z0-9_.]*[a-z0-9]$/.test(normalized)) {
    throw createProfileRequestError("handle can use lowercase letters, numbers, dots, and underscores.");
  }

  if (RESERVED_HANDLES.has(normalized)) {
    throw createProfileRequestError("handle is reserved.");
  }

  return normalized;
}

function normalizeShowcaseCategoriesInput(value: unknown): string[] {
  if (value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createProfileRequestError("showcaseCategories must be an array of strings or null.");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw createProfileRequestError("showcaseCategories must contain only strings.");
    }

    const categoryKey = item.trim();
    if (!categoryKey || seen.has(categoryKey)) {
      continue;
    }

    rejectControlChars(categoryKey, "showcaseCategories");
    normalized.push(categoryKey);
    seen.add(categoryKey);

    if (normalized.length >= 4) {
      break;
    }
  }

  return normalized;
}

async function readResolvedCategoryKeys(db: Queryable, userId: string): Promise<Set<string>> {
  const result = await db.query<{ category_key: string }>(
    `
      select distinct coalesce(m.category_key, 'uncategorized') as category_key
      from realization_events re
      join markets m
        on m.id = re.market_id
       and m.status = 'resolved'
      where re.user_id = $1
        and re.type in ('resolution_win', 'resolution_loss')
    `,
    [userId]
  );

  return new Set(result.rows.map((row) => row.category_key));
}

async function normalizeShowcaseCategoriesForUser(
  db: Queryable,
  userId: string,
  value: unknown
): Promise<string[]> {
  const requested = normalizeShowcaseCategoriesInput(value);
  if (requested.length === 0) {
    return [];
  }

  const allowed = await readResolvedCategoryKeys(db, userId);
  return requested.filter((categoryKey) => allowed.has(categoryKey));
}

function mapProfileRow(row: CurrentUserProfileRow): CurrentUserProfileResponse {
  return {
    user: {
      userId: row.id,
      handle: row.handle,
      displayName: resolvePublicDisplayName(row.id, row.display_name, row.handle),
      bio: row.bio,
      avatarUrl: row.avatar_url,
      showcaseCategories: row.showcase_categories ?? [],
      updatedAt: row.updated_at.toISOString()
    }
  };
}

function shouldMirrorHandleToDisplayName(row: CurrentUserDisplayIdentityRow): boolean {
  const stored = row.display_name?.trim() ?? "";
  if (!stored) return true;
  return stored === buildDefaultPublicDisplayName(row.id, row.handle);
}

function isWithinHandleChangeCooldown(value: Date | null): boolean {
  if (!value) return false;
  const cooldownMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - value.valueOf() < cooldownMs;
}

export async function readCurrentUserHandleAvailability(
  db: Queryable,
  userId: string,
  handleInput: string | null
): Promise<CurrentUserHandleAvailabilityResponse> {
  const handle = normalizeHandle(handleInput);
  const result = await db.query<{ id: string }>(
    `
      select id
      from users
      where handle = $1
      limit 1
    `,
    [handle]
  );
  const ownerId = result.rows[0]?.id ?? null;

  if (!ownerId) {
    return {
      handle,
      available: true,
      reason: "available"
    };
  }

  if (ownerId === userId) {
    return {
      handle,
      available: true,
      reason: "current"
    };
  }

  return {
    handle,
    available: false,
    reason: "taken"
  };
}

export async function updateCurrentUserProfile(
  db: Queryable,
  userId: string,
  body: unknown
): Promise<CurrentUserProfileResponse> {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createProfileRequestError
  );

  const hasDisplayName = Object.prototype.hasOwnProperty.call(parsed, "displayName");
  const hasBio = Object.prototype.hasOwnProperty.call(parsed, "bio");
  const hasHandle = Object.prototype.hasOwnProperty.call(parsed, "handle");
  const hasShowcaseCategories = Object.prototype.hasOwnProperty.call(parsed, "showcaseCategories");

  if (!hasDisplayName && !hasBio && !hasHandle && !hasShowcaseCategories) {
    throw createProfileRequestError("At least one profile field is required.");
  }

  const displayName = hasDisplayName
    ? normalizeDisplayName(parseNullableStringField(parsed, "displayName", createProfileRequestError))
    : undefined;
  const bio = hasBio
    ? normalizeBio(parseNullableStringField(parsed, "bio", createProfileRequestError))
    : undefined;
  const handle = hasHandle
    ? normalizeHandle(parseNullableStringField(parsed, "handle", createProfileRequestError))
    : undefined;
  const showcaseCategories = hasShowcaseCategories
    ? await normalizeShowcaseCategoriesForUser(db, userId, parsed.showcaseCategories)
    : undefined;

  let effectiveDisplayName = displayName;
  let effectiveHasDisplayName = hasDisplayName;

  if (hasHandle) {
    const currentIdentity = await db.query<CurrentUserDisplayIdentityRow>(
      `
        select id, handle, display_name, handle_updated_at
        from users
        where id = $1
          and status = 'active'
        limit 1
      `,
      [userId]
    );
    const currentRow = currentIdentity.rows[0];
    const handleWillChange = Boolean(currentRow && handle && currentRow.handle !== handle);
    if (handleWillChange && currentRow && isWithinHandleChangeCooldown(currentRow.handle_updated_at)) {
      throw new CurrentUserProfileServiceError(
        409,
        "handle_change_cooldown",
        "handle can be changed once every 30 days."
      );
    }
    if (handleWillChange && !hasDisplayName && currentRow && shouldMirrorHandleToDisplayName(currentRow)) {
      effectiveDisplayName = handle;
      effectiveHasDisplayName = true;
    }
  }

  let result;
  try {
    result = await db.query<CurrentUserProfileRow>(
      `
        update users
        set
          display_name = case when $6 then $2 else display_name end,
          bio = case when $7 then $3 else bio end,
          handle = case when $8 then $4 else handle end,
          handle_updated_at = case when $8 and handle <> $4 then now() else handle_updated_at end,
          showcase_categories = case when $9 then $5::text[] else showcase_categories end,
          updated_at = now()
        where id = $1
          and status = 'active'
        returning id, handle, display_name, bio, avatar_url, showcase_categories, updated_at
      `,
      [
        userId,
        effectiveDisplayName ?? null,
        bio ?? null,
        handle ?? null,
        showcaseCategories ?? [],
        effectiveHasDisplayName,
        hasBio,
        hasHandle,
        hasShowcaseCategories
      ]
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new CurrentUserProfileServiceError(409, "handle_taken", "handle is already taken.");
    }
    throw error;
  }

  const row = result.rows[0];
  if (!row) {
    throw new CurrentUserProfileServiceError(404, "user_not_found", "Current user was not found.");
  }

  return mapProfileRow(row);
}
