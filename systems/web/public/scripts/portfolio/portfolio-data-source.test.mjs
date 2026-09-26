import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const scriptUrl = new URL('./portfolio-data-source.js', import.meta.url);
const portfolioDataSourceScript = await readFile(scriptUrl, 'utf8');

function createDeferredResponse() {
  let resolve;
  const promise = new Promise((_resolve) => {
    resolve = _resolve;
  });
  return {
    promise,
    resolve(payload, status = 200) {
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      });
    },
  };
}

function createPortfolioPayload(prefix) {
  return [
    { summary: { total: `snapshot-${prefix}` } },
    { summary: `orders-${prefix}` },
    { summary: `history-${prefix}` },
    { summary: `performance-${prefix}` },
    { summary: `claims-${prefix}` },
    { summary: `sessions-${prefix}` },
  ];
}

function resolveBatch(fetchCalls, startIndex, prefix, entryCount = 6, status = 200) {
  const payloads = createPortfolioPayload(prefix);
  for (let index = 0; index < entryCount; index += 1) {
    fetchCalls[startIndex + index].deferred.resolve(payloads[index], status);
  }
}

function resolveOne(fetchCalls, index, payload, status = 200) {
  fetchCalls[index].deferred.resolve(payload, status);
}

function createContext(initialAuthState) {
  const authState = { ...initialAuthState };
  const fetchCalls = [];
  const window = {
    NAVI_REQUIRE_BACKEND_PORTFOLIO: true,
    location: {
      href: 'https://app.hachozeh.com/portfolio',
      origin: 'https://app.hachozeh.com',
      hostname: 'app.hachozeh.com',
    },
    NaviAuthSession: {
      getBackendBaseUrl() {
        return '';
      },
      isEnabled() {
        return true;
      },
      handleUnauthorized: () => {},
      getState() {
        return authState;
      },
    },
    fetch(_url) {
      const deferred = createDeferredResponse();
      fetchCalls.push({ deferred, url: _url });
      return deferred.promise;
    },
  };

  vm.runInNewContext(portfolioDataSourceScript, {
    window,
    URL,
    console,
  });

  return {
    window,
    authState,
    fetchCalls,
    dataSource: window.NaviPortfolioDataSource,
  };
}

test('readPortfolioRecord coalesces concurrent reads within same auth key', async () => {
  const context = createContext({
    enabled: true,
    initialized: true,
    loading: false,
    authenticated: true,
    user: { userId: 'user-alpha' },
  });

  const first = context.dataSource.readPortfolioRecord();
  const second = context.dataSource.readPortfolioRecord();

  assert.strictEqual(context.fetchCalls.length, 6);
  resolveBatch(context.fetchCalls, 0, 'user-alpha');

  const firstRecord = await first;
  const secondRecord = await second;

  assert.strictEqual(firstRecord, secondRecord);
  assert.equal(context.fetchCalls.length, 6);
});

test('stale success completions resolve null and do not paint stale user record', async () => {
  const context = createContext({
    enabled: true,
    initialized: true,
    loading: false,
    authenticated: true,
    user: { userId: 'user-alpha' },
  });

  const alphaRead = context.dataSource.readPortfolioRecord();

  context.authState.user.userId = 'user-bravo';
  const bravoRead = context.dataSource.readPortfolioRecord();
  assert.strictEqual(context.fetchCalls.length, 12);

  resolveBatch(context.fetchCalls, 0, 'user-alpha');
  const alphaRecord = await alphaRead;
  assert.equal(alphaRecord, null);

  const sameBravoRead = context.dataSource.readPortfolioRecord();
  assert.strictEqual(context.fetchCalls.length, 12);

  resolveBatch(context.fetchCalls, 6, 'user-bravo');

  const bravoResult = await bravoRead;
  const sameBravoResult = await sameBravoRead;

  assert.strictEqual(bravoResult.payload.snapshot.summary.total, 'snapshot-user-bravo');
  assert.strictEqual(sameBravoResult.payload.snapshot.summary.total, 'snapshot-user-bravo');
  assert.strictEqual(bravoResult, sameBravoResult);
});

test('sign-out stale completion resolves null and does not start signed-out fetch batch', async () => {
  const context = createContext({
    enabled: true,
    initialized: true,
    loading: false,
    authenticated: true,
    user: { userId: 'user-alpha' },
  });

  const alphaRead = context.dataSource.readPortfolioRecord();
  context.authState.authenticated = false;
  const signedOutRead = context.dataSource.readPortfolioRecord();

  assert.strictEqual(context.fetchCalls.length, 6);
  resolveBatch(context.fetchCalls, 0, 'user-alpha');

  const alphaRecord = await alphaRead;
  const signedOutRecord = await signedOutRead;

  assert.equal(alphaRecord, null);
  assert.equal(signedOutRecord, null);
});

test('stale error completion resolves null on completion race', async () => {
  const context = createContext({
    enabled: true,
    initialized: true,
    loading: false,
    authenticated: true,
    user: { userId: 'user-alpha' },
  });

  const alphaRead = context.dataSource.readPortfolioRecord();

  context.authState.user.userId = 'user-bravo';
  const bravoRead = context.dataSource.readPortfolioRecord();

  assert.strictEqual(context.fetchCalls.length, 12);

  resolveBatch(context.fetchCalls, 0, 'user-alpha', 6, 500);

  const alphaRecord = await alphaRead;
  assert.equal(alphaRecord, null);

  resolveBatch(context.fetchCalls, 6, 'user-bravo');
  const bravoRecord = await bravoRead;

  assert.equal(bravoRecord.payload.snapshot.summary.total, 'snapshot-user-bravo');
});

test('readPortfolioRecord does not fetch when auth enabled state is pending/signed-out/without identity', async () => {
  const testCases = [
    {
      label: 'auth pending',
      state: {
        enabled: true,
        initialized: false,
        loading: true,
        authenticated: false,
      },
    },
    {
      label: 'auth signed out',
      state: {
        enabled: true,
        initialized: true,
        loading: false,
        authenticated: false,
      },
    },
    {
      label: 'auth without identity',
      state: {
        enabled: true,
        initialized: true,
        loading: false,
        authenticated: true,
      },
    },
  ];

  for (const { state, label } of testCases) {
    const context = createContext(state);
    const record = await context.dataSource.readPortfolioRecord();

    assert.equal(record, null, `should return null for ${label}`);
    assert.equal(context.fetchCalls.length, 0, `should not start fetch for ${label}`);
  }
});

test('auth-disabled state continues to fetch', async () => {
  const context = createContext({
    enabled: false,
    initialized: false,
    loading: false,
    authenticated: false,
  });

  const record = context.dataSource.readPortfolioRecord();
  assert.strictEqual(context.fetchCalls.length, 5);

  resolveBatch(context.fetchCalls, 0, 'auth-disabled', 5);
  const payload = await record;

  assert.equal(payload.payload.snapshot.summary.total, 'snapshot-auth-disabled');
});

test('readPortfolioPerformanceTimeframe stale request returns null on auth transition', async () => {
  const context = createContext({
    enabled: true,
    initialized: true,
    loading: false,
    authenticated: true,
    user: { userId: 'user-alpha' },
  });

  const alphaTimeframe = context.dataSource.readPortfolioPerformanceTimeframe('day');
  context.authState.user.userId = 'user-bravo';
  const bravoTimeframe = context.dataSource.readPortfolioPerformanceTimeframe('day');

  assert.strictEqual(context.fetchCalls.length, 2);

  resolveOne(context.fetchCalls, 0, { summary: 'performance-user-alpha' });
  const alphaResult = await alphaTimeframe;
  assert.equal(alphaResult, null);

  resolveOne(context.fetchCalls, 1, { summary: 'performance-user-bravo' });
  const bravoResult = await bravoTimeframe;

  assert.equal(bravoResult.summary, 'performance-user-bravo');
});
