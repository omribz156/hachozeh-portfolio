// One-shot: submit every URL in the live sitemap to IndexNow (Bing/Yahoo/DuckDuckGo/Yandex/…).
// Run once after the key file is deployed, then again whenever you want a full re-ping.
//   npx ts-node src/scripts/indexnow-bulk-submit.ts        (or the repo's script runner)
// Reads the LIVE sitemap over HTTP, so it reflects prod exactly. No DB access.

import { submitUrlsToIndexNow } from "../seo/indexnow-service";

const ORIGIN = (process.env["PUBLIC_SITE_ORIGIN"] ?? "https://hachozeh.com").replace(/\/+$/, "");

async function fetchLocs(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { accept: "application/xml" } });
  if (!res.ok) {
    console.error(`fetch ${url} → HTTP ${res.status}`);
    return [];
  }
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function main(): Promise<void> {
  // sitemap.xml is an index → its <loc>s are child sitemaps; expand each.
  const children = await fetchLocs(`${ORIGIN}/sitemap.xml`);
  const urls = new Set<string>();
  for (const child of children) {
    if (child.endsWith(".xml")) {
      for (const u of await fetchLocs(child)) {
        if (!u.endsWith(".xml") && !u.endsWith(".png")) urls.add(u);
      }
    } else if (!child.endsWith(".png")) {
      urls.add(child);
    }
  }

  const list = [...urls];
  console.log(`IndexNow: submitting ${list.length} URLs from ${ORIGIN}/sitemap.xml`);
  const result = await submitUrlsToIndexNow(list, console);
  console.log("IndexNow result:", result);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
