import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptUrl = new URL('./portfolio.js', import.meta.url);
const portfolioScript = await readFile(scriptUrl, 'utf8');

class FakeMount {
  constructor() {
    this.innerHTML = '';
    this.listeners = new Map();
    this.pageShell = {
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        contains(value) { return this.values.has(value); },
      },
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  closest(selector) {
    return selector === '[data-portfolio-page]' ? this.pageShell : null;
  }
}

function createContext() {
  const mount = new FakeMount();
  const timers = [];
  const listeners = new Map();
  const warnings = [];

  const window = {
    NaviPortfolioDataSource: {
      invalidate() {},
      getLastError() { return null; },
      async readPortfolioRecord() {
        return { payload: { summary: { totalAccountValue: '100' } } };
      },
    },
    NaviPortfolioViewModel: {
      buildFromBackend(payload) {
        return { summary: payload.summary };
      },
    },
    NaviAuthSession: {
      getState() {
        return { enabled: true, initialized: true, loading: false, authenticated: true };
      },
    },
    HZCurrency: {
      symbolHtml() { return 'V₪'; },
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    clearTimeout(id) {
      timers[id] = null;
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length - 1;
    },
    CustomEvent,
    __pfCardsReady: false,
  };

  const context = {
    window,
    document: {
      querySelector(selector) {
        return selector === '[data-portfolio-cards]' ? mount : null;
      },
    },
    console: {
      warn(...args) { warnings.push(args); },
      error(...args) { warnings.push(args); },
    },
    setTimeout: window.setTimeout,
  };

  return {
    context,
    mount,
    timers,
    listeners,
    warnings,
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
    fireTimer(index = 0) {
      const timer = timers[index];
      assert.equal(typeof timer, 'function');
      timer();
    },
  };
}

{
  const test = createContext();
  vm.runInNewContext(portfolioScript, test.context);
  await test.flush();

  assert.match(test.mount.innerHTML, /טוען תיק/);

  test.fireTimer();

  assert.match(test.mount.innerHTML, /התיק לא נטען/);
  assert.match(test.mount.innerHTML, /נסה שוב/);
  assert.doesNotMatch(test.mount.innerHTML, /טוען תיק/);
  assert.equal(test.warnings.some((entry) => String(entry[0]).includes('content island did not become ready')), true);
}
