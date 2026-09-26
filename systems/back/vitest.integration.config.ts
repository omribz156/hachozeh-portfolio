import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only pick up integration tests — keep the unit suite untouched.
    include: ["test-integration/**/*.test.ts"],

    // Must be single-threaded: FOR UPDATE tests must not interleave.
    fileParallelism: false,
    pool: "forks",
    singleFork: true,

    // Override env before any src/ module imports dotenv.
    setupFiles: ["./test-integration/setup-env.ts"],

    // Safety check + create-db + migrate.
    globalSetup: ["./test-integration/global-setup.ts"],

    // Generous timeout for DB round-trips.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
