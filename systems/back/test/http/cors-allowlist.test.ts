import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";
import { buildCorsHeaders, isCorsOriginAllowed } from "../../src/http/json";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;
const EXPECTED_CORS_VARY =
  "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

afterEach(async () => {
  await closeAppTestServers();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CORS_ALLOWED_ORIGINS == null) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_CORS_ALLOWED_ORIGINS;
  }
});

// CORS allowlist is enforced via preflight responses (OPTIONS), which is the
// primary browser enforcement point. The applyCorsHeaders helper that drives
// the allowlist is also called on JSON responses for routes that propagate the
// request object, but OPTIONS preflights are the cleanest harness-level hook.

describe("CORS allowlist", () => {
  it("reflects allowed origin with credentials on OPTIONS preflight", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "OPTIONS",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://hachozeh.com");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe(EXPECTED_CORS_VARY);
  });

  it("marks requested preflight headers as cache-varying", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "OPTIONS",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-request-id"
      }
    });

    expect(response.headers.get("access-control-allow-headers")).toBe("content-type,x-request-id");
    expect(response.headers.get("vary")).toBe(EXPECTED_CORS_VARY);
  });

  it("does not reflect unapproved preflight request headers", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "OPTIONS",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, x-evil, content-type"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://hachozeh.com");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("reflects allowed localhost origin with credentials on OPTIONS preflight", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:6969",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:6969");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("allows the CI browser proxy origin in development/test", () => {
    process.env.NODE_ENV = "test";
    delete process.env.CORS_ALLOWED_ORIGINS;

    expect(isCorsOriginAllowed("http://127.0.0.1:8080")).toBe(true);
    expect(isCorsOriginAllowed("http://localhost:8080")).toBe(true);
  });

  it("sets Vary but omits allow-origin and allow-credentials for disallowed origin", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.headers.get("vary")).toBe(EXPECTED_CORS_VARY);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("uses wildcard allow-origin when no Origin header is present (non-browser request)", async () => {
    const { baseUrl } = await startServer();

    // Raw http.request without an Origin header — simulates non-browser tooling.
    const { get } = await import("node:http");
    const acao = await new Promise<string | null>((resolve) => {
      get(`${baseUrl}/health/live`, (res) => {
        resolve(res.headers["access-control-allow-origin"] ?? null);
        res.resume();
      });
    });

    expect(acao).toBe("*");
  });

  it("does not allow dev or local origins by default in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ALLOWED_ORIGINS;

    expect(isCorsOriginAllowed("https://hachozeh.com")).toBe(true);
    expect(isCorsOriginAllowed("https://dev.hachozeh.com")).toBe(false);
    expect(isCorsOriginAllowed("http://127.0.0.1:6969")).toBe(false);
    expect(isCorsOriginAllowed("http://127.0.0.1:8080")).toBe(false);

    expect(
      buildCorsHeaders({
        headers: {
          origin: "https://dev.hachozeh.com"
        }
      })["access-control-allow-origin"]
    ).toBeUndefined();
  });

  it("allows production operators to opt into explicit extra origins", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "https://hachozeh.com,https://dev.hachozeh.com";

    expect(isCorsOriginAllowed("https://dev.hachozeh.com")).toBe(true);
  });
});
