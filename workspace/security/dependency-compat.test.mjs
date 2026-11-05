import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { glob } from 'glob';

const require = createRequire(import.meta.url);

test('patched glob preserves the Sentry build-tool API', async () => {
  const files = await glob('systems/web/showcase/src/**/*.astro', { nodir: true });
  assert.ok(files.includes('systems/web/showcase/src/components/Chart.astro'));
  const controller = new AbortController();
  controller.abort(new Error('bounded traversal'));
  await assert.rejects(glob('**/*', { signal: controller.signal }));
});

test('depcheck retains its callable minimatch API outside affected versions', () => {
  const fromDepcheck = createRequire(require.resolve('depcheck'));
  const match = fromDepcheck('minimatch');
  assert.equal(typeof match, 'function');
  assert.ok(match('app.ts', '*.ts'));
  assert.ok(match('src/example.tsx', '**/*.{ts,tsx}'));
  assert.equal(match('app.js', '*.ts'), false);
});

test('TypeScript dependency parser retains named minimatch API', () => {
  const fromParser = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
  const { minimatch } = fromParser('minimatch');
  assert.ok(minimatch('/project/src/file.ts', '**/*.ts', { dot: true }));
});
