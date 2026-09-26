import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function verifyReview(report, review, readSource) {
  if (!Array.isArray(report.results) || !Array.isArray(report.errors) || report.errors.length) {
    throw new Error('Semgrep scan failed or reported errors; review cannot pass.');
  }
  if (!Array.isArray(report.paths?.scanned) || report.paths.scanned.length < 100) {
    throw new Error('Unexpectedly small source scan; refusing a partial result.');
  }
  for (const [file, hash] of Object.entries(review.sourceHashes)) {
    if (createHash('sha256').update(readSource(file)).digest('hex') !== hash) {
      throw new Error(`Security review is stale: ${file}`);
    }
  }
  const remaining = new Set(review.findings.map(f => `${f.path}:${f.line}:${f.rule}`));
  for (const finding of report.results) {
    const key = `${finding.path}:${finding.start.line}:${finding.check_id}`;
    if (!remaining.delete(key)) throw new Error(`Unreviewed security finding: ${key}`);
  }
  console.log(`Semgrep: ${report.paths.scanned.length} files scanned; ${report.results.length} exact reviewed findings; no unreviewed findings.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const review = JSON.parse(fs.readFileSync(new URL('./semgrep-reviewed.json', import.meta.url), 'utf8'));
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  verifyReview(report, review, p => fs.readFileSync(path.join(root, p)));
}
