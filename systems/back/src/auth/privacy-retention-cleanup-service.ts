import { basename, resolve } from "node:path";

import type { Pool } from "pg";

import { listAvatars } from "./avatar-storage";
import type { Queryable } from "../db/client/pool";

const DAY_MS = 24 * 60 * 60 * 1000;
const AVATAR_PUBLIC_PREFIX = "/api/uploads/avatars/";
const DEFAULT_AVATAR_UPLOAD_DIR = resolve(process.cwd(), "workspace", "runtime", "uploads", "avatars");

export type PrivacyRetentionCleanupPolicy = {
  otpExpiredDays: number;
  otpFinalizedDays: number;
  sessionExpiredDays: number;
  accountDeletionRequestDays: number;
  auditEventDays: number;
  riskSignalDefaultDays: number;
  riskSignalReviewedDays: number;
  feedbackClosedDays: number;
  avatarOrphanDays: number;
};

export type PrivacyRetentionCleanupCounts = {
  otpExpiredDeleted: number;
  otpFinalizedDeleted: number;
  sessionsDeleted: number;
  accountDeletionRequestsDeleted: number;
  auditEventsDeleted: number;
  riskSignalsDeleted: number;
  feedbackDeleted: number;
  avatarOrphanFilesEligible: number;
  avatarOrphanFilesDeleted: number;
};

export type PrivacyRetentionCleanupResult = {
  objectType: "privacy_retention_cleanup";
  generatedAt: string;
  execute: boolean;
  policy: PrivacyRetentionCleanupPolicy;
  cutoffs: Record<keyof PrivacyRetentionCleanupPolicy, string>;
  counts: PrivacyRetentionCleanupCounts;
};

const DEFAULT_PRIVACY_RETENTION_CLEANUP_POLICY: PrivacyRetentionCleanupPolicy = {
  otpExpiredDays: 30,
  otpFinalizedDays: 90,
  sessionExpiredDays: 30,
  accountDeletionRequestDays: 365,
  auditEventDays: 730,
  riskSignalDefaultDays: 365,
  riskSignalReviewedDays: 730,
  feedbackClosedDays: 365,
  avatarOrphanDays: 7
};

function clampPositiveDays(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

export function normalizePrivacyRetentionCleanupPolicy(
  input?: Partial<PrivacyRetentionCleanupPolicy>
): PrivacyRetentionCleanupPolicy {
  const overrides = Object.fromEntries(
    Object.entries(input ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<PrivacyRetentionCleanupPolicy>;
  const merged = {
    ...DEFAULT_PRIVACY_RETENTION_CLEANUP_POLICY,
    ...overrides
  };

  return {
    otpExpiredDays: clampPositiveDays(merged.otpExpiredDays),
    otpFinalizedDays: clampPositiveDays(merged.otpFinalizedDays),
    sessionExpiredDays: clampPositiveDays(merged.sessionExpiredDays),
    accountDeletionRequestDays: clampPositiveDays(merged.accountDeletionRequestDays),
    auditEventDays: clampPositiveDays(merged.auditEventDays),
    riskSignalDefaultDays: clampPositiveDays(merged.riskSignalDefaultDays),
    riskSignalReviewedDays: clampPositiveDays(merged.riskSignalReviewedDays),
    feedbackClosedDays: clampPositiveDays(merged.feedbackClosedDays),
    avatarOrphanDays: clampPositiveDays(merged.avatarOrphanDays)
  };
}

function buildCutoffs(
  now: Date,
  policy: PrivacyRetentionCleanupPolicy
): Record<keyof PrivacyRetentionCleanupPolicy, Date> {
  return Object.fromEntries(
    Object.entries(policy).map(([key, days]) => [
      key,
      new Date(now.getTime() - days * DAY_MS)
    ])
  ) as Record<keyof PrivacyRetentionCleanupPolicy, Date>;
}

function serializeCutoffs(
  cutoffs: Record<keyof PrivacyRetentionCleanupPolicy, Date>
): Record<keyof PrivacyRetentionCleanupPolicy, string> {
  return Object.fromEntries(
    Object.entries(cutoffs).map(([key, value]) => [key, value.toISOString()])
  ) as Record<keyof PrivacyRetentionCleanupPolicy, string>;
}

function readCount(row: unknown): number {
  const count = (row as { count?: unknown } | undefined)?.count;
  if (typeof count === "number") return count;
  if (typeof count === "string") return Number.parseInt(count, 10) || 0;
  return 0;
}

async function countOrDelete(
  db: Queryable,
  input: {
    execute: boolean;
    countSql: string;
    deleteSql: string;
    values: unknown[];
  }
): Promise<number> {
  if (input.execute) {
    const result = await db.query(input.deleteSql, input.values);
    return Number(result.rowCount ?? 0);
  }

  const result = await db.query<{ count: string | number }>(input.countSql, input.values);
  return readCount(result.rows[0]);
}

async function cleanupOrphanAvatarFiles(input: {
  db: Queryable;
  cutoff: Date;
  avatarUploadDir: string;
}): Promise<number> {
  const referenced = await input.db.query<{ avatar_url: string | null }>(
    `
      select avatar_url
      from users
      where avatar_url like $1
    `,
    [`${AVATAR_PUBLIC_PREFIX}%`]
  );
  const referencedNames = new Set(
    referenced.rows
      .map((row) => row.avatar_url ? basename(row.avatar_url.slice(AVATAR_PUBLIC_PREFIX.length)) : "")
      .filter(Boolean)
  );

  // Reconcile against wherever avatars actually live (R2 in prod, local disk otherwise) via the
  // storage seam. An orphan is an object not referenced by any user that is also older than the
  // cutoff — the age grace avoids racing a just-uploaded object whose DB write is still in flight.
  const stored = await listAvatars({ localDir: input.avatarUploadDir });

  return stored.filter((item) =>
    !referencedNames.has(item.fileName) &&
    item.lastModified !== null &&
    item.lastModified.getTime() < input.cutoff.getTime()
  ).length;
}

export async function cleanupPrivacyRetention(
  db: Pool | Queryable,
  input?: {
    execute?: boolean;
    now?: Date;
    policy?: Partial<PrivacyRetentionCleanupPolicy>;
    avatarUploadDir?: string;
  }
): Promise<PrivacyRetentionCleanupResult> {
  const now = input?.now ?? new Date();
  const execute = input?.execute ?? false;
  const policy = normalizePrivacyRetentionCleanupPolicy(input?.policy);
  const cutoffs = buildCutoffs(now, policy);
  const counts: PrivacyRetentionCleanupCounts = {
    otpExpiredDeleted: 0,
    otpFinalizedDeleted: 0,
    sessionsDeleted: 0,
    accountDeletionRequestsDeleted: 0,
    auditEventsDeleted: 0,
    riskSignalsDeleted: 0,
    feedbackDeleted: 0,
    avatarOrphanFilesEligible: 0,
    avatarOrphanFilesDeleted: 0
  };

  counts.otpExpiredDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from otp_challenges
      where status in ('pending', 'expired')
        and expires_at < $1::timestamptz
    `,
    deleteSql: `
      delete from otp_challenges
      where status in ('pending', 'expired')
        and expires_at < $1::timestamptz
    `,
    values: [cutoffs.otpExpiredDays.toISOString()]
  });

  counts.otpFinalizedDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from otp_challenges
      where status in ('consumed', 'cancelled')
        and coalesce(consumed_at, updated_at) < $1::timestamptz
    `,
    deleteSql: `
      delete from otp_challenges
      where status in ('consumed', 'cancelled')
        and coalesce(consumed_at, updated_at) < $1::timestamptz
    `,
    values: [cutoffs.otpFinalizedDays.toISOString()]
  });

  counts.sessionsDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from sessions
      where expires_at < $1::timestamptz
         or (
          status in ('revoked', 'expired')
          and coalesce(revoked_at, expires_at) < $1::timestamptz
        )
    `,
    deleteSql: `
      delete from sessions
      where expires_at < $1::timestamptz
         or (
          status in ('revoked', 'expired')
          and coalesce(revoked_at, expires_at) < $1::timestamptz
        )
    `,
    values: [cutoffs.sessionExpiredDays.toISOString()]
  });

  counts.accountDeletionRequestsDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from account_deletion_requests
      where status in ('cancelled', 'completed')
        and coalesce(completed_at, cancelled_at, updated_at) < $1::timestamptz
    `,
    deleteSql: `
      delete from account_deletion_requests
      where status in ('cancelled', 'completed')
        and coalesce(completed_at, cancelled_at, updated_at) < $1::timestamptz
    `,
    values: [cutoffs.accountDeletionRequestDays.toISOString()]
  });

  counts.riskSignalsDeleted += await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from audit_events
      where action = 'risk.signal.recorded'
        and coalesce(payload->>'severity', 'observe') not in ('review', 'block')
        and created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from audit_events
      where action = 'risk.signal.recorded'
        and coalesce(payload->>'severity', 'observe') not in ('review', 'block')
        and created_at < $1::timestamptz
    `,
    values: [cutoffs.riskSignalDefaultDays.toISOString()]
  });

  counts.riskSignalsDeleted += await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from audit_events
      where action = 'risk.signal.recorded'
        and coalesce(payload->>'severity', 'observe') in ('review', 'block')
        and created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from audit_events
      where action = 'risk.signal.recorded'
        and coalesce(payload->>'severity', 'observe') in ('review', 'block')
        and created_at < $1::timestamptz
    `,
    values: [cutoffs.riskSignalReviewedDays.toISOString()]
  });

  counts.auditEventsDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from audit_events
      where action <> 'risk.signal.recorded'
        and created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from audit_events
      where action <> 'risk.signal.recorded'
        and created_at < $1::timestamptz
    `,
    values: [cutoffs.auditEventDays.toISOString()]
  });

  counts.feedbackDeleted = await countOrDelete(db, {
    execute,
    countSql: `
      select count(*)::int as count
      from feedback
      where status = 'closed'
        and updated_at < $1::timestamptz
    `,
    deleteSql: `
      delete from feedback
      where status = 'closed'
        and updated_at < $1::timestamptz
    `,
    values: [cutoffs.feedbackClosedDays.toISOString()]
  });

  // Object deletion is intentionally not part of the unattended privacy worker. Avatar keys are
  // immutable and small; report orphan candidates here, then remove them only through a reviewed
  // repair flow that first proves no database reference points at the object set.
  counts.avatarOrphanFilesEligible = await cleanupOrphanAvatarFiles({
    db,
    cutoff: cutoffs.avatarOrphanDays,
    avatarUploadDir: input?.avatarUploadDir ?? DEFAULT_AVATAR_UPLOAD_DIR
  });

  return {
    objectType: "privacy_retention_cleanup",
    generatedAt: now.toISOString(),
    execute,
    policy,
    cutoffs: serializeCutoffs(cutoffs),
    counts
  };
}
