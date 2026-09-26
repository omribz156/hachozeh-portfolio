import { expect } from '@playwright/test';

/** Make a page deterministic before a pixel snapshot: kill animations/transitions,
 *  hide the caret, wait for webfonts (Material Symbols subset loads late and would
 *  otherwise flash ligature text), settle a beat. */
export async function stabilize(page) {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;
      scroll-behavior:auto!important} .live-dot,[class*="pulse"]{animation:none!important}`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** Shared header chrome carries live data (wallet balance) that must be masked on
 *  every authed full-page shot, else the balance reflows the diff. Spread into a
 *  spec's mask list; non-matching selectors are harmless. */
export function chromeMasks(page) {
  return [page.locator('.hz-shell__wallet-cell')];
}

/** Freeze JS-driven motion (carousels/tickers that mutate the DOM on a timer, which
 *  `animations:'disabled'` can't stop) by clearing all interval/timeout handles. Call
 *  AFTER the page's content is loaded — anything still pending is snapshot churn. */
export async function freezeTimers(page) {
  await page.evaluate(() => {
    const hi = setTimeout(() => {}, 0);
    for (let i = 0; i <= hi; i++) { clearTimeout(i); clearInterval(i); }
  });
}

/** Deterministic full-page screenshot.
 *  - `mask`  — locators painted over (live numbers, charts, timestamps).
 *  - `pin`   — `[{ sel, h }]` live regions pinned to a FIXED height (+overflow hidden)
 *              so a variable-height list/carousel can't reflow everything below it and
 *              break the diff. Mask these too — pin fixes geometry, mask fixes pixels.
 *  - `freeze`— clear timers first (stops JS carousels) before shooting.
 *  maxDiffPixelRatio absorbs AA noise. */
export async function snap(page, name, { mask = [], pin = [], freeze = false } = {}) {
  if (freeze) await freezeTimers(page);
  if (pin.length) {
    const css = pin.map(({ sel, h }) => `${sel}{height:${h}px!important;min-height:${h}px!important;max-height:${h}px!important;overflow:hidden!important}`).join('\n');
    await page.addStyleTag({ content: css });
  }
  await stabilize(page);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask,
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
}
