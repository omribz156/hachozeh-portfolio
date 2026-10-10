import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseTls, readDbTlsMode } from "../../src/db/client/tls";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { PeerCertificate } from "node:tls";
const certificate = readFileSync(new URL("../fixtures/synthetic-db-cert.pem", import.meta.url), "utf8");

afterEach(() => vi.unstubAllEnvs());

describe("database transport", () => {
  it("keeps local socket/plaintext mode explicit and validates modes", () => {
    vi.stubEnv("DB_TLS_MODE", "");
    expect(readDbTlsMode()).toBe("disable");
    expect(databaseTls("localhost")).toBe(false);
    vi.stubEnv("DB_TLS_MODE", "prefer");
    expect(() => readDbTlsMode()).toThrow("DB_TLS_MODE");
  });
  it("verifies certificates for ordinary TLS connections", () => {
    vi.stubEnv("DB_TLS_MODE", "verify-full");
    expect(readDbTlsMode()).toBe("verify-full");
    expect(databaseTls("postgres.example.com", "verify-full"))
      .toEqual({ rejectUnauthorized: true, minVersion: "TLSv1.2" });
  });
  it("requires TLS without plaintext fallback for Render private connections", () => {
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("DEPLOY_PROVIDER", "render");
    vi.stubEnv("DB_TLS_CA_PEM", certificate);
    const options = databaseTls("dpg-synthetic123-a", "render-internal");
    expect(options).toMatchObject({ rejectUnauthorized: true, minVersion: "TLSv1.2", ca: certificate });
    if (!options) throw new Error("TLS is disabled");
    expect(options.checkServerIdentity?.("dpg-synthetic123-a", { fingerprint256: new X509Certificate(certificate).fingerprint256 } as PeerCertificate)).toBeUndefined();
    expect(options.checkServerIdentity?.("dpg-synthetic123-a", { fingerprint256: "different certificate" } as PeerCertificate)).toBeInstanceOf(Error);
  });
  it("fails closed without the certificate pin", () => {
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("DEPLOY_PROVIDER", "render");
    vi.stubEnv("DB_TLS_CA_PEM", "");
    expect(() => databaseTls("dpg-example-a", "render-internal")).toThrow("certificate pin");
  });
  it.each(["localhost", "10.0.0.1", "dpg-example-a.render.com", "dpg-example-a.evil.test", "dpg-example-a\n"])(
    "rejects Render certificate exception for %s", (host) => {
      vi.stubEnv("RENDER", "true");
      vi.stubEnv("DEPLOY_PROVIDER", "render");
      expect(() => databaseTls(host, "render-internal")).toThrow("private Postgres");
    }
  );
  it("rejects the Render exception outside Render", () => {
    vi.stubEnv("RENDER", "false");
    vi.stubEnv("DEPLOY_PROVIDER", "render");
    expect(() => databaseTls("dpg-example-a", "render-internal")).toThrow("private Postgres");
  });
});
