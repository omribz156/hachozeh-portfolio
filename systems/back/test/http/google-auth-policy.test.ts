import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AppEnv } from "../../src/config/env";
import type { Logger } from "../../src/shared/logger";
import { AuthSessionError } from "../../src/auth/session/errors";
import { registerGoogleAuthRoutes } from "../../src/http/routes/google-auth";

vi.mock("../../src/auth/google-oauth-service", () => ({
  buildGoogleAuthStartRedirect: vi.fn(),
  completeGoogleAuthCallback: vi.fn(async () => {
    throw new AuthSessionError(403, "email_domain_not_allowed", "Gmail required.");
  }),
  readGoogleAuthStateReturnTo: vi.fn(() => "https://app.example/markets/test")
}));

describe("Google Gmail-only rejection", () => {
  it("redirects to the signed return location with an error and no session cookie", async () => {
    const app = Fastify();
    registerGoogleAuthRoutes(app, {
      dbPool: {} as Pool,
      env: { publicBaseUrl: "https://app.example" } as AppEnv,
      logger: { error: vi.fn() } as unknown as Logger
    });
    try {
      const response = await app.inject("/api/auth/google/callback?code=test&state=signed-test");
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://app.example/markets/test?auth_error=google&auth_error_code=email_domain_not_allowed");
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
