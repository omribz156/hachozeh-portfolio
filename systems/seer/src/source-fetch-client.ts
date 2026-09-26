export const SEER_HEARTBEAT_FETCH_OPTIONS = {
  headers: {
    "user-agent": "NaviSeerHeartbeat/1.0"
  }
} satisfies RequestInit;

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

function getFetchTimeoutMs(): number {
  const raw = process.env["SEER_FETCH_TIMEOUT_MS"];
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

export async function fetchSourceText(
  url: string,
  label: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getFetchTimeoutMs());

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...SEER_HEARTBEAT_FETCH_OPTIONS,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`${label} fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}
