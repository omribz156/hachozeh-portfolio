import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { auditAvatarStorageIntegrity } from "../auth/avatar-storage-integrity";

async function run(): Promise<void> {
  const env = loadAppEnv();
  const db = createDbPool(env.db);

  try {
    const report = await auditAvatarStorageIntegrity(db);
    console.log(JSON.stringify(report, null, process.argv.includes("--json") ? 2 : 0));
    if (report.verdict === "bad") process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
