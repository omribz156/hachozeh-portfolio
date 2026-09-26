import type { Queryable } from "../db/client/pool";
import { parseObjectBody } from "../shared/zod-request-body";

const NOTIFICATION_TYPES = ["moves", "resolve", "comments"] as const;
type NotificationType = (typeof NOTIFICATION_TYPES)[number];

type PreferenceKey =
  | "moves_app"
  | "moves_ext"
  | "resolve_app"
  | "resolve_ext"
  | "comments_app"
  | "comments_ext";

type PreferenceRow = {
  notification_type: NotificationType;
  channel_app: boolean;
  channel_external: boolean;
  updated_at: Date;
};

export type CurrentUserNotificationPreferencesResponse = {
  preferences: Record<PreferenceKey, boolean>;
  items: Array<{
    type: NotificationType;
    channelApp: boolean;
    channelExternal: boolean;
    updatedAt: string | null;
  }>;
};

export class CurrentUserNotificationPreferencesError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserNotificationPreferencesError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createPreferencesRequestError(message: string): CurrentUserNotificationPreferencesError {
  return new CurrentUserNotificationPreferencesError(400, "invalid_request", message);
}

function defaultFor(type: NotificationType): { channelApp: boolean; channelExternal: boolean } {
  // External (email/off-platform) channels are strictly opt-IN: they default OFF for every
  // notification type until the user explicitly enables them. This prevents un-consented
  // off-platform email the moment external dispatch is wired (anti-spam: Communications Law
  // Amendment 40). In-app delivery stays on by default.
  void type;
  return { channelApp: true, channelExternal: false };
}

function buildResponse(rows: PreferenceRow[]): CurrentUserNotificationPreferencesResponse {
  const byType = new Map(rows.map((row) => [row.notification_type, row]));
  const preferences = {} as Record<PreferenceKey, boolean>;
  const items = NOTIFICATION_TYPES.map((type) => {
    const row = byType.get(type);
    const fallback = defaultFor(type);
    const channelApp = row?.channel_app ?? fallback.channelApp;
    const channelExternal = row?.channel_external ?? fallback.channelExternal;
    preferences[`${type}_app` as PreferenceKey] = channelApp;
    preferences[`${type}_ext` as PreferenceKey] = channelExternal;

    return {
      type,
      channelApp,
      channelExternal,
      updatedAt: row?.updated_at?.toISOString() ?? null
    };
  });

  return { preferences, items };
}

export async function readCurrentUserNotificationPreferences(
  db: Queryable,
  userId: string
): Promise<CurrentUserNotificationPreferencesResponse> {
  const result = await db.query<PreferenceRow>(
    `
      select notification_type, channel_app, channel_external, updated_at
      from notification_preferences
      where user_id = $1
      order by notification_type asc
    `,
    [userId]
  );

  return buildResponse(result.rows);
}

function parseBooleanPatch(body: Record<string, unknown>): Map<NotificationType, Partial<{
  channelApp: boolean;
  channelExternal: boolean;
}>> {
  const patch = new Map<NotificationType, Partial<{ channelApp: boolean; channelExternal: boolean }>>();

  for (const type of NOTIFICATION_TYPES) {
    const appKey = `${type}_app`;
    const extKey = `${type}_ext`;
    const item = patch.get(type) ?? {};

    if (Object.prototype.hasOwnProperty.call(body, appKey)) {
      if (typeof body[appKey] !== "boolean") {
        throw createPreferencesRequestError(`${appKey} must be a boolean.`);
      }
      item.channelApp = body[appKey];
    }

    if (Object.prototype.hasOwnProperty.call(body, extKey)) {
      if (typeof body[extKey] !== "boolean") {
        throw createPreferencesRequestError(`${extKey} must be a boolean.`);
      }
      item.channelExternal = body[extKey];
    }

    if (Object.keys(item).length > 0) {
      patch.set(type, item);
    }
  }

  return patch;
}

export async function updateCurrentUserNotificationPreferences(
  db: Queryable,
  userId: string,
  body: unknown
): Promise<CurrentUserNotificationPreferencesResponse> {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createPreferencesRequestError
  );
  const patch = parseBooleanPatch(parsed);

  if (patch.size === 0) {
    throw createPreferencesRequestError("At least one notification preference is required.");
  }

  for (const type of NOTIFICATION_TYPES) {
    const item = patch.get(type);
    if (!item) continue;
    const fallback = defaultFor(type);

    await db.query(
      `
        insert into notification_preferences (
          user_id,
          notification_type,
          channel_app,
          channel_external,
          updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (user_id, notification_type)
        do update set
          channel_app = coalesce($5, notification_preferences.channel_app),
          channel_external = coalesce($6, notification_preferences.channel_external),
          updated_at = now()
      `,
      [
        userId,
        type,
        item.channelApp ?? fallback.channelApp,
        item.channelExternal ?? fallback.channelExternal,
        item.channelApp ?? null,
        item.channelExternal ?? null
      ]
    );
  }

  return readCurrentUserNotificationPreferences(db, userId);
}
