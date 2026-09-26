#!/usr/bin/env node
/**
 * ci-proxy.mjs — lightweight HTTP reverse-proxy for CI.
 *
 * Replicates the local Caddyfile.mac-proof routing on port 8080:
 *   /api/*     → backend :3001
 *   /health*   → backend :3001
 *   everything → Astro  :4321
 *
 * Usage: node workspace/scripts/browser-qa/ci-proxy.mjs
 * ASTRO_BASE_URL in specs should point at http://127.0.0.1:8080
 */

import http from "node:http";

const PROXY_PORT = Number(process.env.CI_PROXY_PORT || 8080);
const ASTRO_PORT = Number(process.env.ASTRO_PORT || 4321);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3001);

function pickTarget(pathname) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/health")) {
    return { host: "127.0.0.1", port: BACKEND_PORT };
  }
  return { host: "127.0.0.1", port: ASTRO_PORT };
}

const server = http.createServer((req, res) => {
  const { host, port } = pickTarget(req.url ?? "/");
  const options = {
    hostname: host,
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${host}:${port}` },
  };

  const proxy = http.request(options, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res, { end: true });
  });

  proxy.on("error", (err) => {
    console.error(`[ci-proxy] upstream error → ${host}:${port}${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end(`upstream error: ${err.message}`);
  });

  req.pipe(proxy, { end: true });
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(
    `[ci-proxy] listening on http://127.0.0.1:${PROXY_PORT}  ` +
      `(→ astro :${ASTRO_PORT}, api/health → backend :${BACKEND_PORT})`
  );
});
