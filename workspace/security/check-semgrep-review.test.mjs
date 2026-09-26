import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyReview } from './check-semgrep-review.mjs';
const source = 'safe source';
const review = { sourceHashes: { 'source.js': createHash('sha256').update(source).digest('hex') },
  findings: [{ path: 'source.js', line: 1, rule: 'audit-html' }] };
const report = () => ({ errors: [], paths: { scanned: Array.from({ length: 101 }, (_, i) => `${i}.js`) },
  results: [{ path: 'source.js', start: { line: 1 }, check_id: 'audit-html' }] });
test('accepts only reviewed findings against unchanged source', () => verifyReview(report(), review, () => source));
test('rejects changed source', () => assert.throws(() => verifyReview(report(), review, () => 'changed'), /stale/));
test('rejects a new finding', () => {
  const r = report(); r.results[0].start.line = 2;
  assert.throws(() => verifyReview(r, review, () => source), /Unreviewed/);
});
test('rejects scanner errors and empty scope', () => {
  const r = report(); r.errors.push({ message: 'scan error' });
  assert.throws(() => verifyReview(r, review, () => source), /failed/);
  r.errors = []; r.paths.scanned = [];
  assert.throws(() => verifyReview(r, review, () => source), /partial/);
});
