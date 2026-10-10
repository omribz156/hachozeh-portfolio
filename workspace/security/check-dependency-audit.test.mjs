import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDependencyAudit } from './check-dependency-audit.mjs';
const now = Date.parse('2026-10-11T00:00:00Z');
const report = () => ({ auditReportVersion: 2, vulnerabilities: {
  braces: { nodes: ['node_modules/braces'], via: [{ url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }] }
} });
const lock = () => ({ packages: { 'node_modules/braces': { dev: true } } });
test('allows only the time-bounded, named development review', () => {
  assert.deepEqual(checkDependencyAudit(report(), lock(), now).reviewedDevelopmentPackages, ['braces']);
});
test('never allows the same package in production', () => {
  const l = lock(); l.packages['node_modules/braces'].dev = false;
  assert.throws(() => checkDependencyAudit(report(), l, now), /production/);
});
test('fails new advisories, incomplete scans and expired review', () => {
  const r = report(); r.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/NEW';
  assert.throws(() => checkDependencyAudit(r, lock(), now), /Unreviewed/);
  assert.throws(() => checkDependencyAudit({ error: {} }, lock(), now), /incomplete/);
  assert.throws(() => checkDependencyAudit(report(), lock(), Date.parse('2026-11-11')), /expired/);
});
