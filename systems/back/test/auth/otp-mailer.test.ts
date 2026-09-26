import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../src/config/env";
import { sendAuthOtpEmail } from "../../src/auth/session/otp-mailer";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "info",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111",
    devOtpExposed: true
  },
  mail: {
    resendApiKey: "re_test_key",
    from: "Hachozeh <noreply@email.hachozeh.com>"
  },
  actorMode: {
    demoEnabled: false,
    demoActorId: "seed_user_1"
  },
  trading: {
    requireSession: false
  },
  publicBaseUrl: "http://beta.local",
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500
  }
};

const SEND_INPUT = {
  identifier: "user@example.com",
  code: "123456",
  purpose: "login" as const,
  expiresAt: new Date("2026-06-11T12:00:00Z")
};

function envWith(overrides: {
  nodeEnv?: AppEnv["nodeEnv"];
  devOtpExposed?: boolean;
  resendApiKey?: string;
}): AppEnv {
  return {
    ...BASE_ENV,
    nodeEnv: overrides.nodeEnv ?? BASE_ENV.nodeEnv,
    auth: {
      ...BASE_ENV.auth,
      devOtpExposed: overrides.devOtpExposed ?? BASE_ENV.auth.devOtpExposed
    },
    mail: {
      ...BASE_ENV.mail,
      resendApiKey: overrides.resendApiKey ?? BASE_ENV.mail.resendApiKey
    }
  };
}

describe("sendAuthOtpEmail provider gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips the Resend call entirely when the dev OTP is exposed, even with a configured key", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("provider must not be called in dev-exposed posture");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAuthOtpEmail(
      envWith({ devOtpExposed: true, resendApiKey: "re_test_key" }),
      SEND_INPUT
    );

    expect(result).toEqual({ provider: "dev", messageId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls Resend when the dev OTP is not exposed and a key is configured", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "msg_1" })
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAuthOtpEmail(
      envWith({ devOtpExposed: false, resendApiKey: "re_test_key" }),
      SEND_INPUT
    );

    expect(result).toEqual({ provider: "resend", messageId: "msg_1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });

  it("cannot skip delivery via the flag in production — isDevOtpExposed is hard-false there", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "msg_2" })
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAuthOtpEmail(
      envWith({ nodeEnv: "production", devOtpExposed: true, resendApiKey: "re_test_key" }),
      SEND_INPUT
    );

    expect(result).toEqual({ provider: "resend", messageId: "msg_2" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the dev provider when no key is configured at all", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("no provider configured — must not fetch");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAuthOtpEmail(
      envWith({ devOtpExposed: false, resendApiKey: "" }),
      SEND_INPUT
    );

    expect(result).toEqual({ provider: "dev", messageId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
