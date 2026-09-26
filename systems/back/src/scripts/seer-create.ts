import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { RequestActor } from "../auth/actor-resolver";
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { parseSeerCreateArgs } from "./seer-create-args";
import {
  buildSeerMarketId,
  materializeSeerMarketCreationDraft,
  readSeerMarketCreationDraftSnapshot,
  resolveSeerDraftLiquidityB,
  stampMaterializedMarketEnvironment,
  type SeerDraftMaterializationRecord,
  type SeerMarketCreationDraftSnapshot
} from "../lifecycle/management/seer-market-creation-service";
import {
  publishMarket,
  type PublishMarketResponse
} from "../lifecycle/management/publish-market-service";
import { calculateLmsrReserveFloor } from "../lifecycle/management/publish-market/reserve-policy";

type SeerDraftMaterializationRun = {
  objectType: "seer_market_creation_materialization_run";
  runId: string;
  generatedAt: string;
  snapshotId: string | null;
  itemCount: number;
  items: SeerDraftMaterializationRecord[];
  skipped?: Array<{
    creationDraftId: string;
    candidateMarketId: string;
    reason: "already-materialized";
  }>;
};

type SeerDraftPublishRecord = {
  objectType: "seer_market_publish";
  creationDraftId: string;
  candidateMarketId: string;
  marketId: string;
  seedAmount: string;
  status: "open";
  publishedAt: string;
  auditEventId: string;
};

type SeerDraftPublishSkipReason =
  | "already-open"
  | "not-materialized"
  | "missing-oracle-capability"
  | "manual-resolution-required"
  | "blocked-oracle-capability";

type SeerDraftPublishRun = {
  objectType: "seer_market_publish_run";
  runId: string;
  generatedAt: string;
  snapshotId: string | null;
  itemCount: number;
  items: SeerDraftPublishRecord[];
  skipped?: Array<{
    creationDraftId: string;
    candidateMarketId: string;
    marketId: string;
    reason: SeerDraftPublishSkipReason;
  }>;
};

const DEFAULT_SEER_PUBLISH_SEED_AMOUNT = "1000.000000";

const SEER_SYSTEM_ACTOR: RequestActor = {
  actorId: "system_seer",
  mode: "session",
  sessionId: "system_seer",
  role: "admin"
};

const materializationHistoryPath = resolve(
  __dirname,
  "../../../seer/state/market-creation-materializations-history.jsonl"
);
const latestMaterializationPath = resolve(
  __dirname,
  "../../../seer/state/market-creation-materializations-latest.json"
);
const publishHistoryPath = resolve(
  __dirname,
  "../../../seer/state/market-publications-history.jsonl"
);
const latestPublishPath = resolve(
  __dirname,
  "../../../seer/state/market-publications-latest.json"
);

function resolvePublishSeedAmount(
  draft: SeerMarketCreationDraftSnapshot["items"][number],
  requestedSeedAmount: string | null | undefined
): string {
  if (requestedSeedAmount) {
    return requestedSeedAmount;
  }

  if (draft.seedAmount) {
    return draft.seedAmount;
  }

  if (draft.outcomes.length >= 2) {
    return calculateLmsrReserveFloor({
      liquidityB: resolveSeerDraftLiquidityB(draft),
      outcomeCount: draft.outcomes.length
    });
  }

  return DEFAULT_SEER_PUBLISH_SEED_AMOUNT;
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true
  });
}

async function readMaterializationHistory(): Promise<SeerDraftMaterializationRun[]> {
  try {
    const contents = await readFile(materializationHistoryPath, "utf8");

    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SeerDraftMaterializationRun);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function persistMaterializationRun(run: SeerDraftMaterializationRun): Promise<void> {
  await ensureParent(materializationHistoryPath);
  await writeFile(materializationHistoryPath, `${JSON.stringify(run)}\n`, {
    flag: "a",
    encoding: "utf8"
  });
  await writeFile(latestMaterializationPath, JSON.stringify(run, null, 2), "utf8");
}

async function persistPublishRun(run: SeerDraftPublishRun): Promise<void> {
  await ensureParent(publishHistoryPath);
  await writeFile(publishHistoryPath, `${JSON.stringify(run)}\n`, {
    flag: "a",
    encoding: "utf8"
  });
  await writeFile(latestPublishPath, JSON.stringify(run, null, 2), "utf8");
}

function findLatestMaterializedMarketId(
  history: SeerDraftMaterializationRun[],
  creationDraftId: string
): string | null {
  const latest = history
    .flatMap((run) => run.items.map((item) => ({ generatedAt: run.generatedAt, item })))
    .filter((entry) => entry.item.creationDraftId === creationDraftId)
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0];

  return latest?.item.marketId ?? null;
}

function readPublishBlocker(
  draft: { contract?: { [key: string]: unknown } | null },
  options: { allowManualResolution: boolean }
): SeerDraftPublishSkipReason | null {
  const capability = draft.contract?.oracleCapability;

  if (typeof capability !== "string" || !capability) {
    return "missing-oracle-capability";
  }

  if (capability === "blocked") {
    return "blocked-oracle-capability";
  }

  if (capability === "manual_resolution_required" && !options.allowManualResolution) {
    return "manual-resolution-required";
  }

  return null;
}

function printHelp(helpText?: string): void {
  console.log(helpText ?? `Usage:
  npm run seer-create -- list [--json]
  npm run seer-create -- materialize --draft <creation-draft-id> [--json]
  npm run seer-create -- materialize --all [--json]
  npm run seer-create -- materialize --all --force [--market-environment prod|test] [--json]
  npm run seer-create -- publish --draft <creation-draft-id> [--seed-amount <amount>] [--market-environment prod|test] [--json]
  npm run seer-create -- publish --all [--seed-amount <amount>] [--allow-manual-resolution true] [--market-environment prod|test] [--json]
`);
}

function renderHumanList(
  snapshotPath: string,
  snapshot: SeerMarketCreationDraftSnapshot | null
): string {
  if (!snapshot) {
    return ["seer-create list", "snapshot: none", `path: ${snapshotPath}`, "items: 0"].join("\n");
  }

  return [
    "seer-create list",
    `snapshot: ${snapshot.snapshotId}`,
    `items: ${snapshot.itemCount}`,
    `path: ${snapshotPath}`,
    ...snapshot.items.map(
      (item) => {
        const effectiveLiquidityB = resolveSeerDraftLiquidityB(item);
        const liquidityPart =
          effectiveLiquidityB === item.liquidityB
            ? `b=${item.liquidityB}`
            : `b=${effectiveLiquidityB} (raised from ${item.liquidityB})`;

        const seedAmount = resolvePublishSeedAmount(item, undefined);
        return `- ${item.creationDraftId} | ${item.title} | category=${item.categoryKey ?? "unknown"} | close=${item.closeAt} | ${liquidityPart} | seed=${seedAmount}`;
      }
    )
  ].join("\n");
}

function renderHumanRun(run: SeerDraftMaterializationRun): string {
  return [
    "seer-create materialize",
    `run: ${run.runId}`,
    `snapshot: ${run.snapshotId ?? "none"}`,
    `items: ${run.itemCount}`,
    `latest: ${latestMaterializationPath}`,
    ...run.items.map(
      (item) => `- ${item.creationDraftId} -> ${item.marketId} | status=${item.status} | audit=${item.auditEventId}`
    ),
    ...((run.skipped ?? []).map(
      (item) => `- skipped ${item.creationDraftId} (${item.candidateMarketId}) | reason=${item.reason}`
    ))
  ].join("\n");
}

function renderHumanPublishRun(run: SeerDraftPublishRun): string {
  return [
    "seer-create publish",
    `run: ${run.runId}`,
    `snapshot: ${run.snapshotId ?? "none"}`,
    `items: ${run.itemCount}`,
    `latest: ${latestPublishPath}`,
    ...run.items.map(
      (item) =>
        `- ${item.creationDraftId} -> ${item.marketId} | status=${item.status} | seed=${item.seedAmount} | audit=${item.auditEventId}`
    ),
    ...((run.skipped ?? []).map(
      (item) => `- skipped ${item.creationDraftId} (${item.marketId}) | reason=${item.reason}`
    ))
  ].join("\n");
}

function requireDraftOption(value: string | undefined): string {
  if (!value) {
    throw new Error("Missing required flag --draft");
  }

  return value;
}

async function run(): Promise<void> {
  const parsed = parseSeerCreateArgs(process.argv);

  if (parsed.helpRequested) {
    if (parsed.command) {
      printHelp(parsed.helpText);
      return;
    }

    if (!parsed.unknownCommand) {
      printHelp(parsed.helpText);
      return;
    }

    throw new Error(`Unsupported command: ${parsed.unknownCommand}`);
  }

  if (!parsed.command) {
    if (!parsed.unknownCommand) {
      printHelp(parsed.helpText);
      return;
    }

    throw new Error(`Unsupported command: ${parsed.unknownCommand}`);
  }

  if (parsed.command === "list") {
    const snapshot = await readSeerMarketCreationDraftSnapshot();

    if (parsed.jsonMode) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    console.log(renderHumanList(resolve(__dirname, "../../../seer/state/market-creation-drafts-latest.json"), snapshot));
    return;
  }

  const snapshot = await readSeerMarketCreationDraftSnapshot();

  if (!snapshot || snapshot.items.length === 0) {
    const emptyRun: SeerDraftMaterializationRun = {
      objectType: "seer_market_creation_materialization_run",
      runId: `dmatrun_${Date.now()}`,
      generatedAt: new Date().toISOString(),
      snapshotId: snapshot?.snapshotId ?? null,
      itemCount: 0,
      items: []
    };

    await persistMaterializationRun(emptyRun);

    if (parsed.jsonMode) {
      console.log(JSON.stringify(emptyRun, null, 2));
      return;
    }

    console.log(renderHumanRun(emptyRun));
    return;
  }

  const drafts =
    parsed.options.all
      ? snapshot.items
      : [snapshot.items.find((item) => item.creationDraftId === requireDraftOption(parsed.options.draft))].filter(
          (item): item is (typeof snapshot.items)[number] => Boolean(item)
        );

  if (drafts.length === 0) {
    throw new Error("No matching creation draft found.");
  }

  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    if (parsed.command === "publish") {
      const requestedSeedAmount = parsed.options.seedAmount ?? null;
      const allowManualResolution = parsed.options.allowManualResolution;
      const items: SeerDraftPublishRecord[] = [];
      const skipped: SeerDraftPublishRun["skipped"] = [];
      const materializationHistory = await readMaterializationHistory();

      for (const draft of drafts) {
        const marketId =
          findLatestMaterializedMarketId(materializationHistory, draft.creationDraftId) ??
          buildSeerMarketId(draft.candidateMarketId);
        const marketResult = await dbPool.query<{ status: "draft" | "open" | "closed" | "resolved" | "voided" }>(
          `select status from markets where id = $1 limit 1`,
          [marketId]
        );
        const market = marketResult.rows[0];

        if (!market) {
          skipped.push({
            creationDraftId: draft.creationDraftId,
            candidateMarketId: draft.candidateMarketId,
            marketId,
            reason: "not-materialized"
          });
          continue;
        }

        const publishBlocker = readPublishBlocker(draft, { allowManualResolution });

        if (publishBlocker) {
          skipped.push({
            creationDraftId: draft.creationDraftId,
            candidateMarketId: draft.candidateMarketId,
            marketId,
            reason: publishBlocker
          });
          continue;
        }

        if (market.status !== "draft") {
          skipped.push({
            creationDraftId: draft.creationDraftId,
            candidateMarketId: draft.candidateMarketId,
            marketId,
            reason: "already-open"
          });
          continue;
        }

        if (parsed.options.marketEnvironment) {
          await stampMaterializedMarketEnvironment(dbPool, marketId, parsed.options.marketEnvironment);
        }

        const seedAmount = resolvePublishSeedAmount(draft, requestedSeedAmount);
        const response: PublishMarketResponse = await publishMarket(
          dbPool,
          marketId,
          {
            publishAt: null,
            seedAmount,
            note: "Seer explicit publish.",
            reviewId: draft.reviewItemId,
            checklistVersion: "v1",
            managementApprovedAt: new Date().toISOString(),
            idempotencyKey: `publish_market:${marketId}:${Date.now()}`
          },
          SEER_SYSTEM_ACTOR
        );

        items.push({
          objectType: "seer_market_publish",
          creationDraftId: draft.creationDraftId,
          candidateMarketId: draft.candidateMarketId,
          marketId: response.marketId,
          seedAmount,
          status: response.status,
          publishedAt: response.publishedAt,
          auditEventId: response.auditEventId
        });
      }

      const publishRun: SeerDraftPublishRun = {
        objectType: "seer_market_publish_run",
        runId: `dpubrun_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        snapshotId: snapshot.snapshotId,
        itemCount: items.length,
        items,
        skipped: skipped.length > 0 ? skipped : undefined
      };

      await persistPublishRun(publishRun);

      if (parsed.jsonMode) {
        console.log(JSON.stringify(publishRun, null, 2));
        return;
      }

      console.log(renderHumanPublishRun(publishRun));
      return;
    }

    const force = parsed.options.force;
    const history = await readMaterializationHistory();
    const items: SeerDraftMaterializationRecord[] = [];
    const skipped: SeerDraftMaterializationRun["skipped"] = [];

    for (const draft of drafts) {
      if (!force) {
        const latestMarketId = findLatestMaterializedMarketId(history, draft.creationDraftId);

        if (latestMarketId) {
          const marketResult = await dbPool.query<{ status: "draft" | "open" | "closed" | "resolved" | "voided" }>(
            `select status from markets where id = $1 limit 1`,
            [latestMarketId]
          );
          const market = marketResult.rows[0];

          if (market && (market.status === "draft" || market.status === "open")) {
            skipped.push({
              creationDraftId: draft.creationDraftId,
              candidateMarketId: draft.candidateMarketId,
              reason: "already-materialized"
            });
            continue;
          }
        }
      }

      items.push(
        await materializeSeerMarketCreationDraft(dbPool, draft, SEER_SYSTEM_ACTOR, {
          marketEnvironment: parsed.options.marketEnvironment,
          showGraph: parsed.options.showGraph,
          showParentInDiscovery: parsed.options.showParentInDiscovery,
          showChildrenInDiscovery: parsed.options.showChildrenInDiscovery
        })
      );
    }

    const runSummary: SeerDraftMaterializationRun = {
      objectType: "seer_market_creation_materialization_run",
      runId: `dmatrun_${Date.now()}`,
      generatedAt: new Date().toISOString(),
      snapshotId: snapshot.snapshotId,
      itemCount: items.length,
      items,
      skipped: skipped.length > 0 ? skipped : undefined
    };

    await persistMaterializationRun(runSummary);

    if (parsed.jsonMode) {
      console.log(JSON.stringify(runSummary, null, 2));
      return;
    }

    console.log(renderHumanRun(runSummary));
  } finally {
    await dbPool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
