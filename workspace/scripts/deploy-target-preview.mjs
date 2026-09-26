#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const serviceFlags = {
  backend: "--backend",
  web: "--web",
  gateway: "--gateway",
  horizon: "--horizon",
  oracle: "--oracle",
  marketWatch: "--market-watch",
  prodDoctor: "--prod-doctor"
};

function usage() {
  console.log(`Usage:
  workspace/scripts/deploy-target-preview.mjs [options]

Options:
  --base <ref>       Compare committed stack against this ref. Defaults to origin/main.
  --json             Emit JSON.
  -h, --help         Show help.

Purpose:
  Pre-push/redeploy target classifier. It does not deploy.
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

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"]
    }).trim();
  } catch (error) {
    if (options.allowFailure) return "";
    throw error;
  }
}

function lines(output) {
  return output ? output.split("\n").filter(Boolean) : [];
}

function parseStatus(output) {
  return lines(output).map((line) => ({
    code: line.slice(0, 2),
    path: line[2] === " " ? line.slice(3) : line.slice(2).trimStart()
  }));
}

function starts(file, prefix) {
  return file === prefix || file.startsWith(`${prefix}/`);
}

function classify(files) {
  const targets = new Set();
  const reasons = [];
  const add = (target, reason) => {
    targets.add(target);
    reasons.push({ target, reason });
  };

  for (const file of files) {
    if (starts(file, "systems/web") || file === "workspace/deploy/docker/web.Dockerfile") {
      add("web", file);
    }
    if (starts(file, "systems/back") || file === "workspace/deploy/docker/backend.Dockerfile") {
      add("backend", file);
    }
    if (starts(file, "systems/oracle")) {
      add("oracle", file);
    }
    if (file === "workspace/deploy/Caddyfile" || starts(file, "workspace/deploy/gateway")) {
      add("gateway", file);
    }
    if (file === "render.yaml") {
      add("backend", "render.yaml changed");
      add("web", "render.yaml changed");
      add("horizon", "render.yaml changed");
      add("oracle", "render.yaml changed");
      add("marketWatch", "render.yaml changed");
      add("prodDoctor", "render.yaml changed");
    }
    if (starts(file, "systems/back/src/lifecycle") || starts(file, "systems/oracle/src")) {
      add("horizon", file);
      add("oracle", file);
    }
    if (file.includes("horizon") || file.includes("scheduler")) {
      add("horizon", file);
    }
    if (file.includes("market-watch")) {
      add("marketWatch", file);
    }
    if (file.includes("production-integrity") || file.includes("production-doctor")) {
      add("prodDoctor", file);
    }
    if (file === "package.json" || file === "package-lock.json") {
      add("backend", file);
      add("web", file);
      add("horizon", file);
      add("oracle", file);
      add("marketWatch", file);
      add("prodDoctor", file);
    }
  }

  if (targets.has("backend")) {
    reasons.push({ target: "migration-plan", reason: "backend deploy selected" });
  }

  return {
    targets: Array.from(targets),
    reasons
  };
}

function commandFor(targets, sha) {
  if (targets.length === 0) return "";
  const args = ["./workspace/scripts/render-deploy-stack.sh", "--sha", sha];
  for (const target of targets) {
    const flag = serviceFlags[target];
    if (flag) args.push(flag);
  }
  if (targets.length > 0) args.push("--smoke");
  return args.join(" ");
}

const options = parseArgs(process.argv.slice(2));
const head = git(["rev-parse", "HEAD"]);
const ahead = lines(git(["log", "--oneline", "--decorate", `${options.base}..HEAD`], { allowFailure: true }));
const committedFiles = lines(git(["diff", "--name-only", `${options.base}..HEAD`], { allowFailure: true }));
const dirty = parseStatus(git(["status", "--porcelain=v1"], { allowFailure: true }));
const diffCheck = git(["diff", "--check", `${options.base}..HEAD`], { allowFailure: true });
const classification = classify(committedFiles);
const deployCommand = commandFor(classification.targets, head);

const receipt = {
  objectType: "deploy_target_preview",
  base: options.base,
  head,
  ahead,
  committedFileCount: committedFiles.length,
  committedFiles,
  dirty,
  targets: classification.targets,
  reasons: classification.reasons,
  migrationPlan: classification.targets.includes("backend"),
  dryRunCommand: deployCommand.replace("./workspace/scripts/render-deploy-stack.sh", "./workspace/scripts/render-deploy-stack.sh --dry-run"),
  deployCommand,
  diffCheck: diffCheck ? "failed" : "passed",
  diffCheckOutput: diffCheck
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log("Deploy Target Preview");
  console.log(`- base: ${receipt.base}`);
  console.log(`- head: ${receipt.head}`);
  console.log(`- commits ahead: ${ahead.length}`);
  for (const commit of ahead.slice(0, 12)) console.log(`  ${commit}`);
  if (ahead.length > 12) console.log(`  ... ${ahead.length - 12} more`);
  console.log(`- committed files: ${committedFiles.length}`);
  console.log(`- dirty files: ${dirty.length ? dirty.map((entry) => `${entry.code.trim() || "M"} ${entry.path}`).join("; ") : "none"}`);
  console.log(`- targets: ${classification.targets.length ? classification.targets.join(", ") : "none"}`);
  console.log(`- migration-plan: ${receipt.migrationPlan ? "yes" : "no"}`);
  console.log(`- diff check: ${receipt.diffCheck}`);
  if (diffCheck) console.log(diffCheck);
  console.log(`- dry-run: ${receipt.dryRunCommand || "none"}`);
  console.log(`- deploy: ${receipt.deployCommand || "none"}`);
}

if (diffCheck) process.exit(1);
