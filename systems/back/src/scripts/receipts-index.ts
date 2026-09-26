import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { Command } from "commander";

import { inferRepoRoot } from "./script-args";

type Options = {
  root?: string;
  output?: string;
  limit?: string;
  json?: boolean;
  write?: boolean;
};

type ReceiptIndexEntry = {
  path: string;
  objectType: string | null;
  generatedAt: string | null;
  mtime: string;
  summary: Record<string, unknown>;
};

function readLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "300", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--limit must be a positive integer.");
  return parsed;
}

function summarizeReceipt(receipt: Record<string, unknown>): Record<string, unknown> {
  const market = receipt.market && typeof receipt.market === "object" && !Array.isArray(receipt.market)
    ? receipt.market as Record<string, unknown>
    : {};
  return {
    marketId: receipt.marketId ?? market.id ?? null,
    eventId: receipt.eventId ?? null,
    checkedCount: receipt.checkedCount ?? null,
    issueCount: receipt.issueCount ?? null,
    blockerCount: receipt.blockerCount ?? null,
    missingCount: receipt.missingCount ?? null,
    status: receipt.status ?? null,
    dryRun: receipt.dryRun ?? null
  };
}

async function walkJsonFiles(root: string, limit: number): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (output.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        output.push(path);
      }
    }
  }
  await walk(root);
  return output;
}

async function run(options: Options): Promise<void> {
  const repoRoot = inferRepoRoot("NAVI_REPO_ROOT");
  const runtimeRoot = options.root
    ? (isAbsolute(options.root) ? options.root : resolve(repoRoot, options.root))
    : resolve(repoRoot, "workspace/runtime");
  const files = await walkJsonFiles(runtimeRoot, readLimit(options.limit));
  const entries: ReceiptIndexEntry[] = [];

  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const receipt = parsed as Record<string, unknown>;
      const fileStat = await stat(file);
      entries.push({
        path: relative(repoRoot, file),
        objectType: typeof receipt.objectType === "string" ? receipt.objectType : null,
        generatedAt: typeof receipt.generatedAt === "string" ? receipt.generatedAt : null,
        mtime: fileStat.mtime.toISOString(),
        summary: summarizeReceipt(receipt)
      });
    } catch {
      // Ignore non-receipt JSON files.
    }
  }

  entries.sort((left, right) => right.mtime.localeCompare(left.mtime));
  const receipt = {
    objectType: "receipts_index",
    generatedAt: new Date().toISOString(),
    root: relative(repoRoot, runtimeRoot),
    count: entries.length,
    entries
  };

  if (options.write) {
    const output = options.output
      ? (isAbsolute(options.output) ? options.output : resolve(repoRoot, options.output))
      : resolve(repoRoot, "workspace/runtime/receipts-index.json");
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
}

const program = new Command("receipts-index")
  .description("Build a compact index of runtime JSON receipts.")
  .option("--root <path>", "Runtime receipt root.", "workspace/runtime")
  .option("--output <path>", "Optional output path when --write is passed.", "workspace/runtime/receipts-index.json")
  .option("--limit <n>", "Maximum JSON files to scan.", "300")
  .option("--write", "Write the index to --output.")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
