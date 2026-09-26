import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { resolveClientIp } from "../../src/http/client-ip";

function makeRequest(socketAddr: string, xff?: string, proxySecret?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (xff) headers["x-forwarded-for"] = xff;
  if (proxySecret) headers["x-hachozeh-proxy-secret"] = proxySecret;

  return {
    socket: { remoteAddress: socketAddr } as Socket,
    headers,
  } as unknown as IncomingMessage;
}

describe("resolveClientIp", () => {
  it("uses first XFF token when socket peer is a trusted loopback proxy (127.0.0.1)", () => {
    const request = makeRequest("127.0.0.1", "203.0.113.5, 10.0.0.1");

    expect(resolveClientIp(request)).toBe("203.0.113.5");
  });

  it("uses first XFF token when socket peer is the IPv6 loopback trusted address (::1)", () => {
    const request = makeRequest("::1", "198.51.100.7");

    expect(resolveClientIp(request)).toBe("198.51.100.7");
  });

  it("uses first XFF token when socket peer is IPv4-mapped loopback (::ffff:127.0.0.1)", () => {
    const request = makeRequest("::ffff:127.0.0.1", "198.51.100.99");

    expect(resolveClientIp(request)).toBe("198.51.100.99");
  });

  it("trims and accepts a valid XFF token from a trusted proxy", () => {
    const request = makeRequest("127.0.0.1", " 203.0.113.8 , 10.0.0.1");

    expect(resolveClientIp(request)).toBe("203.0.113.8");
  });

  it("uses first XFF token behind an authenticated non-loopback peer", () => {
    const requestA = makeRequest("45.77.10.20", "203.0.113.5, 10.0.0.1", "gateway-shared-secret");
    const requestB = makeRequest("45.77.10.20", "198.51.100.7, 10.0.0.1", "gateway-shared-secret");

    expect(resolveClientIp(requestA, "gateway-shared-secret")).toBe("203.0.113.5");
    expect(resolveClientIp(requestB, "gateway-shared-secret")).toBe("198.51.100.7");
  });

  it("ignores XFF for a non-loopback peer when credential is missing", () => {
    const request = makeRequest("45.77.10.20", "203.0.113.5");

    expect(resolveClientIp(request)).toBe("45.77.10.20");
  });

  it("ignores XFF for a non-loopback peer when credential is wrong", () => {
    const request = makeRequest("45.77.10.20", "203.0.113.5", "gateway-wrong-secret");

    expect(resolveClientIp(request, "gateway-shared-secret")).toBe("45.77.10.20");
  });

  it("falls back to peer on malformed XFF when credential matches", () => {
    const request = makeRequest("45.77.10.20", "not-an-ip, 203.0.113.5", "gateway-shared-secret");

    expect(resolveClientIp(request, "gateway-shared-secret")).toBe("45.77.10.20");
  });

  it("ignores malformed XFF tokens from trusted proxies", () => {
    const request = makeRequest("127.0.0.1", "not-an-ip, 203.0.113.5");

    expect(resolveClientIp(request)).toBe("127.0.0.1");
  });

  it("ignores XFF and returns socket address when peer is not a trusted proxy", () => {
    const request = makeRequest("45.77.10.20", "203.0.113.5");

    expect(resolveClientIp(request)).toBe("45.77.10.20");
  });

  it("returns socket address when trusted proxy sends no XFF header", () => {
    const request = makeRequest("127.0.0.1");

    expect(resolveClientIp(request)).toBe("127.0.0.1");
  });

  it("falls back to 'unknown' when socket address is missing", () => {
    const request = makeRequest("");

    expect(resolveClientIp(request)).toBe("unknown");
  });
});
