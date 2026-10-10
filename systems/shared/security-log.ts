import { createHmac, randomBytes } from "node:crypto";

const key = process.env.SECURITY_LOG_HASH_SECRET || process.env.HACHOZEH_PROXY_SECRET || randomBytes(32).toString("hex");
export function securityFingerprint(value: string): string {
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 24);
}

/** Allowlisted fields only. Request/body/header objects must never reach this API. */
export function securityLog(event: string, fields: Record<string, string | number | boolean | null>) {
  console.info(JSON.stringify({ event, at: new Date().toISOString(), revision: process.env.RENDER_GIT_COMMIT || "local", ...fields }));
}

export function createAccessLogBudget(source: string, now = Date.now) {
  let start = now(); let emitted = 0; let suppressed = 0;
  function flush() {
    if (now() - start < 60000) return;
    if (suppressed) securityLog("security.access.aggregated", { source, emitted, suppressed, windowStart: new Date(start).toISOString() });
    start = now(); emitted = 0; suppressed = 0;
  }
  return {
    flush,
    allow() {
      flush();
      if (emitted >= 600) { suppressed += 1; return false; }
      emitted += 1; return true;
    }
  };
}
