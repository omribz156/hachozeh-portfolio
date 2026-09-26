import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retries absorb transient flake from hammering the live dev backend with the full
  // suite (slow responses → timeouts, mid-poll renders). A REAL regression fails on
  // every retry; only environmental hiccups recover. CI gets one more.
  retries: process.env.CI ? 2 : 1,
  timeout: 30_000,
  reporter: [["list"]],
  outputDir: path.join(__dirname, "test-results"),
  use: {
    chromiumSandbox: false,
    launchOptions: {
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    },
    trace: "off",
    screenshot: "off",
    video: "off",
    viewport: { width: 1440, height: 1200 }
  }
});
