#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

function usage() {
  console.log(`Usage:
  workspace/scripts/changed-route-smoke-suggest.mjs [options]

Options:
  --base <ref>   Compare committed stack against this ref. Defaults to origin/main.
  --sha <sha>    Include post-deploy-smoke command for this SHA.
  --json         Emit JSON.
  -h, --help     Show help.

Purpose:
  Suggest public URLs to smoke from changed files.
`);
}

function parseArgs(argv) {
  const options = { base: "origin/main", sha: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      options.base = argv[++index] ?? "";
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    } else if (arg === "--sha") {
      options.sha = argv[++index] ?? "";
    } else if (arg.startsWith("--sha=")) {
      options.sha = arg.slice("--sha=".length);
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

function addSuggestion(map, pathValue, reason) {
  if (!map.has(pathValue)) map.set(pathValue, new Set());
  map.get(pathValue).add(reason);
}

const options = parseArgs(process.argv.slice(2));
const files = lines(git(["diff", "--name-only", `${options.base}..HEAD`]));
const suggestions = new Map();

for (const file of files) {
  if (file === "systems/web/src/pages/markets.astro") addSuggestion(suggestions, "/markets", file);
  if (file.startsWith("systems/web/src/pages/sitemaps/")) addSuggestion(suggestions, "/sitemaps/static.xml", file);
  if (file.includes("result-overlay") || file.includes("share-loop")) addSuggestion(suggestions, "/", file);
  if (file.includes("SiteFooter")) addSuggestion(suggestions, "/", file);
  if (file.includes("TrustSection") || file.includes("market-detail")) addSuggestion(suggestions, "/event/wimbledon-2026-men-winner", file);
  const pageMatch = file.match(/^systems\/web\/src\/pages\/(.+)\.astro$/);
  if (pageMatch) {
    const route = `/${pageMatch[1].replace(/\/index$/, "").replace(/\[\.{3}.+\]/g, "").replace(/\[[^\]]+\]/g, "sample")}`;
    if (!route.includes("sample") && route !== "/") addSuggestion(suggestions, route, file);
  }
}

if (suggestions.size === 0 && files.some((file) => file.startsWith("systems/web/"))) {
  addSuggestion(suggestions, "/", "web changed");
}

const rows = Array.from(suggestions.entries()).map(([route, reasons]) => ({
  route,
  reasons: Array.from(reasons)
}));

const command = options.sha
  ? `workspace/scripts/post-deploy-smoke.sh --sha ${options.sha}${rows.map((row) => ` --path ${row.route}`).join("")}`
  : null;

const receipt = {
  objectType: "changed_route_smoke_suggestions",
  base: options.base,
  files,
  suggestions: rows,
  command
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log("Changed Route Smoke Suggestions");
  if (rows.length === 0) {
    console.log("- no public route suggestions");
  } else {
    for (const row of rows) console.log(`- ${row.route}: ${row.reasons.join(", ")}`);
  }
  if (command) console.log(`- command: ${command}`);
}
