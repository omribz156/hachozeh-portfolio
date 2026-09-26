import type { IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_TRUSTED_PROXY_ADDRS = "127.0.0.1,::1,::ffff:127.0.0.1";
const PROXY_TRUST_HEADER = "x-hachozeh-proxy-secret";
const PROXY_TRUST_ENV = "HACHOZEH_PROXY_SECRET";

function readTrustedProxyAddrs(): Set<string> {
  const raw = process.env["TRUSTED_PROXY_ADDRS"] ?? DEFAULT_TRUSTED_PROXY_ADDRS;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Evaluated once at module load; env is stable by the time the server starts.
const TRUSTED_PROXY_ADDRS = readTrustedProxyAddrs();

function getFirstXForwardedFor(request: IncomingMessage): string | undefined {
  const raw = request.headers["x-forwarded-for"];
  if (typeof raw === "string") return raw.split(",")[0]?.trim();
  if (Array.isArray(raw)) return raw[0]?.split(",")[0]?.trim();
  return undefined;
}

function hasTrustedProxySecret(request: IncomingMessage, configuredSecret: string): boolean {
  if (!configuredSecret) return false;

  const supplied = request.headers[PROXY_TRUST_HEADER];
  if (typeof supplied !== "string") return false;

  const secretFromGateway = supplied.trim();
  if (!secretFromGateway) return false;

  const expected = createHash("sha256").update(configuredSecret).digest();
  const suppliedHash = createHash("sha256").update(secretFromGateway).digest();
  return timingSafeEqual(expected, suppliedHash);
}

/**
 * Returns the real client IP for a request.
 *
 * Trusts X-Forwarded-For only when the immediate socket peer is a known
 * trusted proxy (TRUSTED_PROXY_ADDRS env, defaults to loopback addresses).
 * Otherwise returns socket.remoteAddress directly.
 *
 * Exported so auth/session code can adopt this helper when it is updated.
 */
export function resolveClientIp(
  request: IncomingMessage,
  configuredProxySecret = process.env[PROXY_TRUST_ENV] ?? ""
): string {
  const socketAddr = request.socket.remoteAddress ?? "";
  const normalizedSocketAddr = socketAddr || "unknown";
  const xff = getFirstXForwardedFor(request);
  const peerIsTrustedLoopback = TRUSTED_PROXY_ADDRS.has(socketAddr);
  const proxyIsConfigured = Boolean(configuredProxySecret);
  const trustBySecret =
    proxyIsConfigured && hasTrustedProxySecret(request, configuredProxySecret);
  const trustByPeer = peerIsTrustedLoopback;
  const shouldTrustXff = trustByPeer || trustBySecret;

  if (shouldTrustXff && xff && isIP(xff) !== 0) {
    return xff;
  }

  return normalizedSocketAddr;
}
