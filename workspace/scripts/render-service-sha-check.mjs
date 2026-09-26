#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const services = [
  ["backend", "srv-configure-your-service"],
  ["web", "srv-configure-your-service"],
  ["gateway", "srv-configure-your-service"],
  ["horizon", "crn-configure-your-service"],
  ["oracle", "crn-configure-your-service"],
  ["market-watch", "crn-configure-your-service"],
  ["prod-doctor", "crn-configure-your-service"]
];

function usage() {
  console.log(`Usage:
  workspace/scripts/render-service-sha-check.mjs --sha <commit> [options]

Options:
  --sha <commit>      Expected deployed commit SHA.
  --service <name>    Limit to service name. Can be repeated.
  --json              Emit JSON.
  -h, --help          Show help.

Purpose:
  Check latest Render deploy commit/status per service against an expected SHA.
`);
}

function parseArgs(argv) {
  const options = { sha: "", services: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sha") {
      options.sha = argv[++index] ?? "";
    } else if (arg.startsWith("--sha=")) {
      options.sha = arg.slice("--sha=".length);
    } else if (arg === "--service") {
      options.services.push(argv[++index] ?? "");
    } else if (arg.startsWith("--service=")) {
      options.services.push(arg.slice("--service=".length));
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
  if (!options.sha) {
    console.error("--sha is required.");
    usage();
    process.exit(2);
  }
  return options;
}

function render(args) {
  return execFileSync("render", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function latestDeploy(serviceId) {
  const output = render(["deploys", "list", serviceId, "--output", "json"]);
  const rows = JSON.parse(output);
  return Array.isArray(rows) ? rows[0] : null;
}

const options = parseArgs(process.argv.slice(2));
const selected = services.filter(([name]) => options.services.length === 0 || options.services.includes(name));
const expectedPrefix = options.sha;
const rows = [];
let ok = true;

for (const [name, id] of selected) {
  try {
    const deploy = latestDeploy(id);
    const commit = deploy?.commit?.id ?? "";
    const status = deploy?.status ?? "missing";
    const matches = commit.startsWith(expectedPrefix) && ["live", "succeeded"].includes(status);
    rows.push({
      name,
      id,
      deployId: deploy?.id ?? "missing",
      status,
      commit,
      matches,
      createdAt: deploy?.createdAt ?? null,
      finishedAt: deploy?.finishedAt ?? null
    });
    if (!matches) ok = false;
  } catch (error) {
    rows.push({
      name,
      id,
      deployId: "error",
      status: "error",
      commit: "",
      matches: false,
      error: error.message
    });
    ok = false;
  }
}

if (options.json) {
  console.log(JSON.stringify({ objectType: "render_service_sha_check", expectedSha: options.sha, rows }, null, 2));
} else {
  console.log(`Render service SHA check: ${options.sha}`);
  for (const row of rows) {
    console.log(`${row.matches ? "ok" : "fail"} ${row.name} ${row.status} ${row.deployId} ${row.commit || "no-commit"}`);
  }
}

if (!ok) process.exit(1);
