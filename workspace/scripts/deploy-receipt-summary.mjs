#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function usage() {
  console.log(`Usage:
  workspace/scripts/deploy-receipt-summary.mjs [options]

Options:
  --run-dir <path>   Render deploy receipt dir. Defaults to latest workspace/runtime/render-deploy/*.
  --json             Emit JSON.
  -h, --help         Show help.

Purpose:
  Convert render-deploy-stack.sh receipt files into a compact final receipt.
`);
}

function parseArgs(argv) {
  const options = { runDir: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-dir") {
      options.runDir = path.resolve(argv[++index] ?? "");
    } else if (arg.startsWith("--run-dir=")) {
      options.runDir = path.resolve(arg.slice("--run-dir=".length));
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }
  return options;
}

function latestRunDir() {
  const parent = path.join(repoRoot, "workspace/runtime/render-deploy");
  const entries = fs.existsSync(parent)
    ? fs.readdirSync(parent).map((entry) => path.join(parent, entry)).filter((entry) => fs.statSync(entry).isDirectory())
    : [];
  entries.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return entries[0] ?? "";
}

function readMaybe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function parseSummary(summaryText) {
  return summaryText.split("\n").filter(Boolean).map((line) => {
    const [target, serviceId, status, id, commandFile, outputFile] = line.split("|");
    return { target, serviceId, status, id, commandFile, outputFile };
  });
}

const options = parseArgs(process.argv.slice(2));
const runDir = options.runDir || latestRunDir();
if (!runDir) {
  console.error("No render deploy receipt directory found.");
  process.exit(2);
}

const summaryFile = path.join(runDir, "summary.txt");
const rows = parseSummary(readMaybe(summaryFile));
const migration = rows.find((row) => row.target === "migration-plan");
let migrationPending = null;
if (migration?.outputFile) {
  const output = readMaybe(migration.outputFile);
  migrationPending = output.match(/pending=([0-9a-zA-Z_-]+)/)?.[1] ?? null;
}

const failures = rows.filter((row) => row.status !== "succeeded" && row.status !== "planned");
const receipt = {
  objectType: "deploy_receipt_summary",
  runDir,
  rows,
  migrationPending,
  failures
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log(`Render deploy receipt: ${path.relative(repoRoot, runDir)}`);
  console.log("");
  for (const row of rows) {
    const pendingSuffix = row.target === "migration-plan" && migrationPending !== null ? ` pending=${migrationPending}` : "";
    console.log(`${row.target}: ${row.status} ${row.id}${pendingSuffix}`);
  }
  if (failures.length > 0) {
    console.log("");
    console.log(`failures: ${failures.map((row) => `${row.target}:${row.status}`).join(", ")}`);
  }
}

if (failures.length > 0) process.exit(1);
