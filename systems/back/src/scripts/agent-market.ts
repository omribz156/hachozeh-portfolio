import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";

import { Command } from "commander";

import {
  buildSeerMarketId,
  parseSeerMarketCreationDraftSnapshot,
  readSeerMarketCreationDraftSnapshot,
  resolveSeerDraftLiquidityB,
  type SeerMarketCreationDraftSnapshot,
  type SeerDraftMaterializationRecord
} from "../lifecycle/management/seer-market-creation-service";
import { calculateLmsrReserveFloor } from "../lifecycle/management/publish-market/reserve-policy";
import { installEmbeddedWatchPlan } from "../market-watch/publish-bundle";

export type MarketAgentCommand = "drafts" | "ship";

export type ShipOptions = {
  all?: boolean | string;
  allowManualResolution?: boolean | string;
  draft?: string;
  execute?: boolean | string;
  forceMaterialize?: boolean | string;
  json?: boolean;
  marketEnvironment?: string;
  seedAmount?: string;
  showChildrenInDiscovery?: boolean | string;
  showGraph?: boolean | string;
  showParentInDiscovery?: boolean | string;
  snapshotJsonB64?: string;
  snapshotPath?: string;
};

type DraftItem = SeerMarketCreationDraftSnapshot["items"][number];

export type MarketAgentShipPlan = {
  objectType: "market_agent_ship_plan";
  command: MarketAgentCommand;
  generatedAt: string;
  execute: boolean;
  marketEnvironment: "prod" | "test";
  itemCount: number;
  items: Array<{
    creationDraftId: string;
    candidateMarketId: string;
    expectedMarketId: string;
    title: string;
    closeAt: string;
    categoryKey: string | null;
    oracleCapability: string | null;
    outcomeCount: number;
    liquidityB: string;
    seedAmount: string;
  }>;
  commands: string[];
};

const MARKET_AGENT_DRAFT_SNAPSHOT_B64_ENV = "MARKET_AGENT_DRAFT_SNAPSHOT_B64";
const SEER_DRAFT_SNAPSHOT_PATH_ENV = "SEER_MARKET_CREATION_DRAFT_SNAPSHOT_PATH";

type AgentSnapshotSource = {
  childEnv: NodeJS.ProcessEnv;
  snapshot: SeerMarketCreationDraftSnapshot | null;
};

export function readBooleanOption(value: boolean | string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  throw new Error("Boolean flags must be true or false.");
}

export function requireMarketEnvironment(value: string | undefined): "prod" | "test" {
  if (value !== "prod" && value !== "test") {
    throw new Error("Missing required flag --market-environment prod|test.");
  }

  return value;
}

export function resolveSeedAmount(draft: DraftItem, requestedSeedAmount: string | undefined): string {
  if (requestedSeedAmount) {
    return requestedSeedAmount;
  }

  if (draft.seedAmount) {
    return draft.seedAmount;
  }

  return calculateLmsrReserveFloor({
    liquidityB: resolveSeerDraftLiquidityB(draft),
    outcomeCount: draft.outcomes.length
  });
}

function renderShellCommand(args: string[]): string {
  return ["npm --prefix systems/back run seer-create --", ...args].join(" ");
}

export function resolveSeerCreateScriptPath(currentFilename = __filename): string {
  const extension = extname(currentFilename) === ".js" ? ".js" : ".ts";

  return resolve(__dirname, `seer-create${extension}`);
}

export function buildSeerCreateNodeArgs(scriptPath: string, args: string[]): string[] {
  if (extname(scriptPath) === ".ts") {
    return ["--import", "tsx", scriptPath, ...args];
  }

  return [scriptPath, ...args];
}

export function selectDrafts(
  snapshot: SeerMarketCreationDraftSnapshot | null,
  options: { all: boolean; draft?: string }
): DraftItem[] {
  if (!snapshot || snapshot.items.length === 0) {
    return [];
  }

  if (options.all) {
    return snapshot.items;
  }

  if (!options.draft) {
    throw new Error("Missing required flag --draft, or use --all true.");
  }

  const draft = snapshot.items.find((item) => item.creationDraftId === options.draft);

  if (!draft) {
    throw new Error(`No matching creation draft found: ${options.draft}`);
  }

  return [draft];
}

export function buildPlan(
  drafts: DraftItem[],
  options: {
    allowManualResolution: boolean;
    execute: boolean;
    forceMaterialize: boolean;
    marketEnvironment: "prod" | "test";
    seedAmount?: string;
    showChildrenInDiscovery?: boolean;
    showGraph?: boolean;
    showParentInDiscovery?: boolean;
  }
): MarketAgentShipPlan {
  const commands = drafts.flatMap((draft) => {
    const target = ["--draft", draft.creationDraftId];
    const materialize = [
      "materialize",
      ...target,
      "--market-environment",
      options.marketEnvironment,
      "--json",
      ...(options.showGraph ? ["--show-graph", "true"] : []),
      ...(options.showParentInDiscovery === undefined
        ? []
        : ["--show-parent-in-discovery", String(options.showParentInDiscovery)]),
      ...(options.showChildrenInDiscovery === undefined
        ? []
        : ["--show-children-in-discovery", String(options.showChildrenInDiscovery)]),
      ...(options.forceMaterialize ? ["--force", "true"] : [])
    ];
    const publish = [
      "publish",
      ...target,
      "--market-environment",
      options.marketEnvironment,
      "--json",
      ...(options.allowManualResolution ? ["--allow-manual-resolution", "true"] : []),
      ...(options.seedAmount ? ["--seed-amount", options.seedAmount] : [])
    ];

    return [
      renderShellCommand(materialize),
      ...(draft.watchPlan
        ? [`install embedded market-watch plan ${draft.watchPlan.id}`]
        : []),
      renderShellCommand(publish)
    ];
  });

  return {
    objectType: "market_agent_ship_plan",
    command: "ship",
    generatedAt: new Date().toISOString(),
    execute: options.execute,
    marketEnvironment: options.marketEnvironment,
    itemCount: drafts.length,
    items: drafts.map((draft) => ({
      creationDraftId: draft.creationDraftId,
      candidateMarketId: draft.candidateMarketId,
      expectedMarketId: buildSeerMarketId(draft.candidateMarketId),
      title: draft.title,
      closeAt: draft.closeAt,
      categoryKey: draft.categoryKey ?? null,
      oracleCapability:
        typeof draft.contract?.oracleCapability === "string"
          ? draft.contract.oracleCapability
          : null,
      outcomeCount: draft.outcomes.length,
      liquidityB: resolveSeerDraftLiquidityB(draft),
      seedAmount: resolveSeedAmount(draft, options.seedAmount)
    })),
    commands
  };
}

async function readAgentSnapshotSource(options: {
  snapshotJsonB64?: string;
  snapshotPath?: string;
}): Promise<AgentSnapshotSource> {
  const snapshotPath = options.snapshotPath?.trim();
  if (snapshotPath) {
    const snapshot = await readSeerMarketCreationDraftSnapshot(snapshotPath);

    return {
      childEnv: {
        ...process.env,
        [SEER_DRAFT_SNAPSHOT_PATH_ENV]: snapshotPath
      },
      snapshot
    };
  }

  const snapshotB64 = options.snapshotJsonB64?.trim() || process.env[MARKET_AGENT_DRAFT_SNAPSHOT_B64_ENV]?.trim();

  if (snapshotB64) {
    const contents = Buffer.from(snapshotB64, "base64").toString("utf8");
    const snapshot = parseSeerMarketCreationDraftSnapshot(JSON.parse(contents));
    const tempDir = await mkdtemp(resolve(tmpdir(), "hachozeh-market-agent-"));
    const snapshotPath = resolve(tempDir, "market-creation-drafts.json");
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

    return {
      childEnv: {
        ...process.env,
        [SEER_DRAFT_SNAPSHOT_PATH_ENV]: snapshotPath
      },
      snapshot
    };
  }

  const snapshot = await readSeerMarketCreationDraftSnapshot();

  return {
    childEnv: process.env,
    snapshot
  };
}

async function runSeerCreate(args: string[], childEnv: NodeJS.ProcessEnv): Promise<unknown> {
  return await new Promise((resolvePromise, reject) => {
    const scriptPath = resolveSeerCreateScriptPath();
    const child = spawn(
      process.execPath,
      buildSeerCreateNodeArgs(scriptPath, args),
      {
        cwd: resolve(__dirname, "../../.."),
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `seer-create exited with code ${code}`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(`seer-create returned non-JSON output: ${stdout.trim()}`));
      }
    });
  });
}

export function requireMaterializationRecord(value: unknown): SeerDraftMaterializationRecord {
  if (
    typeof value !== "object"
    || value === null
    || (value as { objectType?: unknown }).objectType !== "seer_market_creation_materialization"
    || typeof (value as { marketId?: unknown }).marketId !== "string"
    || !(value as { marketId: string }).marketId.trim()
    || typeof (value as { eventId?: unknown }).eventId !== "string"
    || !(value as { eventId: string }).eventId.trim()
  ) {
    throw new Error("seer-create materialize returned an invalid materialization receipt.");
  }

  return value as SeerDraftMaterializationRecord;
}

function renderDraftsHuman(snapshot: SeerMarketCreationDraftSnapshot | null): string {
  if (!snapshot) {
    return "market-agent drafts\nsnapshot: none\nitems: 0";
  }

  return [
    "market-agent drafts",
    `snapshot: ${snapshot.snapshotId}`,
    `items: ${snapshot.itemCount}`,
    ...snapshot.items.map((draft) =>
      [
        `- ${draft.creationDraftId}`,
        draft.title,
        `close=${draft.closeAt}`,
        `capability=${String(draft.contract?.oracleCapability ?? "missing")}`,
        `seed=${resolveSeedAmount(draft, undefined)}`
      ].join(" | ")
    )
  ].join("\n");
}

export function renderPlanHuman(plan: MarketAgentShipPlan): string {
  return [
    "market-agent ship",
    `mode: ${plan.execute ? "execute" : "dry-run"}`,
    `market_environment: ${plan.marketEnvironment}`,
    `items: ${plan.itemCount}`,
    ...plan.items.map((item) =>
      `- ${item.creationDraftId} -> ${item.expectedMarketId} | ${item.title} | close=${item.closeAt} | seed=${item.seedAmount}`
    ),
    "commands:",
    ...plan.commands.map((command) => `- ${command}`)
  ].join("\n");
}

async function runShip(options: ShipOptions): Promise<void> {
  const all = readBooleanOption(options.all, false);
  const allowManualResolution = readBooleanOption(options.allowManualResolution, false);
  const execute = readBooleanOption(options.execute, false);
  const forceMaterialize = readBooleanOption(options.forceMaterialize, false);
  const marketEnvironment = requireMarketEnvironment(options.marketEnvironment);
  const showParentInDiscovery = options.showParentInDiscovery === undefined
    ? undefined
    : readBooleanOption(options.showParentInDiscovery, false);
  const showChildrenInDiscovery = options.showChildrenInDiscovery === undefined
    ? undefined
    : readBooleanOption(options.showChildrenInDiscovery, false);
  const showGraph = readBooleanOption(options.showGraph, false);
  const snapshotSource = await readAgentSnapshotSource({
    snapshotJsonB64: options.snapshotJsonB64,
    snapshotPath: options.snapshotPath
  });
  const drafts = selectDrafts(snapshotSource.snapshot, {
    all,
    draft: options.draft
  });
  const plan = buildPlan(drafts, {
    allowManualResolution,
    execute,
    forceMaterialize,
    marketEnvironment,
    seedAmount: options.seedAmount,
    showParentInDiscovery,
    showChildrenInDiscovery,
    showGraph
  });

  if (!execute) {
    console.log(options.json ? JSON.stringify(plan, null, 2) : renderPlanHuman(plan));
    return;
  }

  const runs = [];

  for (const draft of drafts) {
    const target = ["--draft", draft.creationDraftId];
    const materialization = requireMaterializationRecord(await runSeerCreate([
      "materialize",
      ...target,
      "--market-environment",
      marketEnvironment,
      "--json",
      ...(showGraph ? ["--show-graph", "true"] : []),
      ...(showParentInDiscovery === undefined
        ? []
        : ["--show-parent-in-discovery", String(showParentInDiscovery)]),
      ...(showChildrenInDiscovery === undefined
        ? []
        : ["--show-children-in-discovery", String(showChildrenInDiscovery)]),
      ...(forceMaterialize ? ["--force", "true"] : [])
    ], snapshotSource.childEnv));
    runs.push(materialization);
    const installedWatchPlan = await installEmbeddedWatchPlan(draft, {
      marketId: materialization.marketId,
      eventId: materialization.eventId
    });
    if (installedWatchPlan) {
      runs.push({
        objectType: "market_watch_plan_bundle_install",
        plan: installedWatchPlan
      });
    }
    runs.push(await runSeerCreate([
      "publish",
      ...target,
      "--market-environment",
      marketEnvironment,
      "--json",
      ...(allowManualResolution ? ["--allow-manual-resolution", "true"] : []),
      ...(options.seedAmount ? ["--seed-amount", options.seedAmount] : [])
    ], snapshotSource.childEnv));
  }

  const result = {
    objectType: "market_agent_ship_result",
    generatedAt: new Date().toISOString(),
    marketEnvironment,
    itemCount: drafts.length,
    plan,
    runs
  };

  console.log(JSON.stringify(result, null, 2));
}

async function run(): Promise<void> {
  const program = new Command("market-agent")
    .description("Compact agent wrapper for Seer market publishing.")
    .showHelpAfterError();

  program
    .command("drafts")
    .option("--json")
    .option("--snapshot-json-b64 <base64-json>")
    .option("--snapshot-path <path>")
    .action(async (options: { json?: boolean; snapshotJsonB64?: string; snapshotPath?: string }) => {
      const snapshotSource = await readAgentSnapshotSource({
        snapshotJsonB64: options.snapshotJsonB64,
        snapshotPath: options.snapshotPath
      });
      console.log(options.json ? JSON.stringify(snapshotSource.snapshot, null, 2) : renderDraftsHuman(snapshotSource.snapshot));
    });

  program
    .command("ship")
    .option("--all [value]")
    .option("--allow-manual-resolution [value]")
    .option("--draft <creation-draft-id>")
    .option("--execute [value]")
    .option("--force-materialize [value]")
    .option("--json")
    .requiredOption("--market-environment <prod|test>")
    .option("--seed-amount <amount>")
    .option("--show-children-in-discovery [value]")
    .option("--show-graph [value]")
    .option("--show-parent-in-discovery [value]")
    .option("--snapshot-json-b64 <base64-json>")
    .option("--snapshot-path <path>")
    .action(runShip);

  await program.parseAsync(process.argv);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
