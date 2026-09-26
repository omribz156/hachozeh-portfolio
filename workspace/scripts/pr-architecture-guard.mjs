#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const options = {
  base: process.env.PR_BASE_REF ? `origin/${process.env.PR_BASE_REF}` : "origin/main",
  head: "HEAD",
  format: "text",
  strict: false
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--base") {
    options.base = args[++i];
  } else if (arg === "--head") {
    options.head = args[++i];
  } else if (arg === "--format") {
    options.format = args[++i];
  } else if (arg === "--strict") {
    options.strict = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`Usage:
  npm run pr:architecture-guard -- [--base origin/main] [--head HEAD] [--format text|markdown] [--strict]

Checks changed code for:
  - deep nesting and large files
  - duplicated local function/helper names already present elsewhere
  - new API paths or direct fetches outside the known seam files
  - new route/client seams that deserve reviewer attention

Default mode is advisory and exits 0. --strict exits 1 when findings exist.
`);
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const repoRoot = exec("git", ["rev-parse", "--show-toplevel"], process.cwd()).trim();
process.chdir(repoRoot);

const codeExtensions = new Set([".js", ".mjs", ".ts", ".astro"]);
const ignoredParts = new Set(["node_modules", "dist", "build", "coverage"]);
const ignoredPathPatterns = [
  /^systems\/front\//,
  /^systems\/design\//,
  /^workspace\/archive\//,
  /^workspace\/runtime\//,
  /^workspace\/reports\//,
  /^workspace\/test\/(?:gauntlet|runs)\//
];
const knownSeamFiles = new Set([
  "systems/web/src/lib/discovery.js",
  "systems/web/src/lib/market-detail.js",
  "systems/web/src/lib/public-market-catalog.js",
  "systems/web/src/client/auth/auth-session.js",
  "systems/web/src/client/shell/header-session.client.js",
  "systems/web/src/components/market-detail/trade-ticket.client.js",
  "systems/web/src/components/market-detail/viewer-positions.client.js",
  "systems/back/src/http/app.ts",
  "systems/back/src/http/fastify-app.ts",
  "systems/back/src/http/rate-limit.ts"
]);
const knownLargeFiles = new Set([
  "systems/back/src/http/fastify-app.ts"
]);
const routeOrHandlerPatterns = [
  /^systems\/back\/src\/http\/fastify-app\.ts$/,
  /^systems\/back\/src\/http\/handlers\//,
  /^systems\/back\/src\/http\/routes\//,
  /^systems\/web\/src\/pages\/api\//
];
const commonHelperNames = new Set([
  "main",
  "init",
  "mount",
  "render",
  "setup",
  "handle",
  "request",
  "response",
  "parse",
  "format",
  "load",
  "save",
  "start",
  "stop",
  "run"
]);

const diffEntries = getChangedEntries(options.base, options.head);
const diffStatusByFile = new Map(diffEntries.map((entry) => [entry.file, entry.status]));
const changedLinesByFile = getChangedLines(options.base, options.head);
const changedFiles = diffEntries
  .map((entry) => entry.file)
  .filter((file) => isCodeFile(file) && existsSync(file));

const allCodeFiles = exec("git", ["ls-files"])
  .split("\n")
  .filter(Boolean)
  .filter((file) => isCodeFile(file) && existsSync(file));

const globalIndex = buildGlobalIndex(allCodeFiles, changedFiles);
const findings = [];

for (const file of changedFiles) {
  const content = readFileSync(file, "utf8");
  const changedLines = changedLinesByFile.get(file) || new Set();
  const isAddedFile = (diffStatusByFile.get(file) || "").startsWith("A");
  findings.push(...checkFileShape(file, content, { isAddedFile }));
  findings.push(...checkDuplicateNames(file, content, globalIndex, { changedLines, isAddedFile }));
  findings.push(...checkSeams(file, content, globalIndex, { changedLines, isAddedFile }));
}

printReport(diffEntries, changedFiles, findings, options.format);

if (options.strict && findings.length > 0) {
  process.exitCode = 1;
}

function exec(command, commandArgs, cwd = repoRoot) {
  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function getChangedEntries(base, head) {
  try {
    exec("git", ["rev-parse", "--verify", base]);
  } catch {
    const branch = base.startsWith("origin/") ? base.slice("origin/".length) : "main";
    exec("git", ["fetch", "origin", branch, "--depth=100"]);
  }

  const output = exec("git", ["diff", "--name-status", `${base}...${head}`]).trim();
  if (!output) return [];

  return output.split("\n").map((line) => {
    const parts = line.split("\t");
    const status = parts[0];
    return {
      status,
      file: parts[parts.length - 1]
    };
  });
}

function getChangedLines(base, head) {
  const changed = new Map();
  let output = "";
  try {
    output = exec("git", ["diff", "--unified=0", "--no-ext-diff", `${base}...${head}`]);
  } catch {
    return changed;
  }

  let currentFile = null;
  for (const line of output.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!changed.has(currentFile)) changed.set(currentFile, new Set());
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      const start = Number(hunkMatch[1]);
      const count = hunkMatch[2] == null ? 1 : Number(hunkMatch[2]);
      for (let i = 0; i < count; i += 1) {
        changed.get(currentFile).add(start + i);
      }
    }
  }

  return changed;
}

function isCodeFile(file) {
  const normalized = file.split(path.sep).join("/");
  if (isIgnoredFile(normalized)) return false;
  return codeExtensions.has(path.extname(normalized));
}

function isIgnoredFile(file) {
  const normalized = file.split(path.sep).join("/");
  if ([...ignoredParts].some((part) => normalized.split("/").includes(part))) return true;
  return ignoredPathPatterns.some((pattern) => pattern.test(normalized));
}

function buildGlobalIndex(files, changed) {
  const changedSet = new Set(changed);
  const functionOwners = new Map();
  const apiOwners = new Map();

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const name of extractFunctionNames(content)) {
      if (isHelperIndexExcludedFile(file)) continue;
      if (!functionOwners.has(name)) functionOwners.set(name, new Set());
      functionOwners.get(name).add(file);
    }
    if (!isTestOrToolingFile(file)) {
      for (const apiPath of extractApiPaths(content)) {
        if (!apiOwners.has(apiPath)) apiOwners.set(apiPath, new Set());
        apiOwners.get(apiPath).add(file);
      }
    }
  }

  return { changedSet, functionOwners, apiOwners };
}

function isTestOrToolingFile(file) {
  return (
    file.includes("/test/") ||
    file.includes("/tests/") ||
    /\.test\.[cm]?[jt]s$/.test(file) ||
    file.startsWith("workspace/scripts/")
  );
}

function isHelperIndexExcludedFile(file) {
  return isTestOrToolingFile(file) || file.startsWith("systems/back/src/scripts/");
}

function checkFileShape(file, content, { isAddedFile } = {}) {
  if (isTestOrToolingFile(file)) return [];
  if (!isAddedFile) return [];

  const localFindings = [];
  const lines = content.split(/\r?\n/);
  const maxIndent = Math.max(
    0,
    ...lines
      .filter((line) => line.trim() && !line.trim().startsWith("//"))
      .map((line) => Math.floor((line.match(/^\s*/)?.[0] || "").replace(/\t/g, "  ").length / 2))
  );

  if (lines.length > 450 && !knownLargeFiles.has(file) && !file.includes("/test/") && !file.includes("scripts/")) {
    localFindings.push({
      level: "warn",
      file,
      rule: "large-file",
      message: `${lines.length} lines. Check whether this belongs in a route/page file or should split into a focused module.`
    });
  }

  if (maxIndent >= 7) {
    localFindings.push({
      level: "warn",
      file,
      rule: "deep-nesting",
      message: `indent depth around ${maxIndent}. Check for nested conditionals that should become named helpers.`
    });
  }

  const srcDepth = depthAfterSrc(file);
  if (srcDepth >= 5 && !file.includes("/content/help/")) {
    localFindings.push({
      level: "note",
      file,
      rule: "deep-path",
      message: `deep src path (${srcDepth} levels after src). Verify this is a real ownership boundary, not folder salad.`
    });
  }

  return localFindings;
}

function checkDuplicateNames(file, content, index, { changedLines = new Set(), isAddedFile = false } = {}) {
  if (isTestOrToolingFile(file)) return [];

  const localFindings = [];
  const localNames = new Map(extractFunctionNamesWithLines(content));

  for (const [name, line] of localNames) {
    if (!isAddedFile && !changedLines.has(line)) continue;
    if (name.length < 4 || commonHelperNames.has(name)) continue;
    const owners = [...(index.functionOwners.get(name) || [])].filter((owner) => owner !== file);
    if (owners.length === 0) continue;

    localFindings.push({
      level: "warn",
      file,
      rule: "duplicate-helper-name",
      message: `${name}() also exists in ${owners.slice(0, 3).join(", ")}${owners.length > 3 ? " ..." : ""}. Reuse or explain the fork.`
    });
  }

  return localFindings;
}

function checkSeams(file, content, index, { changedLines = new Set(), isAddedFile = false } = {}) {
  const localFindings = [];
  const apiPaths = [...new Map(extractApiPathsWithLines(content)
    .filter((entry) => isAddedFile || changedLines.has(entry.line))
    .map((entry) => [entry.path, entry])).values()];
  const directFetches = extractFetchCallsWithLines(content).filter((entry) => isAddedFile || changedLines.has(entry.line));
  const isKnownSeam = knownSeamFiles.has(file) || routeOrHandlerPatterns.some((pattern) => pattern.test(file));
  const isTestOrTooling = isTestOrToolingFile(file);

  if (directFetches.length > 0 && !isKnownSeam && file.startsWith("systems/web/src/")) {
    localFindings.push({
      level: "warn",
      file,
      rule: "direct-fetch",
      message: `direct fetch() in web code. Prefer an existing src/lib seam or a small named client module.`
    });
  }

  for (const { path: apiPath } of apiPaths) {
    const owners = [...(index.apiOwners.get(apiPath) || [])].filter((owner) => owner !== file);
    if (owners.length > 0 && !isKnownSeam && !isTestOrTooling) {
      localFindings.push({
        level: "note",
        file,
        rule: "existing-api-seam",
        message: `${apiPath} already appears in ${owners.slice(0, 3).join(", ")}${owners.length > 3 ? " ..." : ""}. Check the existing seam before adding another caller.`
      });
    }
  }

  if (
    (apiPaths.length > 0 || isAddedFile) &&
    (file === "systems/back/src/http/fastify-app.ts" ||
      file.startsWith("systems/back/src/http/handlers/") ||
      file.startsWith("systems/back/src/http/routes/"))
  ) {
    localFindings.push({
      level: "note",
      file,
      rule: "backend-route-seam",
      message: "backend route registry changed. Confirm route-family tests and rate-limit/auth posture."
    });
  }

  if (file.startsWith("systems/web/src/pages/api/")) {
    localFindings.push({
      level: "note",
      file,
      rule: "astro-api-seam",
      message: "Astro API route changed. Confirm this belongs in web, not systems/back."
    });
  }

  return localFindings;
}

function extractFunctionNames(content) {
  return extractFunctionNamesWithLines(content).map(([name]) => name);
}

function extractFunctionNamesWithLines(content) {
  const names = [];
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g,
    /\bexport\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      names.push([match[1], lineForIndex(content, match.index ?? 0)]);
    }
  }

  return names;
}

function extractApiPaths(content) {
  return extractApiPathsWithLines(content).map((entry) => entry.path);
}

function extractApiPathsWithLines(content) {
  const paths = [];
  const pattern = /["'`]((?:\/api|\/admin|\/health)[^"'`\s)]*)["'`]/g;
  for (const match of content.matchAll(pattern)) {
    const normalized = match[1].replace(/\$\{[^}]+\}/g, "{}").replace(/\?.*$/, "");
    paths.push({ path: normalized, line: lineForIndex(content, match.index ?? 0) });
  }
  return paths;
}

function extractFetchCallsWithLines(content) {
  return [...content.matchAll(/\bfetch\s*\(/g)].map((match) => ({
    index: match.index ?? 0,
    line: lineForIndex(content, match.index ?? 0)
  }));
}

function lineForIndex(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function depthAfterSrc(file) {
  const parts = file.split("/");
  const srcIndex = parts.indexOf("src");
  if (srcIndex < 0) return 0;
  return Math.max(0, parts.length - srcIndex - 2);
}

function printReport(diffEntries, changedFiles, reportFindings, format) {
  const byLevel = {
    warn: reportFindings.filter((finding) => finding.level === "warn"),
    note: reportFindings.filter((finding) => finding.level === "note")
  };

  if (format === "markdown") {
    console.log("## PR Architecture Guard");
    console.log("");
    console.log(`Changed files: ${diffEntries.length}`);
    console.log(`Changed code files scanned: ${changedFiles.length}`);
    console.log(`Findings: ${reportFindings.length}`);
    console.log("");
    if (reportFindings.length === 0) {
      console.log("No architecture guard findings.");
      return;
    }
    for (const level of ["warn", "note"]) {
      if (byLevel[level].length === 0) continue;
      console.log(`### ${level === "warn" ? "Warnings" : "Notes"}`);
      for (const finding of byLevel[level]) {
        console.log(`- \`${finding.file}\` **${finding.rule}**: ${finding.message}`);
      }
      console.log("");
    }
    return;
  }

  console.log("PR architecture guard");
  console.log(`changed_files=${diffEntries.length}`);
  console.log(`changed_code_files=${changedFiles.length}`);
  console.log(`findings=${reportFindings.length}`);
  for (const finding of reportFindings) {
    console.log(`[${finding.level}] ${finding.file} ${finding.rule}: ${finding.message}`);
  }
}
