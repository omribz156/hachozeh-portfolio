#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const failures = [];

function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

function fail(message) {
  failures.push(message);
}

function assertExists(relativePath) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    fail(`missing ${relativePath}`);
  }
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function walkFiles(relativeDir, extensions) {
  const root = path.join(repoRoot, relativeDir);
  if (!existsSync(root)) return [];

  const files = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

function assertNoText(relativePath, forbidden, note = forbidden) {
  if (read(relativePath).includes(forbidden)) {
    fail(`${relativePath} still contains ${note}`);
  }
}

const portedPages = [
  "systems/web/src/pages/trending.astro",
  "systems/web/src/pages/breaking-markets.astro",
  "systems/web/src/pages/portfolio.astro",
  "systems/web/src/pages/markets/[marketKey].astro",
];

const intentionalStubs = [
  "systems/web/src/pages/new-markets.astro",
  "systems/web/src/pages/qanda.astro",
  "systems/web/src/pages/graphs-and-accuracy.astro",
];

const redirectShims = [
  "systems/web/src/pages/breaking-markets.html.astro",
  "systems/web/src/pages/qanda.html.astro",
];

[
  ...portedPages,
  ...intentionalStubs,
  ...redirectShims,
  "systems/web/src/components/overlay/PageOverlayHost.jsx",
  "systems/web/src/components/overlay/OtpOverlay.jsx",
  "systems/web/src/client/shell/header-session.client.js",
  "systems/web/src/styles/patterns/mobile-trade-launcher.css",
  "systems/web/src/styles/patterns/trade-ticket.css",
  "systems/web/public/assets/images/market-buckets/economy.svg",
  "workspace/dev/Caddyfile.mac-proof",
  "workspace/dev/README.md",
  "workspace/assets/market-images/registry.json",
  "workspace/reports/astro-migration/2026-06-03-final-readiness-report.md",
  "workspace/reports/astro-migration/2026-06-03-cleanup-review.md",
  "workspace/browser-qa/tests/astro-auth-overlay.spec.mjs",
  "workspace/browser-qa/tests/astro-mobile.spec.mjs",
  "workspace/browser-qa/tests/astro-ux-perf.spec.mjs",
].forEach(assertExists);

if (existsSync(path.join(repoRoot, "systems/web/public/assets/images/market-buckets"))) {
  const bucketAssets = readdirSync(
    path.join(repoRoot, "systems/web/public/assets/images/market-buckets")
  ).filter((name) => name.endsWith(".svg"));
  if (bucketAssets.length < 10) {
    fail(`expected market bucket public assets, found ${bucketAssets.length}`);
  }
}

if (existsSync(path.join(repoRoot, "systems/web/public/assets/images/market-photos"))) {
  const hasPhoto = walkFiles("systems/web/public/assets/images/market-photos", [".jpg", ".jpeg", ".png", ".webp"]).length > 0;
  if (!hasPhoto) {
    fail("missing public market photos");
  }
}

assertNoText("workspace/dev/Caddyfile.mac-proof", "/systems/front/assets");
assertNoText("workspace/assets/market-images/registry.json", "/systems/front/assets/images/market-buckets");
assertNoText("workspace/assets/market-images/registry.json", "/systems/front/assets/images/market-photos");

const runtimeFiles = [
  ...walkFiles("systems/web/src", [".astro", ".js", ".mjs", ".ts", ".css"]),
  ...walkFiles("systems/web/public/scripts", [".js", ".mjs"]),
  ...walkFiles("systems/back/src", [".ts", ".js", ".mjs"]),
];

for (const filePath of runtimeFiles) {
  const relativePath = rel(filePath);
  const content = readFileSync(filePath, "utf8");

  if (content.includes("market-detail.html?market")) {
    fail(`${relativePath} still emits market-detail.html?market`);
  }

  if (content.includes("/systems/front/assets/images/market-photos/")) {
    fail(`${relativePath} still references old market photo assets`);
  }

  if (
    content.includes("/systems/front/assets/images/market-buckets/") &&
    relativePath !== "systems/back/src/shared/market-truth.ts"
  ) {
    fail(`${relativePath} still references old market bucket assets`);
  }
}

const envSource = read("systems/back/src/config/env.ts");
if (!envSource.includes("http://127.0.0.1:6969/trending")) {
  fail("systems/back/src/config/env.ts default PUBLIC_BASE_URL is not the Astro/Caddy gateway");
}

if (!envSource.includes('"111111"')) {
  fail("systems/back/src/config/env.ts default AUTH_DEV_OTP_CODE is not the six-digit Astro OTP helper");
}

const otpOverlaySource = read("systems/web/src/components/overlay/OtpOverlay.jsx");
const overlayLogicSource = read("systems/web/src/components/overlay/overlay-logic.js");
if (!otpOverlaySource.includes("data-otp-box") || !overlayLogicSource.includes("/^\\d{6}$/")) {
  fail("Astro overlay does not expose the six-box numeric OTP contract");
}

const mobileQa = read("workspace/browser-qa/tests/astro-mobile.spec.mjs");
if (!mobileQa.includes("mobile trade launcher") || !mobileQa.includes("horizontal rail scroll")) {
  fail("astro-mobile.spec.mjs does not cover the mobile launcher and rail overflow regressions");
}
if (!mobileQa.includes("stays sticky while scrolling") || !mobileQa.includes("barTop")) {
  fail("astro-mobile.spec.mjs does not prove sticky header geometry after real scroll");
}

const perfQa = read("workspace/browser-qa/tests/astro-ux-perf.spec.mjs");
if (!perfQa.includes("first-contentful-paint") || !perfQa.includes("failedResourceCount")) {
  fail("astro-ux-perf.spec.mjs does not capture UX timing and failed resource evidence");
}

for (const toolPath of [
  "systems/back/src/scripts/platform-doctor.ts",
  "systems/back/src/scripts/platform-watchdog.ts",
]) {
  if (!read(toolPath).includes("127.0.0.1:6969")) {
    fail(`${toolPath} does not default to the Astro/Caddy gateway`);
  }
}

if (failures.length) {
  console.error("astro-migration: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("astro-migration: ok");
console.log(`ported_pages=${portedPages.length}`);
console.log(`intentional_stubs=${intentionalStubs.length}`);
console.log(`redirect_shims=${redirectShims.length}`);
