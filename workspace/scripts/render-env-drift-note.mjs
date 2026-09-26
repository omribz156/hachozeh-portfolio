#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

function usage() {
  console.log(`Usage:
  workspace/scripts/render-env-drift-note.mjs [options]

Options:
  --base <ref>   Compare committed stack against this ref. Defaults to origin/main.
  --json         Emit JSON.
  -h, --help     Show help.

Purpose:
  Warn when a deploy stack changes Render blueprint/env contract files, because
  a normal service redeploy may not sync dashboard env groups or blueprint state.
`);
}

function parseArgs(argv) {
  const options = { base: "origin/main", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      options.base = argv[++index] ?? "";
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
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

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lines(value) {
  return value ? value.split("\n").filter(Boolean) : [];
}

const options = parseArgs(process.argv.slice(2));
const files = lines(git(["diff", "--name-only", `${options.base}..HEAD`]));
const watched = files.filter((file) =>
  file === "render.yaml" ||
  file === "workspace/deploy/production-env-contract.md" ||
  file.startsWith("workspace/deploy/docker/") ||
  file.startsWith("workspace/deploy/render")
);

const notes = [];
if (files.includes("render.yaml")) {
  notes.push("render.yaml changed: service redeploys do not necessarily sync blueprint/env-group config; check dashboard/blueprint state if env groups, schedules, disks, or service definitions changed.");
}
if (files.includes("workspace/deploy/production-env-contract.md")) {
  notes.push("production env contract changed: run render-env-contract-check and verify any new secret is present in Render before relying on it.");
}
if (files.some((file) => file.startsWith("workspace/deploy/docker/"))) {
  notes.push("Docker deploy files changed: rebuild all services using the changed Dockerfile.");
}

const receipt = {
  objectType: "render_env_drift_note",
  base: options.base,
  watchedFiles: watched,
  notes
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log("Render Env Drift Note");
  console.log(`- watched files changed: ${watched.length ? watched.join(", ") : "none"}`);
  if (notes.length === 0) {
    console.log("- notes: none");
  } else {
    for (const note of notes) console.log(`- ${note}`);
  }
}
