import { resolve as resolvePath } from "node:path";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import {
  completeAccountDeletionErasure,
  listPendingAccountDeletionRequests,
  previewAccountDeletionErasure,
  sweepDueAccountDeletionErasures
} from "../auth/account-deletion-erasure-service";

export type AccountDeletionErasureCliOptions = {
  execute: boolean;
  json: boolean;
  limit: number;
  requestId: string | null;
  actorId: string;
  pending: boolean;
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

function readPositiveIntegerArg(
  argv: string[],
  name: string,
  fallback: number
): number {
  const raw = readFlagValue(argv, name);

  if (raw === null) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}

export function parseAccountDeletionErasureArgs(
  argv: string[]
): AccountDeletionErasureCliOptions {
  const pending = argv.includes("--pending");
  const execute = argv.includes("--execute");
  const requestId = readFlagValue(argv, "request-id")?.trim() || null;

  if (pending && execute) {
    throw new Error("--pending is read-only and cannot be combined with --execute.");
  }

  if (pending && requestId) {
    throw new Error("--pending cannot be combined with --request-id.");
  }

  return {
    execute,
    json: argv.includes("--json"),
    limit: Math.min(readPositiveIntegerArg(argv, "limit", 50), 500),
    requestId,
    actorId: readFlagValue(argv, "actor-id")?.trim() || "system:privacy-erasure",
    pending
  };
}

function formatTextReport(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export async function runAccountDeletionErasureCli(
  options: AccountDeletionErasureCliOptions
): Promise<unknown> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    if (options.pending) {
      return await listPendingAccountDeletionRequests(pool, {
        limit: options.limit
      });
    }

    if (options.requestId && options.execute) {
      return await completeAccountDeletionErasure(pool, {
        requestId: options.requestId,
        actorId: options.actorId
      });
    }

    if (options.requestId) {
      return await previewAccountDeletionErasure(pool, {
        requestId: options.requestId
      });
    }

    return await sweepDueAccountDeletionErasures(pool, {
      limit: options.limit,
      execute: options.execute,
      actorId: options.actorId
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parseAccountDeletionErasureArgs(process.argv.slice(2));
  const result = await runAccountDeletionErasureCli(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatTextReport(result));
}

if (process.argv[1] && resolvePath(process.argv[1]).endsWith("account-deletion-erasure.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
