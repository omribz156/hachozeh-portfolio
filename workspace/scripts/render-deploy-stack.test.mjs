import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const target of ["--backend", "--web"]) {
  test(`${target} includes ordered gateway recovery and public verification`, () => {
    const dir = mkdtempSync(join(tmpdir(), "hachozeh-deploy-test-"));
    try {
      const result = spawnSync("bash", ["workspace/scripts/render-deploy-stack.sh", target, "--dry-run", "--run-dir", dir], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const summary = readFileSync(join(dir, "summary.txt"), "utf8");
      assert.ok(summary.indexOf(`${target.slice(2)}|`) < summary.indexOf("gateway|"));
      assert.match(summary, /gateway\|.*\|planned\|/);
      assert.match(summary, /smoke\|https:\/\/example.com\//);
      assert.match(result.stdout, /Waiting 100s/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("rejects unsafe handover delay before any provider calls", () => {
  const result = spawnSync("bash", ["workspace/scripts/render-deploy-stack.sh", "--web"], {
    encoding: "utf8", env: { ...process.env, RENDER_HANDOVER_WAIT_SECONDS: "1" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /at least 90 seconds/);
});
