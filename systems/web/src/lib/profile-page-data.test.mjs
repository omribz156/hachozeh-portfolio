import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfilePageData } from './profile-page-data.js';

test('invalid paths do no backend work; valid misses do exactly one lookup', async () => {
  const calls = []; const get = async (...args) => { calls.push(args); return null; };
  for (const path of ['.env', '../admin', 'a'.repeat(100), 'bad%2fpath']) await loadProfilePageData(path, get);
  assert.equal(calls.length, 0);
  await loadProfilePageData('unknown-user', get); assert.equal(calls.length, 0);
  await loadProfilePageData('unknown_user', get); assert.equal(calls.length, 1);
});
test('existing dot handles and legacy user ids preserve profile resources', async () => {
  for (const name of ['@test.user', 'test_user', 'user_00000000-0000-4000-8000-000000000001']) {
    const calls = []; const get = async (...args) => { calls.push(args); return {}; };
    await loadProfilePageData(name, get); assert.equal(calls.length, 4);
    assert.equal(calls[0][1], true); assert.equal(calls[1][1], undefined);
  }
});
