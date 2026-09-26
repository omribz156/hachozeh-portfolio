/**
 * portfolio-empty.spec.mjs — E2E + pixel regression for /portfolio EMPTY STATE
 *
 * A user with no open positions → /portfolio shows its empty/zero state.
 * The existing portfolio.spec.mjs only covers omrib's data-rich populated state.
 *
 * ACCOUNT: `e2e-empty@navi.local`
 *   A dedicated stable test account (never traded against). First run signs it
 *   up; subsequent runs log in. Because we never create positions for this
 *   account, the portfolio is always empty. If the session file is stale,
 *   delete /tmp/navi-e2e-empty-state.json and re-run.
 *
 * AUTH PATTERN — same as ensureOmribStorageState() in fixtures/contexts.mjs:
 *   Top-level await mints (or reuses) a cached storageState file. The file is
 *   written with Node's native fetch (no Playwright fixture needed) so it exists
 *   before test.use() resolves. This avoids firing auth/start per-test and never
 *   trips the per-IP OTP rate limiter (10/hr default).
 *
 *   First run: purpose='signup' to create the account.
 *   Re-runs: purpose='login' (account already exists; file already cached).
 *   The EMPTY_STATE file is deleted only if you need a fresh account login
 *   (e.g. if the session cookie has expired).
 *
 * ADD TO package.json:
 *   "e2e:portfolio-empty": "playwright test tests/e2e/portfolio-empty.spec.mjs"
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { astroBase, backendBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Empty-user session ───────────────────────────────────────────────────────

// Stable path — persists between runs like OMRIB_STATE. Delete to force fresh login.
export const EMPTY_STATE = path.join(os.tmpdir(), 'navi-e2e-empty-state.json');

// Stable identifier — this account is never traded against, so it always has
// zero positions. First run creates the account (signup); subsequent runs log in.
//
// BACKEND BUG (2026-06-23): auth/verify returns 500 for ALL new account creation
// (signup and login for non-existent identifiers) because createUserWithIdentity()
// in user-identity-records.ts inserts into users WITHOUT the `handle` column, which
// has a NOT NULL constraint added by migration 045_user_public_handles.sql. The
// spec is correct — it is blocked until the backend sets a derived handle on signup.
// Tracked in workspace/coordination/inbox.md ("signup → 500 null handle").
// Delete /tmp/navi-e2e-empty-state.json to force a re-auth once the bug is fixed.
const EMPTY_IDENTIFIER = 'e2e-empty@navi.local';

// Mirrors parseSetCookie from fixtures/contexts.mjs (not exported from there;
// we replicate rather than modify the fixture file).
function parseSetCookie(setCookie) {
  const cookies = [];
  for (const part of (setCookie || '').split(/,(?=[^ ])/)) {
    const [nameVal, ...attrs] = part.split(';').map((s) => s.trim());
    if (!nameVal || !nameVal.includes('=')) continue;
    const eq = nameVal.indexOf('=');
    const attrMap = Object.fromEntries(
      attrs.map((a) => {
        const i = a.indexOf('=');
        return i >= 0 ? [a.slice(0, i).toLowerCase(), a.slice(i + 1)] : [a.toLowerCase(), true];
      })
    );
    cookies.push({
      name: nameVal.slice(0, eq),
      value: nameVal.slice(eq + 1),
      domain: '127.0.0.1',
      path: attrMap.path || '/',
      expires: attrMap.expires ? Math.floor(new Date(attrMap.expires).getTime() / 1000) : -1,
      httpOnly: 'httponly' in attrMap,
      secure: 'secure' in attrMap,
      sameSite: attrMap.samesite
        ? attrMap.samesite[0].toUpperCase() + attrMap.samesite.slice(1).toLowerCase()
        : 'Lax',
    });
  }
  return cookies;
}

/** Mint (once, cached) a storageState file for the dedicated empty-portfolio
 *  account. Call at module load (top-level await). Same contract as
 *  ensureOmribStorageState() — returns the path to the state file. */
async function ensureEmptyStorageState() {
  if (fs.existsSync(EMPTY_STATE)) return EMPTY_STATE;

  // Order: try login first (account may already exist from a prior run), then
  // signup as fallback. Login-first is cheaper on the OTP budget when the account
  // exists. On a truly-fresh environment where the account hasn't been created yet,
  // login will 400 ("user not found") and we fall through to signup.
  //
  // NOTE: signup is blocked by a backend bug — see EMPTY_IDENTIFIER comment above.
  // Once fixed, delete /tmp/navi-e2e-empty-state.json and re-run to create the account.
  for (const purpose of ['login', 'signup']) {
    const startRes = await fetch(`${backendBase}/api/auth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: EMPTY_IDENTIFIER, purpose }),
    });
    const start = await startRes.json();

    if (!startRes.ok) {
      // Login returns 4xx if the account doesn't exist yet → fall through to signup.
      // Signup returns 4xx if the account already exists → fall through to login
      // (shouldn't happen in normal flow since login is tried first, but be safe).
      // Any start failure on the LAST purpose is fatal.
      if (purpose !== 'signup') continue;
      throw new Error(`[portfolio-empty] auth/start (${purpose}) failed: ${JSON.stringify(start)}`);
    }

    const verifyRes = await fetch(`${backendBase}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: start.challengeId, code: start.devCode || '111111' }),
    });
    const verify = await verifyRes.json();
    if (!verifyRes.ok) {
      // If login verify 500s (backend bug: handle NOT NULL constraint on new users),
      // try the next purpose. If signup also fails, the outer throw reports it.
      if (purpose !== 'signup') continue;
      throw new Error(`[portfolio-empty] auth/verify failed: ${JSON.stringify(verify)}`);
    }

    const cookies = parseSetCookie(verifyRes.headers.get('set-cookie'));
    if (!cookies.length) throw new Error('[portfolio-empty] auth/verify returned no Set-Cookie');
    await fsp.writeFile(EMPTY_STATE, JSON.stringify({ cookies, origins: [] }, null, 2));
    return EMPTY_STATE;
  }

  throw new Error('[portfolio-empty] could not create or login empty account');
}

// Top-level await — runs once per Playwright worker process (not per test).
// Must be top-level (NOT beforeAll) — same constraint as ensureOmribStorageState().
// Mints a fresh no-position user (signup fixed 2026-06-23). Fails loud if auth breaks.
await ensureEmptyStorageState();
test.use({ storageState: EMPTY_STATE });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for PortfolioCards to hydrate. Works for empty-portfolio users:
 *  PortfolioCards fires navi:portfolio-content-ready once the model arrives,
 *  regardless of whether any positions exist. TotalCard still renders (zero balance). */
async function waitForPortfolioReady(page) {
  await Promise.race([
    page.evaluate(() =>
      new Promise((resolve) => {
        if (document.querySelector('[data-portfolio-total]')) {
          resolve();
          return;
        }
        window.addEventListener('navi:portfolio-content-ready', resolve, { once: true });
      })
    ),
    page.locator('[data-portfolio-total]').waitFor({ timeout: 15_000 }),
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('/portfolio — empty state (no positions)', () => {

  // ── 1. Load ──────────────────────────────────────────────────────────────
  test('loads /portfolio with 200 SSR and authed chrome', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/portfolio') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper
    await expect(page.locator('main[data-portfolio-page]')).toBeVisible();

    // Authed chrome: wallet cell present, guest CTA absent
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure — zero-position empty state ──────────────────────────────
  test('top-fold cards render; depth section shows empty-state message', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    // ── Top-fold: TotalCard ──
    // Renders for a zero-position user (shows opening wallet balance).
    await expect(page.locator('[data-portfolio-total]')).toBeVisible();

    // ── Top-fold: ChangeCard ──
    // Zero-position user → flat V₪ 0.00 carried P&L (NOT an empty-data message).
    const changeCard = page.locator('[data-portfolio-change]');
    await expect(changeCard).toBeVisible();
    // Timeframe pill row is always in the change card header.
    const timeframeBtns = page.locator('[data-portfolio-timeframe]');
    await expect(timeframeBtns.first()).toBeVisible();
    const tfCount = await timeframeBtns.count();
    expect(tfCount, 'expected multiple timeframe buttons').toBeGreaterThan(1);
    // A zero-position user still gets a numeric (carried) P&L card — a flat V₪ 0.00,
    // NOT an empty-data message. The empty message lives in the positions section
    // (asserted below), not here.
    await expect(changeCard).toContainText('רווח/הפסד');
    await expect(changeCard).toContainText('0.00');
    await expect(changeCard.locator('.pf-empty')).toHaveCount(0);

    // ── Depth section: structural chrome ──
    // Tab bar and search always render; only position rows are absent.
    await expect(page.locator('.pf-depth-bar')).toBeVisible();

    const positionsTab = page.locator('.pf-tablist button[role="tab"]', { hasText: 'פוזיציות' });
    const historyTab   = page.locator('.pf-tablist button[role="tab"]', { hasText: 'היסטוריה' });
    await expect(positionsTab).toBeVisible();
    await expect(historyTab).toBeVisible();

    await expect(page.locator('.pf-depth-search input[type="search"]')).toBeVisible();

    // ── Positions tab: empty-state message ──
    // PositionsTable renders "אין פוזיציות להציג." when positions array is empty.
    const emptyMsg = page.locator('.pf-empty.pf-empty--padded');
    await expect(emptyMsg).toBeVisible();
    await expect(emptyMsg).toContainText('אין פוזיציות להציג');

    // Populated table (role="table") must NOT be present.
    await expect(page.locator('[role="table"][aria-label="פוזיציות"]')).not.toBeAttached();

    gate.assertClean();
  });

  // ── 3. Pixel regression ───────────────────────────────────────────────────
  //
  // WHY each region is masked:
  //   chromeMasks(page)      — wallet balance in header: live per run
  //   [data-portfolio-total] — shows opening wallet balance (account-specific);
  //                            structure (eyebrow "שווי תיק", dl row "זמין למסחר")
  //                            is proven by the structure test above.
  //
  // NOT masked (deterministic in empty state):
  //   [data-portfolio-change]     — "אין נתונים לטווח הזה." static text + timeframe pills
  //   .pf-depth-bar               — tab bar with static Hebrew labels
  //   .pf-empty.pf-empty--padded  — "אין פוזיציות להציג." static text
  //   (no .pf-positions-list / .pf-history-list / .pf-closing-card / .pf-claims-card
  //    because none of those render in the empty state)
  test('pixel baseline — empty-state layout (minimal live-data masks)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    const masks = [
      ...chromeMasks(page),
      page.locator('[data-portfolio-total]'),
    ];

    await snap(page, 'portfolio-empty.png', { mask: masks });

    gate.assertClean();
  });

  // ── 4. Hygiene — no horizontal overflow at 390/360px ─────────────────────
  test('no horizontal overflow at 390/360px', async ({ page }) => {
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(200);

      const overflows = await page.evaluate(() => {
        const dw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
      });

      expect(
        overflows.overflows,
        `Horizontal overflow at ${width}px: scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`
      ).toBe(false);
    }
  });
});
