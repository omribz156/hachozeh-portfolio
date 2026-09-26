// IndexNow — instantly notify Bing / Yahoo / DuckDuckGo / Yandex / Seznam of new or
// changed URLs, instead of waiting for a crawl. One ping reaches every participating
// engine. Best-effort + fire-and-forget: this must NEVER throw into a caller's path or
// block a lifecycle transaction.
//
// The key is PUBLIC by design (it's hosted at /{key}.txt so engines can verify us), so a
// constant default is fine; override via INDEXNOW_KEY if the hosted file ever rotates.
// The key file lives at systems/web/public/<key>.txt — keep the two in sync.

const INDEXNOW_KEY = process.env["INDEXNOW_KEY"] ?? "7d7b444e31ad8df76212414193c6e280";
const PUBLIC_ORIGIN = (
  process.env["PUBLIC_SITE_ORIGIN"] ??
  process.env["SITE_ORIGIN"] ??
  "https://hachozeh.com"
).replace(/\/+$/, "");
const HOST = (() => {
  try {
    return new URL(PUBLIC_ORIGIN).host;
  } catch {
    return "hachozeh.com";
  }
})();
const KEY_LOCATION = `${PUBLIC_ORIGIN}/${INDEXNOW_KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
// IndexNow accepts up to 10,000 URLs per request.
const MAX_URLS = 10000;

export type IndexNowResult = { ok: boolean; status?: number; count: number };
export type IndexNowLogger = { warn?: (msg: string, meta?: unknown) => void };

export function buildAbsolutePublicUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_ORIGIN}${normalizedPath}`;
}

/**
 * Submit a batch of absolute URLs to IndexNow. Returns a result (never throws) so scripts
 * can report; lifecycle hooks should use `pingIndexNow` instead.
 */
export async function submitUrlsToIndexNow(
  urls: string[],
  logger?: IndexNowLogger
): Promise<IndexNowResult> {
  const urlList = [...new Set((urls ?? []).filter((u) => typeof u === "string" && u.startsWith("https://")))].slice(
    0,
    MAX_URLS
  );
  if (!urlList.length) {
    return { ok: true, count: 0 };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION, urlList })
    });
    if (!res.ok) {
      logger?.warn?.("indexnow.submit_non_ok", { status: res.status, count: urlList.length });
    }
    return { ok: res.ok, status: res.status, count: urlList.length };
  } catch (error) {
    logger?.warn?.("indexnow.submit_failed", { error: String(error), count: urlList.length });
    return { ok: false, count: urlList.length };
  }
}

/**
 * Fire-and-forget ping for lifecycle hooks (market publish / resolve). Never awaited, never
 * throws — a search-ping failure must not affect the trade/lifecycle path.
 */
export function pingIndexNow(urls: string[], logger?: IndexNowLogger): void {
  void submitUrlsToIndexNow(urls, logger).catch((error) => {
    logger?.warn?.("indexnow.submit_failed", { error: String(error), count: urls.length });
  });
}
