import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import { createTrafficMonitor } from "../../../shared/security-traffic";
import { takeRateLimitAuditSlot } from "../../src/observability/rate-limit-audit-budget";
import { createInMemoryRateLimiter } from "../../src/http/rate-limit";
import { sendSecurityAlert } from "../../src/observability/security-alert";
import { assertEmailAuthEnabled, hashOtp, matchesOtp, validateEmailChallengeToken } from "../../src/auth/session/email-security";
import { startAuthChallenge, verifyAuthChallenge } from "../../src/auth/session-service";
import type { AppEnv } from "../../src/config/env";
import type { Pool } from "pg";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const production = { nodeEnv: "production", publicBaseUrl: "https://example.com" } as AppEnv;

describe("security containment", () => {
  it("defaults production email to paused, including verification, without DB or mail work", async () => {
    vi.stubEnv("AUTH_EMAIL_ENABLED", "");
    const db = { query: vi.fn(), connect: vi.fn() } as unknown as Pool;
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(() => assertEmailAuthEnabled(production)).toThrow(/temporarily unavailable/);
    await expect(startAuthChallenge(db, production, { identifier: "synthetic@example.com" })).rejects.toMatchObject({ code: "email_auth_paused" });
    await expect(verifyAuthChallenge(db, production, {} as IncomingMessage, { challengeId: "otp_00000000-0000-4000-8000-000000000001", code: "123456" })).rejects.toMatchObject({ code: "email_auth_paused" });
    expect(db.query).not.toHaveBeenCalled(); expect(db.connect).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("binds OTP hashes to the challenge and secret", () => {
    vi.stubEnv("AUTH_OTP_HASH_SECRET", "synthetic-test-secret");
    const hash = hashOtp("123456", "a");
    expect(hash).toMatch(/^hmac:/);
    expect(matchesOtp(hash, "123456", "a")).toBe(true);
    expect(matchesOtp(hash, "123456", "b")).toBe(false);
    expect(matchesOtp(hash, "123457", "a")).toBe(false);
    vi.stubEnv("AUTH_OTP_HASH_SECRET", "different-secret");
    expect(matchesOtp(hash, "123456", "a")).toBe(false);
  });
  it("requires a valid server-verified hostname and action", async () => {
    vi.stubEnv("AUTH_EMAIL_ENABLED", "true"); vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(validateEmailChallengeToken({}, production)).rejects.toMatchObject({ code: "challenge_required" });
    expect(fetch).not.toHaveBeenCalled();
    for (const result of [{ success: false }, { success: true, hostname: "attacker.invalid", action: "email_auth" }, { success: true, hostname: "example.com", action: "wrong" }]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(result)));
      await expect(validateEmailChallengeToken({ turnstileToken: "test" }, production)).rejects.toMatchObject({ code: "challenge_failed" });
    }
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, hostname: "example.com", action: "email_auth" })));
    await expect(validateEmailChallengeToken({ turnstileToken: "test" }, production)).resolves.toBeUndefined();
  });
});

describe("bounded scan cost", () => {
  it("bounds denial audit writes across 17000 attacker-controlled identities", () => {
    const owner = {}; let accepted = 0;
    for (let i = 0; i < 17000; i++) accepted += Number(takeRateLimitAuditSlot(owner, "market_read", 1));
    expect(accepted).toBe(1);
    for (let i = 0; i < 1000; i++) accepted += Number(takeRateLimitAuditSlot(owner, `unexpected-${i}`, 1));
    expect(accepted).toBe(20);
    expect(takeRateLimitAuditSlot(owner, "market_read", 60001)).toBe(true);
  });
  it("caps bucket memory without resetting quota for rotating identities", () => {
    const limiter = createInMemoryRateLimiter({ market_read: { limit: 2, windowMs: 60000 } }, { maxBuckets: 10 });
    const request = (id: number) => ({ socket: { remoteAddress: `synthetic-${id}` }, headers: {} }) as IncomingMessage;
    let allowed = 0;
    for (let i = 0; i < 20000; i++) allowed += Number(limiter.check(request(i), "market_read").allowed);
    expect(limiter.readDiagnostics().bucketCount).toBe(10); expect(allowed).toBe(12);
    expect(limiter.check(request(0), "market_read").allowed).toBe(true);
    expect(limiter.check(request(0), "market_read").allowed).toBe(false);
  });
});

describe("Telegram incident delivery", () => {
  it("sends one burst, bounded reminders, and a quiet recovery", async () => {
    let now = 0; const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "web", now: () => now, send, threshold: 3 });
    for (let i = 0; i < 1000; i++) monitor.observe(404);
    await monitor.drain(); expect(send).toHaveBeenCalledTimes(1);
    now = 60000; for (let i = 0; i < 10; i++) monitor.observe(404);
    await monitor.drain(); expect(send).toHaveBeenCalledTimes(1);
    now = 180001; monitor.tick(); await monitor.drain();
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]?.[0]).toMatchObject({ kind: "recovery" });
  });
  it("retries a failed alert without consuming the successful-delivery cooldown", async () => {
    let now = 0; const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const monitor = createTrafficMonitor({ source: "backend", now: () => now, send, threshold: 1 });
    monitor.observe(); await monitor.drain(); now = 60001; monitor.observe(); await monitor.drain();
    expect(send).toHaveBeenCalledTimes(2); expect(monitor.snapshot().incident).toBe(true);
  });
  it("requires Telegram's acknowledgement and never logs its credential", async () => {
    vi.stubEnv("PLATFORM_ALERT_TELEGRAM_BOT_TOKEN", "synthetic-private-token"); vi.stubEnv("PLATFORM_ALERT_TELEGRAM_CHAT_ID", "test-chat");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":false}'));
    expect(await sendSecurityAlert({ source: "web", kind: "burst", requests: 600, rejected: 100, windowSeconds: 60 })).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-private-token");
  });
  it("retries a brief failed burst from the timer without more requests", async () => {
    let now = 0; const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const monitor = createTrafficMonitor({ source: "backend", now: () => now, send, threshold: 2 });
    monitor.observe(); monitor.observe(); await monitor.drain();
    now = 60001; monitor.tick(); await monitor.drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ kind: "burst", requests: 2 });
    now = 120002; monitor.tick(); await monitor.drain();
    expect(send.mock.calls[2]?.[0]).toMatchObject({ kind: "recovery" });
  });
  it("does not suppress a new incident with the previous incident cooldown", async () => {
    let now = 0; const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "backend", now: () => now, send, threshold: 1 });
    monitor.observe(); await monitor.drain();
    now = 120001; monitor.tick(); await monitor.drain();
    now = 180002; monitor.observe(); await monitor.drain();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toMatchObject({ kind: "burst" });
  });
});
