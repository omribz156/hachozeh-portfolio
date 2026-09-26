import { expect } from '@playwright/test';

/** Fail a test on any uncaught console error or page error.
 *  Call at the top of a test (before goto), assert at the end:
 *    const gate = installConsoleGate(page);
 *    ... ; gate.assertClean();
 *  `allow` extends the default allowlist with extra RegExps. */
const DEFAULT_ALLOW = [
  // discovery feed live stream isn't shipped yet — known 404, not a regression
  /discovery\/feed\/stream/i,
  /\/favicon/i,
  // ResizeObserver loop warnings are benign browser noise
  /ResizeObserver loop/i,
];

export function installConsoleGate(page, { allow = [] } = {}) {
  const allowAll = [...DEFAULT_ALLOW, ...allow];
  const isAllowed = (text) => allowAll.some((re) => re.test(text));
  const errors = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isAllowed(text)) errors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = `pageerror: ${err.message}`;
    if (!isAllowed(text)) errors.push(text);
  });

  return {
    errors,
    assertClean() {
      expect(errors, `Unexpected console errors:\n${errors.join('\n')}`).toHaveLength(0);
    },
  };
}
