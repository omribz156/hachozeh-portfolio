import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { Command } from "commander";

import { inferRepoRoot } from "./script-args";

type Options = {
  snapshot?: string;
  json?: boolean;
};

function collectStrings(value: unknown, path = "item", output: Array<{ path: string; value: string }> = []): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    output.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, output));
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => collectStrings(entry, `${path}.${key}`, output));
  }
  return output;
}

async function run(options: Options): Promise<void> {
  if (!options.snapshot) {
    throw new Error("--snapshot is required.");
  }
  const snapshotPath = isAbsolute(options.snapshot)
    ? options.snapshot
    : resolve(inferRepoRoot("NAVI_REPO_ROOT"), options.snapshot);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { items?: Array<Record<string, unknown>> };
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const [index, item] of (snapshot.items ?? []).entries()) {
    const prefix = `items[${index}]`;
    const candidateMarketId = typeof item.candidateMarketId === "string" ? item.candidateMarketId : "";
    if (!candidateMarketId) {
      errors.push(`${prefix}: missing candidateMarketId`);
    } else if (ids.has(candidateMarketId)) {
      errors.push(`${prefix}: duplicate candidateMarketId ${candidateMarketId}`);
    }
    ids.add(candidateMarketId);

    const closeAt = typeof item.closeAt === "string" ? new Date(item.closeAt) : null;
    const expectedPathDate = closeAt && Number.isFinite(closeAt.getTime()) ? closeAt.toISOString().slice(0, 10).replaceAll("-", "/") : null;
    const text = JSON.stringify(item);
    if (text.includes("src_ims_daily_observations") && expectedPathDate) {
      for (const endpoint of collectStrings(item, prefix)) {
        if (endpoint.value.includes("api.ims.gov.il") && /\/data\/daily\/\d{4}\/\d{2}\/\d{2}/.test(endpoint.value) && !endpoint.value.includes(`/data/daily/${expectedPathDate}`)) {
          errors.push(`${endpoint.path}: IMS endpoint date mismatch, expected ${expectedPathDate}`);
        }
      }
    }
  }

  const receipt = {
    objectType: "recurring_market_guard",
    generatedAt: new Date().toISOString(),
    snapshot: snapshotPath,
    itemCount: snapshot.items?.length ?? 0,
    errors
  };
  console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
  if (errors.length > 0) process.exitCode = 2;
}

const program = new Command("recurring-market-guard")
  .description("Static guard for recurring market snapshots before publish.")
  .requiredOption("--snapshot <path>")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
