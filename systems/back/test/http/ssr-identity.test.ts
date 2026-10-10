import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("isolates concurrent SSR visitor identity and cookies; rejects forged trust and external destinations", async () => {
  vi.stubEnv("HACHOZEH_PROXY_SECRET", "synthetic-ssr-secret");
  const { withBackendRequest, backendFetch, trustedRequestHeaders } = await import("../../../web/src/lib/server-security");
  const records: Array<{ url: string; headers: Headers }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init?.redirect).toBe("error");
    records.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response('{}');
  });
  const req = (ip: string, secret = "synthetic-ssr-secret") => new Request("https://example.com/test", { headers: { "x-forwarded-for": ip, "x-hachozeh-proxy-secret": secret } });
  expect(trustedRequestHeaders(req("203.0.113.1", "forged")).has("x-forwarded-for")).toBe(false);
  expect(trustedRequestHeaders(req("not-an-ip")).has("x-forwarded-for")).toBe(false);
  await Promise.all(["203.0.113.1", "203.0.113.2"].map((ip) => withBackendRequest(req(ip), async () => {
    await Promise.resolve();
    await backendFetch("/api/session", { redirect: "follow", headers: { cookie: `test=${ip}`, "x-forwarded-for": "forged", "x-hachozeh-proxy-secret": "forged" } });
  })));
  for (const record of records) {
    expect(record.headers.get("cookie")).toBe(`test=${record.headers.get("x-forwarded-for")}`);
    expect(record.headers.get("x-hachozeh-proxy-secret")).toBe("synthetic-ssr-secret");
  }
  expect(() => backendFetch("https://attacker.invalid/")).toThrow(/Unexpected backend origin/);
});
