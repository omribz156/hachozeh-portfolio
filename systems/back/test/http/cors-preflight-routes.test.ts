import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

async function expectPreflight(
  path: string,
  requestMethod = "POST",
  origin = "http://127.0.0.1:6969"
): Promise<void> {
  const { baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": requestMethod,
      "access-control-request-headers": "content-type"
    }
  });

  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  expect(response.headers.get("access-control-allow-methods")).toContain(requestMethod);
}

describe("CORS preflight routes", () => {
  it("answers browser preflight for quote route", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/quote`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:6969",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:6969");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("answers browser preflight for trades route", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/trades`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:6969",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:6969");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("answers browser preflight for auth start route", async () => {
    await expectPreflight("/api/auth/start");
  });

  it("answers browser preflight for feedback route", async () => {
    await expectPreflight("/api/feedback");
  });

  it("answers browser preflight for account PATCH/PUT/DELETE routes", async () => {
    await expectPreflight("/api/me/profile", "PATCH");
    await expectPreflight("/api/me/notification-preferences", "PUT");
    await expectPreflight("/api/me/avatar", "DELETE");
  });

  it.each([
    "/admin/markets",
    "/admin/markets/market_seed_next_prime_minister/close",
    "/admin/markets/market_seed_next_prime_minister/publish",
    "/admin/markets/market_seed_next_prime_minister/resolve",
    "/admin/markets/market_seed_next_prime_minister/void"
  ])("answers browser preflight for admin market lifecycle route %s", async (path) => {
    await expectPreflight(path);
  });

  it.each([
    "/admin/users/user_target_1/lock",
    "/admin/users/user_target_1/unlock",
    "/admin/users/user_target_1/archive",
    "/admin/users/user_target_1/trade-block",
    "/admin/users/user_target_1/trade-restore",
    "/admin/users/user_target_1/sessions/revoke",
    "/admin/users/user_target_1/reverse-starter-grant"
  ])("answers browser preflight for admin user route %s", async (path) => {
    await expectPreflight(path);
  });

  it.each([
    "/admin/oracle/intake-candidate",
    "/admin/oracle/review-action",
    "/admin/oracle/approve-resolution-candidate"
  ])("answers browser preflight for admin Oracle mutation route %s", async (path) => {
    await expectPreflight(path);
  });
});
