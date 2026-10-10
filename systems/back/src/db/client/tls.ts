import type { ConnectionOptions } from "node:tls";
import { X509Certificate } from "node:crypto";

export type DbTlsMode = "disable" | "verify-full" | "render-internal";

export function readDbTlsMode(): DbTlsMode {
  const mode = process.env.DB_TLS_MODE?.trim() || "disable";
  if (mode !== "disable" && mode !== "verify-full" && mode !== "render-internal") {
    throw new Error("Invalid DB_TLS_MODE");
  }
  return mode;
}

export function databaseTls(host: string, mode: DbTlsMode = "disable"): false | ConnectionOptions {
  if (mode === "disable") return false;
  if (mode === "verify-full") return { rejectUnauthorized: true, minVersion: "TLSv1.2" };
  // Render's private certificate lacks a DNS SAN. Pin its exact certificate
  // identity instead; OpenSSL still verifies the chain and certificate lifetime.
  if (process.env.RENDER !== "true" || process.env.DEPLOY_PROVIDER !== "render" ||
      !/^dpg-[a-z0-9]+-a$/.test(host) || !host.endsWith("-a")) {
    throw new Error("render-internal TLS requires a Render private Postgres endpoint");
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(process.env.DB_TLS_CA_PEM || "");
  } catch {
    throw new Error("render-internal TLS requires a valid DB_TLS_CA_PEM certificate pin");
  }
  return {
    ca: certificate.toString(),
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    checkServerIdentity: (_host, peer) => peer.fingerprint256 === certificate.fingerprint256
      ? undefined : new Error("Database TLS certificate pin mismatch")
  };
}
