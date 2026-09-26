import type { Queryable } from "../db/client/pool";
import { parseObjectBody } from "../shared/zod-request-body";

const SOCIAL_PLATFORMS = ["x", "telegram", "instagram", "website"] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

type SocialLinkRow = {
  platform: SocialPlatform;
  handle: string | null;
  url: string;
  verified_at: Date | null;
  updated_at: Date;
};

export type CurrentUserSocialLink = {
  platform: SocialPlatform;
  handle: string | null;
  url: string;
  verifiedAt: string | null;
  updatedAt: string;
};

export type CurrentUserSocialLinksResponse = {
  links: Record<SocialPlatform, CurrentUserSocialLink | null>;
  items: CurrentUserSocialLink[];
};

export class CurrentUserSocialLinksServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserSocialLinksServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createSocialLinksRequestError(message: string): CurrentUserSocialLinksServiceError {
  return new CurrentUserSocialLinksServiceError(400, "invalid_request", message);
}

function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

function rejectControlChars(value: string, fieldName: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw createSocialLinksRequestError(`${fieldName} cannot contain control characters.`);
  }
}

function normalizeHandle(value: unknown, platform: Exclude<SocialPlatform, "website">): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw createSocialLinksRequestError(`${platform} must be a string handle.`);
  }

  const normalized = value.trim().replace(/^@+/, "");
  if (!normalized) return null;
  rejectControlChars(normalized, platform);

  if (normalized.length > 40) {
    throw createSocialLinksRequestError(`${platform} handle must be 40 characters or fewer.`);
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
    throw createSocialLinksRequestError(`${platform} handle contains unsupported characters.`);
  }

  return normalized;
}

function normalizeWebsiteUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw createSocialLinksRequestError("website must be a URL string.");
  }

  const normalized = value.trim();
  if (!normalized) return null;
  rejectControlChars(normalized, "website");

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw createSocialLinksRequestError("website must be a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw createSocialLinksRequestError("website must use https.");
  }

  parsed.hash = "";
  const url = parsed.toString();
  if (url.length > 240) {
    throw createSocialLinksRequestError("website URL must be 240 characters or fewer.");
  }

  return url;
}

function buildPlatformUrl(platform: Exclude<SocialPlatform, "website">, handle: string): string {
  if (platform === "telegram") return `https://t.me/${handle}`;
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  return `https://x.com/${handle}`;
}

function mapRow(row: SocialLinkRow): CurrentUserSocialLink {
  return {
    platform: row.platform,
    handle: row.handle,
    url: row.url,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString()
  };
}

function emptyLinks(): Record<SocialPlatform, CurrentUserSocialLink | null> {
  return {
    x: null,
    telegram: null,
    instagram: null,
    website: null
  };
}

function buildResponse(rows: SocialLinkRow[]): CurrentUserSocialLinksResponse {
  const links = emptyLinks();
  const items = rows.map(mapRow);

  for (const item of items) {
    links[item.platform] = item;
  }

  return { links, items };
}

export async function readCurrentUserSocialLinks(
  db: Queryable,
  userId: string
): Promise<CurrentUserSocialLinksResponse> {
  const result = await db.query<SocialLinkRow>(
    `
      select platform, handle, url, verified_at, updated_at
      from user_social_links
      where user_id = $1
      order by platform asc
    `,
    [userId]
  );

  return buildResponse(result.rows);
}

type SocialPatch = {
  platform: SocialPlatform;
  handle: string | null;
  url: string | null;
};

function readPlatformValue(body: Record<string, unknown>, platform: SocialPlatform): unknown {
  if (Object.prototype.hasOwnProperty.call(body, platform)) {
    return body[platform];
  }

  const links = body["links"];
  if (typeof links === "object" && links !== null && !Array.isArray(links)) {
    return (links as Record<string, unknown>)[platform];
  }

  return undefined;
}

function parsePlatformPatch(body: Record<string, unknown>, platform: SocialPlatform): SocialPatch | null {
  const raw = readPlatformValue(body, platform);
  if (raw === undefined) return null;

  if (platform === "website") {
    return {
      platform,
      handle: null,
      url: normalizeWebsiteUrl(
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)["url"]
          : raw
      )
    };
  }

  const handle = normalizeHandle(
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)["handle"]
      : raw,
    platform
  );

  return {
    platform,
    handle,
    url: handle ? buildPlatformUrl(platform, handle) : null
  };
}

export async function updateCurrentUserSocialLinks(
  db: Queryable,
  userId: string,
  body: unknown
): Promise<CurrentUserSocialLinksResponse> {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createSocialLinksRequestError
  );

  const patches = SOCIAL_PLATFORMS.flatMap((platform) => {
    const patch = parsePlatformPatch(parsed, platform);
    return patch ? [patch] : [];
  });

  if (patches.length === 0) {
    throw createSocialLinksRequestError("At least one social link is required.");
  }

  for (const patch of patches) {
    if (!patch.url) {
      await db.query(
        `
          delete from user_social_links
          where user_id = $1
            and platform = $2
        `,
        [userId, patch.platform]
      );
      continue;
    }

    await db.query(
      `
        insert into user_social_links (
          user_id,
          platform,
          handle,
          url,
          verified_at,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, null, now(), now())
        on conflict (user_id, platform)
        do update set
          handle = excluded.handle,
          url = excluded.url,
          verified_at = null,
          updated_at = now()
      `,
      [userId, patch.platform, patch.handle, patch.url]
    );
  }

  return readCurrentUserSocialLinks(db, userId);
}

export async function deleteCurrentUserSocialLink(
  db: Queryable,
  userId: string,
  platform: string
): Promise<CurrentUserSocialLinksResponse> {
  if (!isSocialPlatform(platform)) {
    throw createSocialLinksRequestError("Unknown social link platform.");
  }

  await db.query(
    `
      delete from user_social_links
      where user_id = $1
        and platform = $2
    `,
    [userId, platform]
  );

  return readCurrentUserSocialLinks(db, userId);
}
