#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const roots = [
  "README.md",
  "bootstrap.md",
  "AGENTS.md",
  "PLATFORM.md",
  "ARCHITECTURE.md",
  "SECURITY.md",
  "systems/README.md",
  "systems/design/README.md",
  "systems/back/README.md",
  "systems/seer/README.md",
  "systems/oracle/README.md",
  "systems/social/README.md",
  "workspace/tasks/current.md",
  "workspace/docs",
];
const defaultSkippedDirs = [
  path.join("workspace", "docs", "history"),
  path.join("workspace", "docs", "agents", "seer", "archive"),
  path.join("workspace", "docs", "research"),
  path.join("workspace", "docs", "superpowers"),
  path.join("workspace", "docs", "deep research"),
];

function walk(dir, includeAll = false) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);
    if (!includeAll && defaultSkippedDirs.includes(relativePath)) continue;
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, includeAll));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function listDocFiles(includeAll = false) {
  const files = [];

  for (const item of roots) {
    const fullPath = path.join(repoRoot, item);
    try {
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        files.push(...walk(fullPath, includeAll));
      } else if (stats.isFile() && fullPath.endsWith(".md")) {
        files.push(fullPath);
      }
    } catch {
      // ignore missing optional files
    }
  }

  return [...new Set(files)].sort();
}

function firstHeading(lines) {
  const line = lines.find((candidate) => candidate.startsWith("# "));
  return line ? line.replace(/^# /, "").trim() : "";
}

function sectionBullets(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];

  const bullets = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    if (/^[A-Z][^:]+:$/.test(line.trim())) break;
    const match = line.match(/^- (.+)$/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function summaryFor(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const title = firstHeading(lines) || path.basename(filePath);
  const purpose = sectionBullets(lines, "Purpose:");
  const useWhen = sectionBullets(lines, "Use this when:");
  const readWhen = sectionBullets(lines, "Read when:");
  const summaryBits = [];

  if (purpose.length > 0) summaryBits.push(`purpose: ${purpose.join("; ")}`);
  if (useWhen.length > 0) summaryBits.push(`use: ${useWhen.join("; ")}`);
  if (readWhen.length > 0) summaryBits.push(`read: ${readWhen.join("; ")}`);

  if (summaryBits.length === 0) {
    const firstParagraph = lines
      .filter((line) => line.trim() && !line.startsWith("#"))
      .slice(0, 2)
      .join(" ")
      .trim();
    if (firstParagraph) summaryBits.push(firstParagraph);
  }

  return {
    path: path.relative(repoRoot, filePath),
    title,
    summary: summaryBits.join(" | "),
    haystack: `${path.relative(repoRoot, filePath)}\n${title}\n${content}`.toLowerCase(),
  };
}

function usage() {
  console.log(`docs-list: quick doc inventory

usage:
  ./workspace/scripts/docs-list.mjs
  ./workspace/scripts/docs-list.mjs <query>

examples:
  ./workspace/scripts/docs-list.mjs workstation
  ./workspace/scripts/docs-list.mjs preview
  ./workspace/scripts/docs-list.mjs auth
`);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const includeAll = args.includes("--all");
const query = args
  .filter((arg) => arg !== "--all")
  .join(" ")
  .trim()
  .toLowerCase();
const docs = listDocFiles(includeAll).map(summaryFor);
const filtered = query
  ? docs.filter((doc) => doc.haystack.includes(query))
  : docs;

for (const doc of filtered) {
  console.log(`${doc.path}`);
  console.log(`  ${doc.title}`);
  if (doc.summary) console.log(`  ${doc.summary}`);
}

if (filtered.length === 0) {
  console.error(`no docs matched: ${query}`);
  process.exit(1);
}
