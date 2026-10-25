import type { TrafficSignal } from "../../../shared/security-traffic";

export async function sendSecurityAlert(signal: TrafficSignal, test = false): Promise<boolean> {
  const token = process.env.PLATFORM_ALERT_TELEGRAM_BOT_TOKEN;
  const chat = process.env.PLATFORM_ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.warn(JSON.stringify({ event: "security.alert.delivery_failed", reason: "not_configured", source: signal.source }));
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ chat_id: chat, text: [
        `[Hachozeh security${test ? " TEST" : ""}] ${signal.kind === "burst" ? "REQUEST BURST" : "RECOVERED"}`,
        `Service: ${signal.source}; category: ${signal.category ?? "requests"}`,
        `Requests: ${signal.requests}; 404/429/5xx: ${signal.rejected}; window: ${signal.windowSeconds}s`,
        ...(signal.notFound === undefined ? [] : [`Breakdown: 404=${signal.notFound}; 429=${signal.rateLimited}; 5xx=${signal.serverErrors}`]),
        `UTC: ${new Date().toISOString()}`,
        "Check Render security logs. Burst reminders: at most once per 10 minutes per service."
      ].join("\n") })
    });
    const body = await response.json() as { ok?: boolean };
    const delivered = response.ok && body.ok === true;
    console.info(JSON.stringify({ event: delivered ? "security.alert.delivered" : "security.alert.delivery_failed", source: signal.source, kind: signal.kind, category: signal.category ?? "requests", requests: signal.requests, notFound: signal.notFound, rateLimited: signal.rateLimited, serverErrors: signal.serverErrors, status: response.status }));
    return delivered;
  } catch {
    console.warn(JSON.stringify({ event: "security.alert.delivery_failed", reason: "transport", source: signal.source }));
    return false;
  }
}
