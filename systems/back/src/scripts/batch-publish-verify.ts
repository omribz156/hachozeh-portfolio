import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { Command } from "commander";

import { inferRepoRoot } from "./script-args";

type Options = {
  snapshot?: string;
  draft?: string[];
  publicBaseUrl?: string;
  json?: boolean;
};

type DraftItem = {
  creationDraftId?: string;
  candidateMarketId?: string;
  title?: string;
  closeAt?: string;
  categoryKey?: string;
  marketContract?: {
    resolutionSource?: {
      label?: string;
      url?: string;
    };
  };
};

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

async function fetchJson(baseUrl: string, path: string): Promise<{ status: number; ok: boolean; json: Record<string, unknown> | null }> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`);
  if (!response.ok) {
    return { status: response.status, ok: false, json: null };
  }
  return { status: response.status, ok: true, json: await response.json() as Record<string, unknown> };
}

function readMarketFromJson(json: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!json) return null;
  const nested = json.market;
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : json;
}

async function fetchMarket(baseUrl: string, marketId: string): Promise<{ status: number; ok: boolean; title: string | null; marketStatus: string | null; raw: Record<string, unknown> | null }> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/markets/${marketId}`);
  if (!response.ok) {
    return { status: response.status, ok: false, title: null, marketStatus: null, raw: null };
  }
  const json = await response.json() as { market?: { title?: string; status?: string; marketStatus?: string }; title?: string; status?: string; marketStatus?: string };
  const market = readMarketFromJson(json as Record<string, unknown>);
  return {
    status: response.status,
    ok: true,
    title: typeof market?.title === "string" ? market.title : null,
    marketStatus: typeof market?.marketStatus === "string" ? market.marketStatus : (typeof market?.status === "string" ? market.status : null),
    raw: market
  };
}

function includesText(value: unknown, needle: string): boolean {
  return Boolean(needle) && JSON.stringify(value ?? {}).includes(needle);
}

async function run(options: Options): Promise<void> {
  if (!options.snapshot) {
    throw new Error("--snapshot is required.");
  }
  const snapshotPath = isAbsolute(options.snapshot)
    ? options.snapshot
    : resolve(inferRepoRoot("NAVI_REPO_ROOT"), options.snapshot);
  const raw = JSON.parse(await readFile(snapshotPath, "utf8")) as { items?: DraftItem[] };
  const draftFilter = new Set((options.draft ?? []).map((value) => value.trim()).filter(Boolean));
  const items = (raw.items ?? []).filter((item) => draftFilter.size === 0 || (item.creationDraftId && draftFilter.has(item.creationDraftId)));
  const baseUrl = options.publicBaseUrl ?? "https://hachozeh.com";

  const rows = [];
  for (const item of items) {
    const candidate = item.candidateMarketId?.trim();
    const ids = candidate ? [candidate, `disc-${candidate}`] : [];
    const checks = [];
    for (const marketId of ids) {
      checks.push({ marketId, ...(await fetchMarket(baseUrl, marketId)) });
    }
    const live = checks.find((check) => check.ok) ?? null;
    const detail = live?.marketId
      ? await fetchJson(baseUrl, `/api/market-detail/markets/${live.marketId}`)
      : { status: 0, ok: false, json: null };
    const expectedSourceLabel = item.marketContract?.resolutionSource?.label ?? null;
    const expectedSourceUrl = item.marketContract?.resolutionSource?.url ?? null;
    const issues = [
      ...(!live?.marketId ? ["missing_public_market"] : []),
      ...(live?.title && item.title && live.title !== item.title ? [`title_mismatch:${live.title}`] : []),
      ...(expectedSourceLabel && !includesText(detail.json, expectedSourceLabel) ? ["source_label_missing_from_detail"] : []),
      ...(expectedSourceUrl && !includesText(detail.json, expectedSourceUrl) ? ["source_url_missing_from_detail"] : [])
    ];
    rows.push({
      creationDraftId: item.creationDraftId ?? null,
      candidateMarketId: candidate ?? null,
      expectedTitle: item.title ?? null,
      expectedCloseAt: item.closeAt ?? null,
      expectedSourceLabel,
      expectedSourceUrl,
      liveMarketId: live?.marketId ?? null,
      liveStatus: live?.marketStatus ?? null,
      checks,
      detailCheck: {
        status: detail.status,
        ok: detail.ok
      },
      issues
    });
  }

  const missing = rows.filter((row) => !row.liveMarketId);
  const issueCount = rows.reduce((sum, row) => sum + row.issues.length, 0);
  const receipt = {
    objectType: "batch_publish_verify",
    generatedAt: new Date().toISOString(),
    publicBaseUrl: baseUrl,
    snapshot: snapshotPath,
    checkedCount: rows.length,
    missingCount: missing.length,
    issueCount,
    rows
  };
  console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
  if (missing.length > 0 || issueCount > 0) process.exitCode = 2;
}

const program = new Command("batch-publish-verify")
  .description("Public API verifier for a market creation snapshot after batch publish.")
  .requiredOption("--snapshot <path>")
  .option("--draft <creation-draft-id>", "Limit to one draft; repeatable.", repeated)
  .option("--public-base-url <url>", "Public origin.", "https://hachozeh.com")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
