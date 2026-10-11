import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPublicHealth } from "./render-public-health-check.mjs";

const bodies = {
  "/edge/health": "ok",
  "/health/ready": JSON.stringify({ status: "ready", dependencies: { postgres: { ok: true } } }),
  "/api/session": JSON.stringify({ session: { authenticated: false } }),
  "/": "<html><article>market</article></html>"
};

test("requires actual DB readiness and populated SSR, not just 200", async () => {
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal);
    return new Response(bodies[url.pathname]);
  };
  assert.ok((await checkPublicHealth("https://example.test", fetcher)).every((row) => row.ok));
  for (const [path, body] of [["/health/ready", '{"status":"ready","dependencies":{"postgres":{"ok":false}}}'], ["/", "<html>fallback</html>"], ["/api/session", '{"session":{"authenticated":true}}']]) {
    const rows = await checkPublicHealth("https://example.test", async (url) => new Response(url.pathname === path ? body : bodies[url.pathname]));
    assert.equal(rows.find((row) => row.path === path).ok, false);
  }
});

test("rejects redirects, outages and malformed responses without leaking bodies", async () => {
  for (const response of [new Response("private", { status: 502 }), new Response("private", { status: 302 })]) {
    const rows = await checkPublicHealth("https://example.test", async () => response.clone());
    assert.ok(rows.every((row) => !row.ok));
    assert.ok(!JSON.stringify(rows).includes("private"));
  }
});
