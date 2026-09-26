import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resolveOpenMarketTargets } from "./auth-helpers.mjs";

// Recovered from the deleted a11y.spec.mjs (git: 0d68be4d) and repointed
// at live Astro routes. Runs axe-core WCAG 2.0 A/AA checks against the
// Astro app instead of file:// static pages.

const ASTRO_BASE = process.env.ASTRO_BASE_URL || "http://127.0.0.1:4321";
const BACKEND_BASE = "http://127.0.0.1:3001";

// Resolved once per worker: first open market from the discovery feed.
let _resolvedMarketKey = null;
async function getMarketKey(context) {
  if (_resolvedMarketKey) return _resolvedMarketKey;
  try {
    const openMarkets = await resolveOpenMarketTargets(context, { backendBase: BACKEND_BASE });
    if (openMarkets.length) {
      _resolvedMarketKey = openMarkets[0].marketKey;
      return _resolvedMarketKey;
    }
  } catch (_err) {
    // fall through to fallback
  }
  _resolvedMarketKey = "disc-cm-image-bucket-boi-rate-august-20260831";
  return _resolvedMarketKey;
}

function summarizeViolations(pageId, violations) {
  return violations
    .map((violation) => {
      const nodeSummaries = violation.nodes.slice(0, 5).map((node) => {
        const target = node.target.join(" > ") || node.html;
        const failure = (node.failureSummary || "").split("\n")[1]?.trim() || node.html;
        return `- ${target}: ${failure}`;
      });

      const extraNodeCount = violation.nodes.length - nodeSummaries.length;
      if (extraNodeCount > 0) {
        nodeSummaries.push(`- ... plus ${extraNodeCount} more node(s)`);
      }

      return [
        `${violation.id} [${violation.impact}] on ${pageId}`,
        ...nodeSummaries,
      ].join("\n");
    })
    .join("\n\n");
}

// A11Y_TARGETS env var: comma-separated list of page IDs to run, e.g.
// A11Y_TARGETS=trending,portfolio. Empty = run all.
const targetEnv = process.env.A11Y_TARGETS || process.env.BROWSER_QA_TARGETS || "";
const requestedIds = targetEnv
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

// Static target definitions.
// market-detail is resolved dynamically from the discovery feed per-worker.
const STATIC_TARGETS = [
  {
    id: "trending",
    url: () => `${ASTRO_BASE}/trending`,
    readySelector: '[data-trending-stage] [data-market-stream]',
  },
  {
    id: "breaking-markets",
    url: () => `${ASTRO_BASE}/breaking-markets`,
    readySelector: '[data-breaking-stage]',
  },
  {
    id: "new-markets",
    url: () => `${ASTRO_BASE}/new-markets`,
    readySelector: '[data-static-page="new-markets"]',
  },
  {
    id: "portfolio",
    url: () => `${ASTRO_BASE}/portfolio`,
    // Portfolio auth-gate is visible to guests; that's fine — axe runs on whatever renders.
    readySelector: '[data-portfolio-page]',
  },
  {
    id: "help",
    url: () => `${ASTRO_BASE}/help`,
    readySelector: 'main',
  },
  {
    id: "terms",
    url: () => `${ASTRO_BASE}/terms`,
    readySelector: 'main',
  },
];

// market-detail is dynamic — resolved in beforeAll per worker.
const ALL_IDS = [...STATIC_TARGETS.map((t) => t.id), "market-detail"];

const selectedIds =
  requestedIds.length > 0
    ? ALL_IDS.filter((id) => requestedIds.includes(id))
    : ALL_IDS;

if (selectedIds.length === 0) {
  test("a11y target selection is valid", () => {
    throw new Error(
      `No accessibility targets matched: ${requestedIds.join(", ")}`
    );
  });
}

// Static page tests
for (const target of STATIC_TARGETS.filter((t) => selectedIds.includes(t.id))) {
  test(`${target.id} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(target.url(), { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await expect(page.locator(target.readySelector).first()).toBeVisible({
      timeout: 10_000,
    });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const seriousOrWorse = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || "")
    );

    expect(
      seriousOrWorse.length,
      seriousOrWorse.length
        ? summarizeViolations(target.id, seriousOrWorse)
        : `no serious/critical accessibility violations on ${target.id}`
    ).toBe(0);
  });
}

// Dynamic market-detail test
if (selectedIds.includes("market-detail")) {
  test("market-detail has no serious accessibility violations", async ({
    page,
  }) => {
    const marketKey = await getMarketKey(page.context());
    const url = `${ASTRO_BASE}/markets/${marketKey}`;

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await expect(
      page.locator("[data-market-detail-order-ticket]").first()
    ).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const seriousOrWorse = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || "")
    );

    expect(
      seriousOrWorse.length,
      seriousOrWorse.length
        ? summarizeViolations("market-detail", seriousOrWorse)
        : "no serious/critical accessibility violations on market-detail"
    ).toBe(0);
  });
}
