/**
 * Per-worker env override.
 *
 * Vitest runs each test worker in a fresh Node process that inherits
 * process.env from the parent. We set the DB_ vars here (before any
 * src/ module can load dotenv) so that createDbPool() and loadAppEnv()
 * both point at the test database.
 *
 * Listed in vitest.integration.config.ts → setupFiles so it runs in
 * every worker before any test file is imported.
 */

const TEST_DB_NAME = process.env["DB_NAME"] ?? "navi_test";

// Re-assert the safety check inside each worker as defence-in-depth.
if (!TEST_DB_NAME.endsWith("_test")) {
  throw new Error(
    `[integration-env] HARD FAIL: DB_NAME="${TEST_DB_NAME}" does not end with "_test". ` +
      `Worker refusing to start.`
  );
}

// Stamp the overrides so they win over anything dotenv might load.
process.env["DB_HOST"] = process.env["DB_HOST"] ?? "127.0.0.1";
process.env["DB_PORT"] = process.env["DB_PORT"] ?? "55432";
process.env["DB_USER"] = process.env["DB_USER"] ?? "navi";
process.env["DB_PASSWORD"] = process.env["DB_PASSWORD"] ?? "navi";
process.env["DB_NAME"] = TEST_DB_NAME;
process.env["NODE_ENV"] = "test";
// Suppress dotenv from overwriting the above by pointing it at a
// non-existent file path that will fail silently.
process.env["NAVI_ENV_FILE"] = "/dev/null";
