import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REVIEW_UNTIL = '2026-11-10T00:00:00Z';
const TOOLCHAIN_PACKAGES = new Set(['braces', 'chokidar', 'depcheck', 'fast-glob',
  'findup-sync', 'micromatch', 'tailwindcss']);
const REVIEWED_ADVISORIES = new Set([
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'
]);

export function checkDependencyAudit(report, lock, now = Date.now()) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !lock.packages) {
    throw new Error('Invalid or incomplete npm audit evidence');
  }
  const reviewed = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (now >= Date.parse(REVIEW_UNTIL)) throw new Error('Development dependency review expired');
    if (!TOOLCHAIN_PACKAGES.has(name) || !finding.nodes?.length ||
        finding.nodes.some(node => lock.packages[node]?.dev !== true)) {
      throw new Error(`Unreviewed or production dependency vulnerability: ${name}`);
    }
    if (!finding.via?.length) throw new Error(`Missing advisory evidence: ${name}`);
    for (const via of finding.via) {
      if (typeof via === 'string') {
        if (!report.vulnerabilities[via]) throw new Error(`Missing transitive finding: ${via}`);
      } else if (!REVIEWED_ADVISORIES.has(via.url)) {
        throw new Error(`Unreviewed advisory for ${name}`);
      }
    }
    reviewed.push(name);
  }
  return { reviewedDevelopmentPackages: reviewed, reviewUntil: REVIEW_UNTIL };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    if (![0, 1].includes(run.status) || run.error) throw new Error('npm audit did not complete');
    const result = checkDependencyAudit(JSON.parse(run.stdout), JSON.parse(fs.readFileSync('package-lock.json', 'utf8')));
    console.log(JSON.stringify(result));
    console.log('Production/unreviewed advisories: zero. Known dev-only advisories are NOT fixed; see dependency-review.md.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
