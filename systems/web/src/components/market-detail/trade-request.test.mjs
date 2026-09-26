import assert from 'node:assert/strict';
import test from 'node:test';

import { postJSON } from './trade-request.js';

function mockResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
  };
}

test('network timeout rejects and does not add a backend error code', async () => {
  const neverResolve = (_url, init) => {
    return new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason || new Error('request aborted'));
        return;
      }
      const handleAbort = () => reject(init?.signal?.reason);
      init?.signal?.addEventListener('abort', handleAbort, { once: true });
    });
  };
  await assert.rejects(
    () => postJSON('/api/test', {}, 20, neverResolve),
    (err) => {
      assert.equal(err?.code, undefined);
      assert.equal(Object.prototype.hasOwnProperty.call(err ?? {}, 'code'), false);
      assert.equal(['AbortError', 'TimeoutError'].includes(err?.name), true);
      return true;
    },
  );
});

test('structured backend rejection keeps its code and message', async () => {
  const fakeFetch = () => Promise.resolve(
    mockResponse({
      error: {
        code: 'market_state_changed',
        message: 'state changed during request',
      },
    }, { ok: false, status: 409 }),
  );
  await assert.rejects(
    () => postJSON('/api/test', {}, 200, fakeFetch),
    (err) => {
      assert.equal(err.code, 'market_state_changed');
      assert.equal(err.message, 'state changed during request');
      return true;
    },
  );
});

test('successful payload is parsed and returned', async () => {
  const payload = { quoteId: 'q-1', averagePrice: 0.55 };
  const fakeFetch = () => Promise.resolve(mockResponse(payload));
  const result = await postJSON('/api/test', { amount: 10 }, 200, fakeFetch);
  assert.deepEqual(result, payload);
});

test('fetch is called once and never retried', async () => {
  let calls = 0;
  const fakeFetch = () => {
    calls += 1;
    return Promise.resolve(mockResponse({ quoteId: 'q-2', averagePrice: 0.11 }));
  };
  await postJSON('/api/test', { amount: 10 }, 200, fakeFetch);
  assert.equal(calls, 1);
});
