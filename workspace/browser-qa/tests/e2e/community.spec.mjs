/**
 * community.spec.mjs — E2E + pixel regression for /community and /community/t/:id
 *
 * FRONT-ONLY, SEEDED SURFACE — no backend, no persistence. All data is fixed seed
 * (community-seed.js); composers are in-memory only, resetting on reload.
 * Maps to finish-community-integration.md; every write seam listed there.
 *
 * Routes covered:
 *   /community                 — home (discussions + live feed + right rail)
 *   /community/t/rate-cut-sep  — thread detail (opening post + comment tree + rail)
 *   /community/t/<bogus-id>    — 404 contract
 *
 * Guest = default Playwright context (no storageState needed for public surface).
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for the CommunityHome Preact island to hydrate.
 *  The view-toggle tablist is rendered by the island; once it's visible the
 *  island has mounted and the full seed tree is in the DOM. */
async function waitForCommunityHome(page) {
  await page.locator('[role="tablist"][aria-label="תצוגת קהילה"]').waitFor({ timeout: 15_000 });
}

/** Wait for the CommunityThread Preact island to hydrate.
 *  The comment bar (.th-cbar) is rendered client-side; its presence proves
 *  the island mounted and the seed thread is live. */
async function waitForCommunityThread(page) {
  await page.locator('.th-cbar').waitFor({ timeout: 15_000 });
}

/** Assert no horizontal overflow. Hard-fail at 390; warn (non-blocking) at 360. */
async function assertNoOverflow(page) {
  // 390px — must pass
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const at390 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(
    at390.overflows,
    `Horizontal overflow at 390px: scrollWidth=${at390.scrollWidth} clientWidth=${at390.clientWidth}`
  ).toBe(false);

  // 360px — warn, do not fail (narrow RTL grids can be borderline)
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(200);
  const at360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  if (at360.overflows) {
    console.warn(
      `[community] horizontal overflow at 360px (non-blocking): scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth}`
    );
  }
}

// ─── /community ──────────────────────────────────────────────────────────────

test.describe('/community — home', () => {

  // ── 1. Load ────────────────────────────────────────────────────────────────
  test('loads with SSR 200 and main visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/community') && r.request().method() === 'GET'),
      page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForCommunityHome(page);
    await expect(page.locator('main.cm-page.cp-page')).toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure landmarks ─────────────────────────────────────────────────
  test('structure landmarks present after hydration', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);

    // Masthead heading
    const h1 = page.locator('.cm-mast-h');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('קהילה');

    // View toggle — both tabs present
    const tablist = page.locator('[role="tablist"][aria-label="תצוגת קהילה"]');
    await expect(tablist).toBeVisible();

    const discussTab = tablist.locator('[role="tab"]', { hasText: 'דיונים' });
    const activityTab = tablist.locator('[role="tab"]', { hasText: 'פיד חי' });
    await expect(discussTab).toBeVisible();
    await expect(activityTab).toBeVisible();

    // Discussions tab is active by default
    await expect(discussTab).toHaveAttribute('aria-selected', 'true');
    await expect(activityTab).toHaveAttribute('aria-selected', 'false');

    // Topic filter chips
    const topics = page.locator('.cm-topic');
    await expect(topics.first()).toBeVisible();
    const topicCount = await topics.count();
    expect(topicCount, 'expected multiple topic chips').toBeGreaterThan(3);

    // Featured discussion (shown in דיונים view with "הכל" topic)
    const featSection = page.locator('.co-feat');
    await expect(featSection).toBeVisible();
    await expect(featSection).toContainText('הדיון של היום');

    // Discussion list — at least one article
    const discussionList = page.locator('section.co-threads[aria-label="דיונים"]');
    await expect(discussionList).toBeVisible();
    await expect(discussionList.locator('article.co-thread').first()).toBeVisible();

    // "פתח דיון" CTA button
    await expect(page.locator('button.cm-new-cta', { hasText: 'פתח דיון' })).toBeVisible();

    // Right rail: "נדון עכשיו" card
    const railNow = page.locator('aside.cp-rail').locator('.cm-card-h .t', { hasText: 'נדון עכשיו' });
    await expect(railNow).toBeVisible();

    // Right rail: "קולות לעקוב" card
    const railPeople = page.locator('aside.cp-rail').locator('.cm-card-h .t', { hasText: 'קולות לעקוב' });
    await expect(railPeople).toBeVisible();

    gate.assertClean();
  });

  // ── 3. Flow A — view toggle דיונים ↔ פיד חי ─────────────────────────────
  test('view toggle switches between discussions and live feed panels', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);

    const tablist = page.locator('[role="tablist"][aria-label="תצוגת קהילה"]');
    const discussTab = tablist.locator('[role="tab"]', { hasText: 'דיונים' });
    const activityTab = tablist.locator('[role="tab"]', { hasText: 'פיד חי' });

    // Default: discussions panel on, activity panel off
    const discussPanel = page.locator('[data-panel="discuss"]');
    const activityPanel = page.locator('[data-panel="activity"]');

    await expect(discussPanel).toHaveClass(/on/);
    // activity panel exists but not .on
    await expect(activityPanel).not.toHaveClass(/on/);

    // Click "פיד חי" — activity panel should become active
    await activityTab.click();
    await expect(activityTab).toHaveAttribute('aria-selected', 'true');
    await expect(discussTab).toHaveAttribute('aria-selected', 'false');
    await expect(activityPanel).toHaveClass(/on/);
    await expect(discussPanel).not.toHaveClass(/on/);

    // The feed section should now be visible
    await expect(page.locator('section.sq-feed[aria-label="פיד פעילות"]')).toBeVisible();

    // Toggle back to דיונים
    await discussTab.click();
    await expect(discussTab).toHaveAttribute('aria-selected', 'true');
    await expect(discussPanel).toHaveClass(/on/);
    await expect(activityPanel).not.toHaveClass(/on/);

    gate.assertClean();
  });

  // ── 4a. Pixel snapshot ─────────────────────────────────────────────────────
  // Taken in דיונים view (default) BEFORE any mutating flows.
  // Seed data is deterministic; freeze stops the live-dot pulse.
  test('pixel baseline — /community home (דיונים view)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);

    // Mask only chromeMasks (wallet); community is a guest page, no live numbers.
    // freeze=true stops the .live-dot pulse animation.
    await snap(page, 'community.png', {
      mask: [...chromeMasks(page)],
      freeze: true,
    });

    gate.assertClean();
  });

  // ── 4b. Flow B — inline feed composer: post a take ────────────────────────
  test('feed composer: type a take and post — new item appears in feed', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);

    // Switch to פיד חי to expose the feed composer
    await page.locator('[role="tab"]', { hasText: 'פיד חי' }).click();
    await expect(page.locator('[data-panel="activity"]')).toHaveClass(/on/);

    const composer = page.locator('.cm-xcompose');
    await expect(composer).toBeVisible();

    // Type into the take textarea (first TakeBlock)
    const textarea = composer.locator('.xc-input').first();
    await textarea.fill('קריאת בדיקה מ-E2E: השוק לא מתמחר את ההאטה נכון');

    // "פרסם" button should become enabled
    const postBtn = composer.locator('button.xc-post');
    await expect(postBtn).toBeEnabled();

    // Record feed item count before posting
    const feedSection = page.locator('section.sq-feed[aria-label="פיד פעילות"]');
    const beforeCount = await feedSection.locator('article.sq-item').count();

    // Post
    await postBtn.click();

    // After posting, addFeedItem sets view='activity' and prepends to the feed array.
    // sortFeed reorders by engagement (likes+comments), so the new item (likes=0,comments=0)
    // may not be first in visual order — but it IS in the DOM carrying cm-justadded.
    // Assert: one more item exists AND the new item (with our text) is in the list.
    await expect(feedSection.locator('article.sq-item')).toHaveCount(beforeCount + 1, { timeout: 8_000 });

    // Find the new item by its text content (not position, since sort reorders)
    const newItem = feedSection.locator('article.sq-item.cm-justadded');
    await expect(newItem).toBeVisible();
    await expect(newItem).toContainText('קריאת בדיקה מ-E2E');

    gate.assertClean();
  });

  // ── 4c. Flow B — new discussion modal ─────────────────────────────────────
  test('new discussion modal: fill market + title, submit — discussion with mine-tag appears', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);

    // Open the modal via "פתח דיון"
    await page.locator('button.cm-new-cta', { hasText: 'פתח דיון' }).click();

    const modal = page.locator('[role="dialog"][aria-label="פתח דיון חדש"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toContainText('פתח דיון חדש');

    // Search for a market — type a keyword that matches the seed
    const marketSearch = modal.locator('input.cm-market-search');
    await marketSearch.fill('ריבית');

    // Wait for the results dropdown to open
    const marketList = modal.locator('.cm-market-list.open');
    await expect(marketList).toBeVisible();

    // Pick the first result
    const firstOpt = marketList.locator('button.cm-market-opt').first();
    await expect(firstOpt).toBeVisible();
    await firstOpt.click();

    // Market is now selected — the search field becomes readonly with the picked title
    await expect(modal.locator('input.cm-market-search[readonly]')).toBeVisible();

    // Fill the discussion title
    const titleInput = modal.locator('input.cm-title');
    await titleInput.fill('כותרת דיון בדיקה E2E');

    // Submit
    await modal.locator('button.cm-submit').click();

    // Modal should close and the page switches to דיונים view
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-panel="discuss"]')).toHaveClass(/on/);

    // The new discussion should appear in the list carrying cm-justadded + the mine-tag.
    // sortDisc orders by replies count; the new item has replies=0 so it may not be first.
    // Locate by the justAdded class instead of by position.
    const newDiscussion = page.locator('section.co-threads article.co-thread.cm-justadded');
    await expect(newDiscussion).toBeVisible({ timeout: 8_000 });
    await expect(newDiscussion.locator('.cm-mine-tag')).toBeVisible();
    await expect(newDiscussion.locator('.cm-mine-tag')).toContainText('הדיון שלך');
    await expect(newDiscussion).toContainText('כותרת דיון בדיקה E2E');

    gate.assertClean();
  });

  // ── 5. Hygiene — no horizontal overflow at 390/360 ───────────────────────
  test('no horizontal overflow at 390/360px', async ({ page }) => {
    await page.goto(`${astroBase}/community`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityHome(page);
    await assertNoOverflow(page);
  });
});

// ─── /community/t/:id ────────────────────────────────────────────────────────

test.describe('/community/t/rate-cut-sep — thread detail', () => {

  // ── 6. Load ────────────────────────────────────────────────────────────────
  test('loads with SSR 200 and main visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/community/t/rate-cut-sep') && r.request().method() === 'GET'),
      page.goto(`${astroBase}/community/t/rate-cut-sep`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForCommunityThread(page);
    await expect(page.locator('main.cm-page.th-page')).toBeVisible();

    gate.assertClean();
  });

  // ── 7. Structure landmarks ─────────────────────────────────────────────────
  test('structure landmarks present after hydration', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community/t/rate-cut-sep`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityThread(page);

    // Market context header (.th-ctx) — category + market reference
    const ctx = page.locator('.th-ctx');
    await expect(ctx).toBeVisible();
    await expect(ctx).toContainText('מאקרו');

    // Opening post
    const openingPost = page.locator('article.th-op');
    await expect(openingPost).toBeVisible();
    await expect(openingPost.locator('h1.th-op-q')).toBeVisible();
    await expect(openingPost.locator('h1.th-op-q')).toContainText('43%');

    // Comment tree — at least one .th-c comment
    const commentTree = page.locator('.th-comments');
    await expect(commentTree).toBeVisible();
    await expect(commentTree.locator('article.th-c').first()).toBeVisible();

    // Thread composer
    const composer = page.locator('.th-composer');
    await expect(composer).toBeVisible();

    // Rail: "השוק שבמרכז" card
    const railMarket = page.locator('aside.th-rail .cm-card-h .t', { hasText: 'השוק שבמרכז' });
    await expect(railMarket).toBeVisible();

    // Rail: "משוחחים בולטים" card
    const railPeople = page.locator('aside.th-rail .cm-card-h .t', { hasText: 'משוחחים בולטים' });
    await expect(railPeople).toBeVisible();

    gate.assertClean();
  });

  // ── 8. Pixel snapshot ─────────────────────────────────────────────────────
  // Taken BEFORE posting a comment, so the baseline is the stable seed state.
  test('pixel baseline — thread detail (before commenting)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community/t/rate-cut-sep`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityThread(page);

    // Seed data is fixed; freeze stops any pulse animations.
    await snap(page, 'community-thread.png', {
      mask: [...chromeMasks(page)],
      freeze: true,
    });

    gate.assertClean();
  });

  // ── 9. Flow — post a comment via ThreadComposer ───────────────────────────
  test('thread composer: post a comment — prepends to list and bumps comment count', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/community/t/rate-cut-sep`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityThread(page);

    // Read initial comment count from the .th-cbar counter
    const cbarCount = page.locator('.th-cbar .n');
    const initialCountText = await cbarCount.textContent();
    const initialCount = parseInt(initialCountText ?? '0', 10);
    expect(initialCount, 'expected a positive initial comment count').toBeGreaterThan(0);

    // Read the number of comment articles before posting
    const commentArticles = page.locator('.th-comments article.th-c');
    const beforeCount = await commentArticles.count();
    expect(beforeCount).toBeGreaterThan(0);

    // Type into the ThreadComposer textarea
    const textarea = page.locator('.th-composer .cinput textarea.th-cfield-input');
    await textarea.fill('תגובת בדיקה E2E — שני מדדים רצופים ודי');

    // "פרסם תגובה" button should become enabled
    const postBtn = page.locator('.th-composer .cinput button.thc-post');
    await expect(postBtn).toBeEnabled();
    await postBtn.click();

    // Comment list should now have one more article
    await expect(commentArticles).toHaveCount(beforeCount + 1, { timeout: 8_000 });

    // addComment() does setComments((prev) => [newComment, ...prev]) — new comment
    // is prepended, so state-order index 0 becomes the new comment. The DOM renders
    // in state order, so .th-c.first() is our new comment.
    // BUG NOTE: CommunityThread.jsx does not apply cm-justadded to new comments
    // (unlike CommunityHome which uses {d.justAdded ? ' cm-justadded' : ''}).
    // Asserting by text + position instead. See finish-community-integration.md.
    const firstComment = commentArticles.first();
    await expect(firstComment).toContainText('תגובת בדיקה E2E');

    // Comment count in the cbar should have bumped by 1
    const newCountText = await cbarCount.textContent();
    const newCount = parseInt(newCountText ?? '0', 10);
    expect(newCount, 'comment count should have incremented').toBe(initialCount + 1);

    gate.assertClean();
  });

  // ── 10. Hygiene — no horizontal overflow ──────────────────────────────────
  test('no horizontal overflow at 390/360px', async ({ page }) => {
    await page.goto(`${astroBase}/community/t/rate-cut-sep`, { waitUntil: 'domcontentloaded' });
    await waitForCommunityThread(page);
    await assertNoOverflow(page);
  });
});

// ─── /community/t/<bogus-id> — 404 contract ──────────────────────────────────

test.describe('/community/t/<bogus-id> — 404', () => {
  test('bogus thread id returns 404', async ({ page }) => {
    // Allow the expected "Failed to load resource: 404" console error that browsers
    // emit when a document-level 404 is returned — this IS the thing we're testing.
    const gate = installConsoleGate(page, {
      allow: [/Failed to load resource.*404/i, /the server responded with a status of 404/i],
    });

    const response = await page.goto(`${astroBase}/community/t/does-not-exist-abc123`, {
      waitUntil: 'domcontentloaded',
    });

    // Astro returns 404 directly from the SSR handler when THREADS[id] is undefined
    expect(response?.status(), 'expected 404 for unknown thread id').toBe(404);

    gate.assertClean();
  });
});
