import { describe, expect, it, vi } from "vitest";
import { runProductionSecuritySmoke } from "../../src/scripts/prod-security-smoke";

const safeHeaders = {
  "x-frame-options": "DENY", "x-content-type-options": "nosniff",
  "content-security-policy": "frame-ancestors 'none'", "strict-transport-security": "max-age=31536000"
};
function responses() {
  return [
    new Response("page", { headers: safeHeaders }),
    new Response("{}", { status: 401, headers: { "cache-control": "no-store" } }),
    Response.json({ session: { authenticated: false } }, { headers: { "x-rate-limit-family": "session_read" } }),
    new Response("{}", { status: 401 }),
    new Response("{}", { status: 404, headers: { "x-rate-limit-family": "general_request" } })
  ];
}
function fetchQueue(queue: Response[]) {
  return vi.fn(async () => queue.shift()!) as unknown as typeof fetch;
}
describe("production security smoke", () => {
  it("passes correct responses with bounded, non-redirecting requests", async () => {
    const fetcher = fetchQueue(responses());
    expect((await runProductionSecuritySmoke("https://example.test", false, fetcher)).every(r => r.ok)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://example.test/", expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
  });
  it.each([0, 1, 2, 4])("fails unexpected response %i rather than reporting success text", async (index) => {
    const queue = responses();
    queue[index] = new Response("{}", { status: 500 });
    const results = await runProductionSecuritySmoke("https://example.test", false, fetchQueue(queue));
    expect(results.some(r => !r.ok)).toBe(true);
  });
  it("fails an untrusted CORS grant", async () => {
    const queue = responses();
    queue[3] = new Response("{}", { headers: { "access-control-allow-origin": "https://evil.example" } });
    expect((await runProductionSecuritySmoke("https://example.test", false, fetchQueue(queue))).find(r => r.name.includes("CORS"))?.ok).toBe(false);
  });
  it("fails redirects, missing headers and malformed session data", async () => {
    const queue = responses();
    queue[0] = new Response(null, { status: 302, headers: safeHeaders });
    queue[1] = new Response("{}", { status: 401 });
    queue[2] = new Response("not json");
    expect((await runProductionSecuritySmoke("https://example.test", false, fetchQueue(queue))).filter(r => !r.ok)).toHaveLength(3);
  });
  it("fails transport errors and insecure base URLs", async () => {
    const fetcher = vi.fn(async () => { throw new Error("connection failed"); }) as typeof fetch;
    const results = await runProductionSecuritySmoke("http://example.test", false, fetcher);
    expect(results.every(r => !r.ok)).toBe(true);
  });
});
