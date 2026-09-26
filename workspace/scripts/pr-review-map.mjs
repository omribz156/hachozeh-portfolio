#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const options = {
  pr: null,
  format: "markdown",
  fetch: true
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--pr") {
    options.pr = args[++i];
  } else if (arg === "--format") {
    options.format = args[++i];
  } else if (arg === "--no-fetch") {
    options.fetch = false;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`Usage:
  npm run pr:review-map -- --pr 3 [--format markdown|json] [--no-fetch]

Builds a read-only PR merge map:
  - GitHub state, checks, draft/mergeability
  - touched files grouped by project lane
  - risk/reward cues from changed files
  - overlap between incoming PR files and local dirty WIP
  - safe merge and local pull commands
`);
    process.exit(0);
  } else if (!options.pr && /^\d+$/.test(arg)) {
    options.pr = arg;
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

if (!options.pr) {
  throw new Error("Missing PR number. Use --pr 3.");
}

let repoRoot = process.cwd();
repoRoot = exec("git", ["rev-parse", "--show-toplevel"]).trim();
process.chdir(repoRoot);

const pr = readPr(options.pr);
const prNumber = String(pr.number || options.pr);
const baseRef = pr.baseRefName || "main";
const headRef = `refs/remotes/origin/pr/${prNumber}-head`;
const mergeRef = `refs/remotes/origin/pr/${prNumber}-merge`;
const baseRemote = `origin/${baseRef}`;

if (options.fetch) {
  safeGitFetch(["origin", baseRef]);
  try {
    safeGitFetch(["origin", `+pull/${prNumber}/head:${headRef}`]);
  } catch (error) {
    warn(`PR head fetch failed: ${String(error.message || error)}`);
  }
  try {
    safeGitFetch(["origin", `+pull/${prNumber}/merge:${mergeRef}`]);
  } catch {
    // Merged PRs commonly lose the synthetic merge ref. The head ref is enough
    // for surface/risk mapping.
  }
}

const changedEntries = readChangedEntries(baseRemote, headRef);
const changedFiles = changedEntries.map((entry) => entry.file);
const dirtyFiles = readDirtyFiles();
const overlap = changedFiles.filter((file) => dirtyFiles.has(file));
const lanes = groupByLane(changedFiles);
const riskCues = buildRiskCues(changedFiles);
const rewardCues = buildRewardCues(changedFiles);
const checks = summarizeChecks(pr.statusCheckRollup || []);
const local = readLocalState(baseRemote);
const mergePlan = buildMergePlan(pr, checks, overlap, dirtyFiles.size);

const report = {
  pr: {
    number: prNumber,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision || "",
    baseRefName: baseRef,
    headRefName: pr.headRefName
  },
  checks,
  commits: (pr.commits || []).map((commit) => ({
    oid: commit.oid,
    headline: commit.messageHeadline
  })),
  surface: {
    changedFileCount: changedFiles.length,
    lanes,
    changedEntries
  },
  cues: {
    rewards: rewardCues,
    risks: riskCues
  },
  local: {
    branch: local.branch,
    head: local.head,
    baseRemote,
    remoteHead: local.remoteHead,
    dirtyFileCount: dirtyFiles.size,
    overlap
  },
  mergePlan
};

if (options.format === "json") {
  console.log(JSON.stringify(report, null, 2));
} else if (options.format === "markdown") {
  printMarkdown(report);
} else {
  throw new Error(`Unsupported format: ${options.format}`);
}

function exec(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    cwd: repoRoot || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function safeGitFetch(fetchArgs) {
  exec("git", ["fetch", ...fetchArgs]);
}

function readPr(number) {
  const fields = [
    "number",
    "title",
    "state",
    "isDraft",
    "mergeable",
    "mergeStateStatus",
    "reviewDecision",
    "headRefName",
    "baseRefName",
    "url",
    "statusCheckRollup",
    "commits"
  ];
  const output = exec("gh", ["pr", "view", String(number), "--json", fields.join(",")]);
  return JSON.parse(output);
}

function readChangedEntries(base, head) {
  try {
    exec("git", ["rev-parse", "--verify", base]);
    exec("git", ["rev-parse", "--verify", head]);
  } catch {
    return [];
  }

  const output = exec("git", ["diff", "--name-status", `${base}...${head}`]).trim();
  if (!output) return [];
  return output.split("\n").map((line) => {
    const parts = line.split("\t");
    return {
      status: parts[0],
      file: parts[parts.length - 1]
    };
  });
}

function readDirtyFiles() {
  const output = exec("git", ["status", "--porcelain=v1"]).trim();
  const files = new Set();
  if (!output) return files;

  for (const line of output.split("\n")) {
    const rawPath = line.slice(3);
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
    files.add(path.replace(/^"|"$/g, ""));
  }
  return files;
}

function readLocalState(baseRemote) {
  return {
    branch: safeExec("git", ["branch", "--show-current"]).trim() || "(detached)",
    head: safeExec("git", ["rev-parse", "--short", "HEAD"]).trim(),
    remoteHead: safeExec("git", ["rev-parse", "--short", baseRemote]).trim()
  };
}

function safeExec(command, commandArgs) {
  try {
    return exec(command, commandArgs);
  } catch {
    return "";
  }
}

function summarizeChecks(rollup) {
  const seen = new Set();
  const checks = [];
  for (const check of rollup) {
    const summary = {
      name: check.name || check.workflowName || check.__typename,
      workflow: check.workflowName || "",
      status: check.status || "",
      conclusion: check.conclusion || "",
      url: check.detailsUrl || ""
    };
    const key = `${summary.name}|${summary.workflow}|${summary.status}|${summary.conclusion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push(summary);
  }
  return checks;
}

function groupByLane(files) {
  const groups = new Map();
  for (const file of files) {
    const lane = laneFor(file);
    if (!groups.has(lane)) groups.set(lane, []);
    groups.get(lane).push(file);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function laneFor(file) {
  if (file.startsWith("systems/back/")) return "back";
  if (file.startsWith("systems/web/")) return "web";
  if (file.startsWith("systems/seer/")) return "seer";
  if (file.startsWith("systems/oracle/")) return "oracle";
  if (file.startsWith("systems/social/")) return "social";
  if (file.startsWith("systems/design/") || file.startsWith("systems/front/")) return "design lab";
  if (file.startsWith(".github/") || file.startsWith("workspace/scripts/") || file === "package-lock.json") {
    return "tooling/CI";
  }
  if (file.startsWith("workspace/")) return "docs/tasks/coordination";
  return "other";
}

function buildRewardCues(files) {
  const rewards = [];
  if (files.some((file) => file.includes("migrations/"))) rewards.push("adds or changes persisted data shape");
  if (files.some((file) => file.includes("src/http/"))) rewards.push("adds or changes backend API behavior");
  if (files.some((file) => file.includes("systems/web/"))) rewards.push("adds or changes user-facing web behavior");
  if (files.some((file) => file.includes("/test/") || file.includes("/tests/"))) rewards.push("includes automated test coverage");
  if (files.some((file) => file.startsWith("workspace/coordination/"))) rewards.push("leaves coordination/context notes");
  return rewards.length ? rewards : ["inspect PR description and commits for user-visible value"];
}

function buildRiskCues(files) {
  const risks = [];
  if (files.some((file) => file.includes("migrations/"))) risks.push("schema/data migration: check deploy and rollback posture");
  if (files.some((file) => file.includes("rate-limit") || file.includes("fastify-app"))) {
    risks.push("API seam changed: check auth, rate limit, error mapping, and callers");
  }
  if (files.some((file) => file.includes("ledger") || file.includes("portfolio") || file.includes("purchase"))) {
    risks.push("money/portfolio path changed: check accounting invariants and duplicate refreshes");
  }
  if (files.some((file) => file.startsWith(".github/") || file.startsWith("workspace/scripts/"))) {
    risks.push("CI/tooling changed: check whether policy gates were weakened or noisy");
  }
  if (files.some((file) => file === "package-lock.json" || file.endsWith("package.json"))) {
    risks.push("dependency graph changed: check lockfile intent");
  }
  if (!files.some((file) => file.includes("/test/") || file.includes("/tests/"))) {
    risks.push("no test files touched");
  }
  return risks;
}

function buildMergePlan(prData, checkSummary, overlap, dirtyCount) {
  const failing = checkSummary.filter((check) => {
    if (check.status && check.status !== "COMPLETED") return true;
    return check.conclusion && check.conclusion !== "SUCCESS" && check.conclusion !== "SKIPPED";
  });
  const steps = [];
  if (prData.state === "MERGED") {
    steps.push("PR is already merged");
    if (dirtyCount > 0 && overlap.length > 0) {
      steps.push("local pull: git stash push -u, git pull --ff-only, git stash apply stash@{0}, inspect conflicts");
    } else if (dirtyCount > 0) {
      steps.push("local pull: git pull --ff-only is likely safe; stash first if the WIP matters");
    } else {
      steps.push("local pull: git pull --ff-only");
    }
    return { failingChecks: failing, steps };
  }
  if (prData.isDraft) steps.push(`gh pr ready ${prData.number}`);
  if (failing.length) steps.push("wait for or fix failing checks before merge");
  if (prData.mergeable !== "MERGEABLE" || prData.mergeStateStatus !== "CLEAN") {
    steps.push("update branch or resolve conflicts before merge");
  }
  if (!failing.length && prData.mergeable === "MERGEABLE" && prData.mergeStateStatus === "CLEAN") {
    steps.push(`gh pr merge ${prData.number} --squash --delete-branch --subject ${JSON.stringify(prData.title)}`);
  }
  if (dirtyCount > 0) {
    if (overlap.length > 0) {
      steps.push("local pull: git stash push -u, git pull --ff-only, git stash apply stash@{0}, inspect conflicts");
    } else {
      steps.push("local pull: git pull --ff-only is likely safe; stash first if the WIP matters");
    }
  } else {
    steps.push("local pull: git pull --ff-only");
  }
  return { failingChecks: failing, steps };
}

function printMarkdown(data) {
  console.log(`# PR Git Review Map`);
  console.log("");
  console.log(`PR: #${data.pr.number} ${data.pr.title}`);
  console.log(`URL: ${data.pr.url}`);
  console.log(`State: ${data.pr.state}${data.pr.isDraft ? " (draft)" : ""}`);
  console.log(`Merge: ${data.pr.mergeable} / ${data.pr.mergeStateStatus}`);
  console.log(`Base/head: ${data.pr.baseRefName} <- ${data.pr.headRefName}`);
  console.log("");

  console.log("## Checks");
  if (!data.checks.length) {
    console.log("- none reported");
  } else {
    for (const check of data.checks) {
      console.log(`- ${check.name}: ${check.status || "unknown"} / ${check.conclusion || "pending"}`);
    }
  }
  console.log("");

  console.log("## Surface");
  console.log(`Changed files: ${data.surface.changedFileCount}`);
  for (const [lane, files] of Object.entries(data.surface.lanes)) {
    console.log(`- ${lane}: ${files.length}`);
  }
  console.log("");

  console.log("## Rewards");
  for (const cue of data.cues.rewards) console.log(`- ${cue}`);
  console.log("");

  console.log("## Risks");
  for (const cue of data.cues.risks) console.log(`- ${cue}`);
  console.log("");

  console.log("## Local Pull Risk");
  console.log(`Local branch: ${data.local.branch}`);
  console.log(`Local/remote base: ${data.local.head} / ${data.local.remoteHead}`);
  console.log(`Dirty files: ${data.local.dirtyFileCount}`);
  if (data.local.overlap.length) {
    console.log("Incoming PR overlaps local dirty files:");
    for (const file of data.local.overlap) console.log(`- ${file}`);
  } else {
    console.log("Incoming PR does not overlap local dirty files.");
  }
  console.log("");

  console.log("## Merge Plan");
  for (const step of data.mergePlan.steps) console.log(`- ${step}`);
  console.log("");

  console.log("## Changed Files");
  for (const entry of data.surface.changedEntries) {
    console.log(`- ${entry.status} ${entry.file}`);
  }
}

function warn(message) {
  process.stderr.write(`warning: ${message}\n`);
}
