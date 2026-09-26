import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude integration tests — those require a live DB and run via
    // `npm run test:integration` (vitest.integration.config.ts).
    exclude: ["test-integration/**", "dist/**", "**/node_modules/**"]
  }
});
