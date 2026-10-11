import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkPublicHealth(baseUrl, fetcher = fetch) {
  const results = [];
  for (const path of ["/edge/health", "/health/ready", "/api/session", "/"]) {
    const started = performance.now();
    try {
      const response = await fetcher(new URL(path, baseUrl), {
        redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "cache-control": "no-cache" }
      });
      const body = await response.text();
      let ok = response.status === 200;
      if (path === "/health/ready") {
        const value = JSON.parse(body);
        ok &&= value.status === "ready" && value.dependencies?.postgres?.ok === true;
      } else if (path === "/api/session") {
        ok &&= JSON.parse(body).session?.authenticated === false;
      } else if (path === "/") {
        ok &&= /<html\b/i.test(body) && /<article\b/i.test(body);
      } else {
        ok &&= body.trim() === "ok";
      }
      results.push({ path, ok, status: response.status, durationMs: Math.round(performance.now() - started) });
    } catch {
      results.push({ path, ok: false, error: "transport_or_invalid_response", durationMs: Math.round(performance.now() - started) });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const origin of ["https://example.com", "https://your-gateway.onrender.com"]) {
    const checks = await checkPublicHealth(origin);
    console.log(JSON.stringify({ at: new Date().toISOString(), origin, checks }));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  }
}
