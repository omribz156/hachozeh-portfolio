import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./platform-alert.sh', import.meta.url));
for (const guard of [{ NODE_ENV: 'test' }, { VITEST: 'true' }]) {
  test(`test environment cannot send Telegram: ${Object.keys(guard)[0]}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'alert-isolation-'));
    try {
      const marker = join(dir, 'network-called');
      writeFileSync(join(dir, 'curl'), '#!/bin/sh\ntouch "$ALERT_TEST_MARKER"\nprintf 200\n', { mode: 0o700 });
      const result = spawnSync('bash', [script, '--require-delivery', 'send', 'synthetic failure'], {
        encoding: 'utf8',
        env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, NODE_ENV: 'production',
          PLATFORM_ALERT_TELEGRAM_BOT_TOKEN: 'synthetic', PLATFORM_ALERT_TELEGRAM_CHAT_ID: 'synthetic',
          ALERT_TEST_MARKER: marker, ...guard },
      });
      assert.equal(existsSync(marker), false, 'must not invoke curl');
      assert.notEqual(result.status, 0, 'suppression must not be recorded as delivered');
      assert.match(result.stderr, /test environment/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
