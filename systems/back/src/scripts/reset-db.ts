import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";

async function run(): Promise<void> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    await withTransaction(pool, async (client) => {
      await client.query("drop schema public cascade");
      await client.query("create schema public");
    });

    console.log("reset public schema");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
