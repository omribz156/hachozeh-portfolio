import { existsSync } from "node:fs";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { buildSeerMarketId } from "../lifecycle/management/seer-market-creation-service";
import {
  scanSeerOpportunities,
  type ExistingMarketLike,
  type SeerOpportunityObservation,
  type SeerOpportunityScanReceipt,
  type TournamentEventLike
} from "../seer/opportunity-watch";
import { inferRepoRoot } from "./script-args";

type Options = {
  event?: string[];
  observation?: string[];
  includeDuplicates?: boolean;
  skipPackSnapshots?: boolean;
  writeInbox?: string;
  json?: boolean;
};

type EventRow = {
  event_id: string;
  event_slug: string | null;
  event_title: string;
  category_key: string | null;
  market_id: string;
  market_title: string;
  event_child_label: string | null;
  status: string;
  resolved_at: Date | null;
  close_at: Date | null;
  market_contract: Record<string, unknown>;
  winner_count: number;
};

type ExistingMarketRow = {
  id: string;
  title: string;
  event_slug: string | null;
  close_at: Date | null;
  resolved_at: Date | null;
  market_contract: Record<string, unknown>;
  status: string;
  winning_outcome_labels: string[] | null;
};

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const part of path) {
    const object = readObject(current);
    current = object[part];
  }
  return current;
}

function resolveRepoPath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function walkJsonFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(path);
    if (entry.isFile() && entry.name.endsWith(".json")) return [path];
    return [];
  }));
  return files.flat();
}

function mapDbEventRows(rows: EventRow[]): TournamentEventLike[] {
  const events = new Map<string, TournamentEventLike>();
  for (const row of rows) {
    const event = events.get(row.event_id) ?? {
      id: row.event_id,
      slug: row.event_slug,
      title: row.event_title,
      categoryKey: row.category_key,
      children: []
    };
    event.children.push({
      marketId: row.market_id,
      title: row.market_title,
      eventChildLabel: row.event_child_label,
      status: row.status,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      winnerCount: Number(row.winner_count),
      closeAt: row.close_at?.toISOString() ?? null,
      contract: row.market_contract
    });
    events.set(row.event_id, event);
  }
  return Array.from(events.values());
}

function mapExistingMarketRows(rows: ExistingMarketRow[]): ExistingMarketLike[] {
  return rows.map((row) => {
    const contract = readObject(row.market_contract);
    return {
      id: row.id,
      title: row.title,
      eventSlug: row.event_slug,
      candidateMarketId: readString(readPath(contract, ["operational", "candidateMarketId"])),
      closeAt: row.close_at?.toISOString() ?? null,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      winningOutcomeLabels: row.winning_outcome_labels ?? [],
      contract,
      status: row.status
    };
  });
}

function packItemToExistingMarket(item: Record<string, unknown>): ExistingMarketLike | null {
  const candidateMarketId = readString(item.candidateMarketId);
  const title = readString(item.title);
  if (!candidateMarketId || !title) return null;
  const contract = readObject(item.marketContract ?? item.market_contract ?? item.contract);
  const event = readObject(item.event);
  return {
    id: buildSeerMarketId(candidateMarketId),
    title,
    eventSlug: readString(event.slug),
    candidateMarketId,
    closeAt: readString(item.closeAt) || null,
    resolvedAt: null,
    winningOutcomeLabels: [],
    contract,
    status: "draft"
  };
}

async function readPackSnapshotMarkets(repoRoot: string): Promise<ExistingMarketLike[]> {
  const files = (await walkJsonFiles(resolve(repoRoot, "workspace/market-packs")))
    .filter((file) => file.includes(`${join("02-dev")}${"/"}`) || file.includes(`${join("03-prod")}${"/"}`));
  const markets: ExistingMarketLike[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(file, "utf8")) as { items?: unknown[] };
    for (const item of raw.items ?? []) {
      const market = packItemToExistingMarket(readObject(item));
      if (market) markets.push(market);
    }
  }
  return markets;
}

function normalizeObservationPayload(value: unknown): SeerOpportunityObservation[] {
  if (Array.isArray(value)) return value.map((item) => readObject(item) as SeerOpportunityObservation);
  const object = readObject(value);
  if (Array.isArray(object.observations)) {
    return object.observations.map((item) => readObject(item) as SeerOpportunityObservation);
  }
  if (readString(object.sourceFamily) && Array.isArray(object.outcomes)) {
    return [object as SeerOpportunityObservation];
  }
  return [];
}

async function readObservations(repoRoot: string, paths: string[] = []): Promise<SeerOpportunityObservation[]> {
  const observations: SeerOpportunityObservation[] = [];
  for (const path of paths) {
    const fullPath = resolveRepoPath(repoRoot, path);
    const payload = JSON.parse(await readFile(fullPath, "utf8"));
    observations.push(...normalizeObservationPayload(payload));
  }
  return observations;
}

async function readEventsFromDb(options: Options): Promise<TournamentEventLike[]> {
  const eventFilter = (options.event ?? []).map((event) => event.trim()).filter(Boolean);
  const pool = createDbPool(loadAppEnv().db);
  try {
    const rows = (
      await pool.query<EventRow>(
        `
          select
            e.id as event_id,
            e.slug as event_slug,
            e.title as event_title,
            e.category_key,
            m.id as market_id,
            m.title as market_title,
            m.event_child_label,
            m.status,
            m.resolved_at,
            m.close_at,
            m.market_contract,
            count(mo.id) filter (where mo.is_winner is true)::int as winner_count
          from events e
          join markets m on m.event_id = e.id
          left join market_outcomes mo on mo.market_id = m.id
          where ($1::text[] is null or e.id = any($1::text[]) or e.slug = any($1::text[]))
          group by e.id, m.id
          order by e.id asc, m.close_at asc, m.id asc
        `,
        [eventFilter.length > 0 ? eventFilter : null]
      )
    ).rows;
    return mapDbEventRows(rows);
  } finally {
    await pool.end();
  }
}

async function readExistingMarketsFromDb(): Promise<ExistingMarketLike[]> {
  const pool = createDbPool(loadAppEnv().db);
  try {
    const rows = (
      await pool.query<ExistingMarketRow>(
        `
          select
            m.id,
            m.title,
            e.slug as event_slug,
            m.close_at,
            m.resolved_at,
            m.market_contract,
            m.status,
            array_remove(
              array_agg(coalesce(mo.short_label, mo.label) order by mo.sort_order)
                filter (where mo.is_winner is true),
              null
            )::text[] as winning_outcome_labels
          from markets m
          left join events e on e.id = m.event_id
          left join market_outcomes mo on mo.market_id = m.id
          where m.status <> 'voided'
          group by m.id, e.slug
          order by m.created_at desc, m.id asc
        `
      )
    ).rows;
    return mapExistingMarketRows(rows);
  } finally {
    await pool.end();
  }
}

async function writeInboxReceipt(path: string, receipt: SeerOpportunityScanReceipt): Promise<void> {
  const lines = [
    "",
    "## Seer Opportunity Watch",
    "",
    `Status: ${receipt.suggestionCount > 0 ? "open" : "clear"}`,
    `Generated: ${receipt.generatedAt}`,
    `Suggestions: ${receipt.suggestionCount}`,
    `Duplicates filtered/found: ${receipt.duplicateCount}`,
    "",
    ...receipt.suggestions.map((suggestion) => [
      `- ${suggestion.title}`,
      `  - candidate: ${suggestion.candidateMarketId}`,
      `  - outcomes: ${suggestion.outcomes.join(" / ")}`,
      `  - reason: ${suggestion.reason}`
    ].join("\n"))
  ];
  await appendFile(path, `${lines.join("\n")}\n`, "utf8");
}

function renderHuman(receipt: SeerOpportunityScanReceipt): string {
  const lines = [
    "seer-opportunity-watch",
    `events=${receipt.eventCount} observations=${receipt.observationCount} existing=${receipt.existingMarketCount}`,
    `suggestions=${receipt.suggestionCount} duplicates=${receipt.duplicateCount}`
  ];
  for (const suggestion of receipt.suggestions) {
    lines.push("");
    lines.push(`- ${suggestion.title}`);
    lines.push(`  status: ${suggestion.status}`);
    lines.push(`  candidate: ${suggestion.candidateMarketId}`);
    lines.push(`  category: ${suggestion.categoryKey}`);
    lines.push(`  outcomes: ${suggestion.outcomes.join(" / ")}`);
    if (suggestion.sourceUrl) lines.push(`  source: ${suggestion.sourceUrl}`);
    lines.push(`  reason: ${suggestion.reason}`);
  }
  return lines.join("\n");
}

async function run(options: Options): Promise<void> {
  const repoRoot = inferRepoRoot("NAVI_REPO_ROOT");
  const [events, dbMarkets, packMarkets, observations] = await Promise.all([
    readEventsFromDb(options),
    readExistingMarketsFromDb(),
    options.skipPackSnapshots ? Promise.resolve([]) : readPackSnapshotMarkets(repoRoot),
    readObservations(repoRoot, options.observation)
  ]);
  const existingMarkets = [...dbMarkets, ...packMarkets];
  const receipt = scanSeerOpportunities({
    events,
    observations,
    existingMarkets,
    includeDuplicates: options.includeDuplicates
  });

  if (options.writeInbox) {
    await writeInboxReceipt(resolveRepoPath(repoRoot, options.writeInbox), receipt);
  }

  console.log(options.json ? JSON.stringify(receipt, null, 2) : renderHuman(receipt));
}

const program = new Command("seer-opportunity-watch")
  .description("Read-only Seer watch for missing next-market opportunities.")
  .option("--event <event-id-or-slug>", "Limit DB event scan; repeatable.", repeated)
  .option("--observation <path>", "Source-fed opportunity observation JSON; repeatable.", repeated)
  .option("--include-duplicates", "Include suggestions already covered by live markets or market packs.")
  .option("--skip-pack-snapshots", "Do not treat workspace/market-packs dev/prod snapshots as existing drafts.")
  .option("--write-inbox <path>", "Append suggestions to a coordination inbox path.")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
