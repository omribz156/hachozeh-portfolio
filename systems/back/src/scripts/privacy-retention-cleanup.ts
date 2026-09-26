import { resolve as resolvePath } from "node:path";

import { cleanupPrivacyRetention } from "../auth/privacy-retention-cleanup-service";
import type { PrivacyRetentionCleanupPolicy } from "../auth/privacy-retention-cleanup-service";
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

export type PrivacyRetentionCleanupCliOptions = {
  execute: boolean;
  json: boolean;
  policy: Partial<PrivacyRetentionCleanupPolicy>;
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

function readOptionalDaysArg(
  argv: string[],
  name: string
): number | undefined {
  const raw = readFlagValue(argv, name);
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be a positive integer day count.`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer day count.`);
  }

  return parsed;
}

export function parsePrivacyRetentionCleanupArgs(
  argv: string[]
): PrivacyRetentionCleanupCliOptions {
  return {
    execute: argv.includes("--execute"),
    json: argv.includes("--json"),
    policy: {
      otpExpiredDays: readOptionalDaysArg(argv, "otp-expired-days"),
      otpFinalizedDays: readOptionalDaysArg(argv, "otp-finalized-days"),
      sessionExpiredDays: readOptionalDaysArg(argv, "session-expired-days"),
      accountDeletionRequestDays: readOptionalDaysArg(argv, "account-deletion-request-days"),
      auditEventDays: readOptionalDaysArg(argv, "audit-event-days"),
      riskSignalDefaultDays: readOptionalDaysArg(argv, "risk-signal-default-days"),
      riskSignalReviewedDays: readOptionalDaysArg(argv, "risk-signal-reviewed-days"),
      feedbackClosedDays: readOptionalDaysArg(argv, "feedback-closed-days"),
      avatarOrphanDays: readOptionalDaysArg(argv, "avatar-orphan-days")
    }
  };
}

function formatTextReport(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export async function runPrivacyRetentionCleanupCli(
  options: PrivacyRetentionCleanupCliOptions
): Promise<unknown> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    return await cleanupPrivacyRetention(pool, {
      execute: options.execute,
      policy: options.policy
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parsePrivacyRetentionCleanupArgs(process.argv.slice(2));
  const result = await runPrivacyRetentionCleanupCli(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatTextReport(result));
}

if (process.argv[1] && resolvePath(process.argv[1]).endsWith("privacy-retention-cleanup.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
