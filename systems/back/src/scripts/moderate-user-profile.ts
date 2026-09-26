import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { moderateUserProfile } from "../auth/user-profile-moderation-service";
import type { RequestActor } from "../auth/actor-resolver";

type ModerateUserProfileCliOptions = {
  userId: string | null;
  handle: string | null;
  reasonCode: string | null;
  actorId: string;
  resetDisplayName: boolean;
  clearBio: boolean;
  clearAvatar: boolean;
  execute: boolean;
  json: boolean;
};

function readFlagValue(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = argv.indexOf(`--${name}`);
  const next = index >= 0 ? argv[index + 1] : null;
  return next && !next.startsWith("--") ? next : null;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizeHandle(value: string | null): string | null {
  const trimmed = value?.trim().replace(/^@/, "").toLowerCase() ?? "";
  return trimmed || null;
}

export function parseModerateUserProfileArgs(argv: string[]): ModerateUserProfileCliOptions {
  return {
    userId: normalizeText(readFlagValue(argv, "user-id")),
    handle: normalizeHandle(readFlagValue(argv, "handle")),
    reasonCode: normalizeText(readFlagValue(argv, "reason-code") ?? readFlagValue(argv, "reason")),
    actorId: normalizeText(readFlagValue(argv, "actor-id")) ?? "operator_profile_moderation",
    resetDisplayName: argv.includes("--reset-display-name"),
    clearBio: argv.includes("--clear-bio"),
    clearAvatar: argv.includes("--clear-avatar"),
    execute: argv.includes("--execute"),
    json: argv.includes("--json")
  };
}

function validateOptions(options: ModerateUserProfileCliOptions): void {
  if (!options.userId && !options.handle) {
    throw new Error("Pass --user-id=<id> or --handle=<handle>.");
  }

  if (options.userId && options.handle) {
    throw new Error("Pass only one of --user-id or --handle.");
  }

  if (!options.reasonCode) {
    throw new Error("Pass --reason-code=<reason>.");
  }

  if (!options.resetDisplayName && !options.clearBio && !options.clearAvatar) {
    throw new Error("Pass at least one action: --reset-display-name, --clear-bio, --clear-avatar.");
  }
}

async function resolveTargetUserId(
  pool: ReturnType<typeof createDbPool>,
  options: ModerateUserProfileCliOptions
): Promise<string> {
  if (options.userId) {
    return options.userId;
  }

  const result = await pool.query<{ id: string }>(
    `
      select id
      from users
      where handle = lower($1)
      limit 1
    `,
    [options.handle]
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(`No user found for handle @${options.handle}.`);
  }

  return row.id;
}

function printPayload(payload: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload));
}

async function run(): Promise<void> {
  const options = parseModerateUserProfileArgs(process.argv.slice(2));
  validateOptions(options);

  const pool = createDbPool(loadAppEnv().db);
  try {
    const targetUserId = await resolveTargetUserId(pool, options);
    const request = {
      reasonCode: options.reasonCode,
      resetDisplayName: options.resetDisplayName,
      clearBio: options.clearBio,
      clearAvatar: options.clearAvatar
    };

    if (!options.execute) {
      printPayload({
        ok: true,
        dryRun: true,
        targetUserId,
        handle: options.handle,
        request,
        executeHint: "Add --execute to apply this profile moderation action."
      }, options.json);
      return;
    }

    const actor: RequestActor = {
      actorId: options.actorId,
      mode: "session",
      sessionId: null,
      role: "admin"
    };
    const result = await moderateUserProfile(pool, targetUserId, request, actor);
    printPayload({ ok: true, dryRun: false, result }, options.json);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
