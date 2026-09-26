import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import { Command } from "commander";

import { inferRepoRoot } from "./script-args";

type Options = {
  snapshot?: string;
  draft?: string[];
  json?: boolean;
  allProd?: boolean;
  marketPacksRoot?: string;
  summary?: boolean;
};

type Issue = {
  draftId: string;
  severity: "watch" | "blocker";
  code: string;
  detail: string;
};

type SnapshotLintReceipt = {
  objectType: "market_pack_lint";
  generatedAt: string;
  snapshot: string;
  checkedCount: number;
  blockerCount: number;
  watchCount: number;
  issues: Issue[];
};

type BatchIssue = Issue & {
  snapshot: string;
  firstSnapshot?: string;
  firstDraftId?: string;
};

type BatchLintReceipt = {
  objectType: "market_pack_lint_batch";
  generatedAt: string;
  root: string;
  checkedSnapshotCount: number;
  checkedCount: number;
  blockerCount: number;
  watchCount: number;
  issues: BatchIssue[];
  snapshots: SnapshotLintReceipt[];
};

type SnapshotLintReceiptWithMarketIds = SnapshotLintReceipt & {
  marketIds: Array<{ id: string; draftId: string }>;
};

type SummarizableReceipt = SnapshotLintReceipt | BatchLintReceipt;

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

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

function hasRoboticCopy(text: string): boolean {
  return /המועמד בכותרת|האדם שבכותרת|child markets|operator|בדיקת מפעיל חריגה/i.test(text);
}

function collectPublicCopy(item: Record<string, unknown>, contract: Record<string, unknown>): string {
  const source = readObject(contract.resolutionSource);
  const timeline = readObject(contract.timeline);
  const image = readObject(contract.image);
  const publicValues = [
    item.eventTitle,
    item.eventDescription,
    item.eventChildLabel,
    item.title,
    item.description,
    item.resolutionSource,
    item.resolutionRules,
    item.outcomes,
    contract.measurement,
    contract.resolutionRule,
    contract.delayPolicy,
    contract.payoutPolicy,
    contract.ambiguityPolicy,
    contract.dataRevisionPolicy,
    source.label,
    timeline.closeShape,
    timeline.notes,
    image.alt
  ];

  return publicValues.flatMap((value) => collectStrings(value)).map((entry) => entry.value).join("\n");
}

export function lintMarketPackItem(item: Record<string, unknown>, index = 0): Issue[] {
  const draftId = readString(item.creationDraftId) || readString(item.candidateMarketId) || `items[${index}]`;
  const issues: Issue[] = [];
  const contract = readObject(item.marketContract ?? item.market_contract ?? item.contract);
  const resolutionSource = readObject(contract.resolutionSource);
  const timeline = readObject(contract.timeline);
  const operational = readObject(contract.operational);
  const dependencyResolution = readObject(contract.dependencyResolution);
  const dependentResolution = readObject(contract.dependentResolution);
  const sourceIds = readStringArray(resolutionSource.sourceIds);
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes : [];
  const outcomeMap = Array.isArray(contract.outcomeMap) ? contract.outcomeMap : [];
  const image = readObject(contract.image);
  const event = readObject(item.event);
  const eventPolicy = readString(event.resolutionPolicy ?? item.eventResolutionPolicy);
  const allItemStrings = collectStrings(item).map((entry) => entry.value);
  const embeddedWatchPlan = readObject(item.watchPlan);

  if (!readString(item.creationDraftId)) issues.push({ draftId, severity: "blocker", code: "missing_creation_draft_id", detail: "creationDraftId is required." });
  if (!readString(item.candidateMarketId)) issues.push({ draftId, severity: "blocker", code: "missing_candidate_market_id", detail: "candidateMarketId is required." });
  if (contract.objectType !== "market_contract_v1") issues.push({ draftId, severity: "blocker", code: "missing_market_contract_v1", detail: "marketContract.objectType must be market_contract_v1." });
  if (!readString(contract.marketKindId)) issues.push({ draftId, severity: "watch", code: "missing_market_kind", detail: "market_contract.marketKindId should be stamped." });
  if (!readString(contract.measurementKind)) issues.push({ draftId, severity: "blocker", code: "missing_measurement_kind", detail: "market_contract.measurementKind is required." });
  if (!readString(contract.resultShape)) issues.push({ draftId, severity: "blocker", code: "missing_result_shape", detail: "market_contract.resultShape is required." });
  if (!readString(resolutionSource.label)) issues.push({ draftId, severity: "blocker", code: "missing_source_label", detail: "resolutionSource.label is required." });
  if (sourceIds.length === 0) issues.push({ draftId, severity: "blocker", code: "missing_source_ids", detail: "resolutionSource.sourceIds is required." });
  if (!readString(timeline.expectedResolutionAt)) issues.push({ draftId, severity: "blocker", code: "missing_expected_resolution_at", detail: "timeline.expectedResolutionAt is required." });
  if (outcomes.length > 0 && outcomeMap.length === 0) issues.push({ draftId, severity: "watch", code: "missing_outcome_map", detail: "outcomeMap should explain resolution mapping." });
  if (!readString(image.src) && !readString(image.assetId)) issues.push({ draftId, severity: "watch", code: "missing_image", detail: "No contract image asset/path found." });
  if (readString(operational.eventPack) && !eventPolicy && !readString(contract.dependencyModel)) {
    issues.push({ draftId, severity: "blocker", code: "missing_event_dependency_model", detail: "Event/pack child needs explicit dependency model or event policy." });
  }
  if (
    readString(contract.marketKindId) === "sports.tournament-winner" &&
    operational.earlyEliminationClose === true &&
    readString(dependencyResolution.acceptFact) !== "entity_eliminated" &&
    operational.terminalEvidenceAutoClose !== true
  ) {
    issues.push({ draftId, severity: "blocker", code: "nonfunctional_early_elimination", detail: "Tournament child promises early elimination but has no executable fact or terminal-evidence route." });
  }

  if (
    allItemStrings.includes("market-watch-pings-only-no-mutation") &&
    !readString(embeddedWatchPlan.id) &&
    !allItemStrings.some((value) => /^market-watch-plan=[A-Za-z0-9_.:-]+$/.test(value))
  ) {
    issues.push({
      draftId,
      severity: "watch",
      code: "missing_market_watch_plan_id",
      detail: "Market Watch is required but the draft does not name its expected plan id."
    });
  }

  if (Object.keys(embeddedWatchPlan).length > 0) {
    const hasSchedule =
      readString(embeddedWatchPlan.nextRunAt) ||
      (Array.isArray(embeddedWatchPlan.runAt) && embeddedWatchPlan.runAt.length > 0) ||
      (typeof embeddedWatchPlan.intervalMinutes === "number" && embeddedWatchPlan.intervalMinutes > 0);
    if (
      !readString(embeddedWatchPlan.id) ||
      readStringArray(embeddedWatchPlan.sourceUrls).length === 0 ||
      readStringArray(embeddedWatchPlan.entities).length === 0 ||
      readStringArray(embeddedWatchPlan.keywords).length === 0 ||
      !hasSchedule
    ) {
      issues.push({
        draftId,
        severity: "blocker",
        code: "invalid_embedded_market_watch_plan",
        detail: "Embedded watchPlan needs id, sources, entities, keywords, and a schedule."
      });
    }
  }
  if (
    readString(operational.dependentEventId) &&
    readString(dependentResolution.emitFact) !== "entity_eliminated"
  ) {
    issues.push({ draftId, severity: "blocker", code: "missing_dependent_fact_emitter", detail: "Dependent source market must emit entity_eliminated." });
  }
  if (
    readString(dependentResolution.emitFact) === "entity_eliminated" &&
    !readString(dependentResolution.targetEventId) &&
    !readString(operational.dependentEventId)
  ) {
    issues.push({ draftId, severity: "blocker", code: "missing_dependent_target_event", detail: "Elimination fact emitter must target one event." });
  }
  if (
    readString(dependentResolution.emitFact) === "entity_eliminated" &&
    !outcomeMap
      .map(readObject)
      .some((outcome) => readString(outcome.eliminatesEntityKey) || readString(outcome.eliminatedEntityKey))
  ) {
    issues.push({ draftId, severity: "blocker", code: "missing_dependent_elimination_outcome_map", detail: "Elimination fact emitter must map source outcomes to eliminated entity keys." });
  }
  if (
    readString(dependencyResolution.acceptFact) === "entity_eliminated" &&
    !readString(dependencyResolution.entityKey)
  ) {
    issues.push({ draftId, severity: "blocker", code: "missing_dependent_entity_key", detail: "Elimination fact receiver must declare an entityKey." });
  }

  if (hasRoboticCopy(collectPublicCopy(item, contract))) {
    issues.push({ draftId, severity: "watch", code: "robotic_or_backend_copy", detail: "User-facing copy appears to include backend/operator phrasing." });
  }

  if (sourceIds.includes("src_ims_daily_observations")) {
    const closeAt = readString(item.closeAt);
    const expectedPathDate = closeAt ? new Date(closeAt).toISOString().slice(0, 10).replaceAll("-", "/") : "";
    for (const endpoint of collectStrings(item)) {
      if (endpoint.value.includes("api.ims.gov.il") && /\/data\/daily\/\d{4}\/\d{2}\/\d{2}/.test(endpoint.value) && expectedPathDate && !endpoint.value.includes(`/data/daily/${expectedPathDate}`)) {
        issues.push({ draftId, severity: "blocker", code: "ims_endpoint_date_mismatch", detail: `${endpoint.path}: expected ${expectedPathDate}` });
      }
    }
  }

  return issues;
}

export function lintMarketPackSnapshot(snapshotPath: string, snapshot: { items?: Array<Record<string, unknown>> }, draftIds: string[] = []): SnapshotLintReceipt {
  const draftFilter = new Set(draftIds.map((draft) => draft.trim()).filter(Boolean));
  const items = (snapshot.items ?? []).filter((item) => draftFilter.size === 0 || draftFilter.has(readString(item.creationDraftId)));
  const ids = new Set<string>();
  const duplicateIssues: Issue[] = [];
  for (const [index, item] of items.entries()) {
    const id = readString(item.candidateMarketId);
    if (id && ids.has(id)) {
      duplicateIssues.push({ draftId: readString(item.creationDraftId) || `items[${index}]`, severity: "blocker", code: "duplicate_candidate_market_id", detail: id });
    }
    if (id) ids.add(id);
  }

  const issues = duplicateIssues.concat(items.flatMap(lintMarketPackItem));
  return {
    objectType: "market_pack_lint",
    generatedAt: new Date().toISOString(),
    snapshot: snapshotPath,
    checkedCount: items.length,
    blockerCount: issues.filter((issue) => issue.severity === "blocker").length,
    watchCount: issues.filter((issue) => issue.severity === "watch").length,
    issues
  };
}

async function discoverProdSnapshots(root: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (basename(directory) === "03-prod") {
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) output.push(resolve(directory, entry.name));
      }
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) await walk(resolve(directory, entry.name));
    }
  }

  await walk(root);
  return output.sort();
}

export function lintMarketPackBatch(root: string, snapshots: SnapshotLintReceiptWithMarketIds[]): BatchLintReceipt {
  const seenMarketIds = new Map<string, { snapshot: string; draftId: string }>();
  const duplicateIssues: BatchIssue[] = [];

  // Cross-snapshot exact duplicate candidate ids are invalid in the canonical prod shelf.
  for (const receipt of snapshots) {
    for (const market of receipt.marketIds) {
      const previous = seenMarketIds.get(market.id);
      if (previous) {
        duplicateIssues.push({
          draftId: market.draftId,
          severity: "blocker",
          code: "duplicate_candidate_market_id_across_prod_snapshots",
          detail: market.id,
          snapshot: receipt.snapshot,
          firstSnapshot: previous.snapshot,
          firstDraftId: previous.draftId
        });
      } else {
        seenMarketIds.set(market.id, { snapshot: receipt.snapshot, draftId: market.draftId });
      }
    }
  }

  const issues: BatchIssue[] = snapshots.flatMap((receipt) => receipt.issues.map((issue) => ({ ...issue, snapshot: receipt.snapshot }))).concat(duplicateIssues);
  return {
    objectType: "market_pack_lint_batch",
    generatedAt: new Date().toISOString(),
    root,
    checkedSnapshotCount: snapshots.length,
    checkedCount: snapshots.reduce((sum, receipt) => sum + receipt.checkedCount, 0),
    blockerCount: issues.filter((issue) => issue.severity === "blocker").length,
    watchCount: issues.filter((issue) => issue.severity === "watch").length,
    issues,
    snapshots: snapshots.map(({ marketIds: _marketIds, ...receipt }) => receipt)
  };
}

function summarizeReceipt(receipt: SummarizableReceipt) {
  const issueCountsByCode: Record<string, number> = {};
  for (const issue of receipt.issues) {
    issueCountsByCode[issue.code] = (issueCountsByCode[issue.code] ?? 0) + 1;
  }

  if (receipt.objectType === "market_pack_lint_batch") {
    return {
      objectType: "market_pack_lint_batch_summary",
      generatedAt: receipt.generatedAt,
      root: receipt.root,
      checkedSnapshotCount: receipt.checkedSnapshotCount,
      checkedCount: receipt.checkedCount,
      blockerCount: receipt.blockerCount,
      watchCount: receipt.watchCount,
      issueCountsByCode,
      blockerIssues: receipt.issues.filter((issue) => issue.severity === "blocker")
    };
  }

  return {
    objectType: "market_pack_lint_summary",
    generatedAt: receipt.generatedAt,
    snapshot: receipt.snapshot,
    checkedCount: receipt.checkedCount,
    blockerCount: receipt.blockerCount,
    watchCount: receipt.watchCount,
    issueCountsByCode,
    blockerIssues: receipt.issues.filter((issue) => issue.severity === "blocker")
  };
}

async function lintSnapshotFile(snapshotPath: string, draftIds: string[] = []): Promise<SnapshotLintReceiptWithMarketIds> {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { items?: Array<Record<string, unknown>> };
  const receipt = lintMarketPackSnapshot(snapshotPath, snapshot, draftIds);
  const marketIds = (snapshot.items ?? [])
    .map((item, index) => ({ id: readString(item.candidateMarketId), draftId: readString(item.creationDraftId) || `items[${index}]` }))
    .filter((item) => item.id.length > 0);
  return { ...receipt, marketIds };
}

async function run(options: Options): Promise<void> {
  const repoRoot = inferRepoRoot("NAVI_REPO_ROOT");
  if (options.allProd) {
    if (options.snapshot) throw new Error("--snapshot cannot be combined with --all-prod.");
    if ((options.draft ?? []).length > 0) throw new Error("--draft cannot be combined with --all-prod.");
    const root = options.marketPacksRoot
      ? isAbsolute(options.marketPacksRoot) ? options.marketPacksRoot : resolve(repoRoot, options.marketPacksRoot)
      : resolve(repoRoot, "workspace/market-packs");
    const snapshotPaths = await discoverProdSnapshots(root);
    const receipts = await Promise.all(snapshotPaths.map((snapshotPath) => lintSnapshotFile(snapshotPath)));
    const receipt = lintMarketPackBatch(root, receipts);
    console.log(JSON.stringify(options.summary ? summarizeReceipt(receipt) : receipt, null, options.json ? 2 : 2));
    if (receipt.blockerCount > 0) process.exitCode = 2;
    return;
  }

  if (!options.snapshot) throw new Error("--snapshot is required, or pass --all-prod.");
  const snapshotPath = isAbsolute(options.snapshot) ? options.snapshot : resolve(repoRoot, options.snapshot);
  const receipt = await lintSnapshotFile(snapshotPath, options.draft ?? []);
  console.log(JSON.stringify(options.summary ? summarizeReceipt(receipt) : receipt, null, options.json ? 2 : 2));
  if (receipt.blockerCount > 0) process.exitCode = 2;
}

if (require.main === module) {
  const program = new Command("market-pack-lint")
    .description("Static market-pack lint for content, source, dependency, image, and recurring-source risks.")
    .option("--snapshot <path>")
    .option("--all-prod", "Lint every canonical workspace/market-packs/**/03-prod/*.json snapshot.")
    .option("--market-packs-root <path>", "Override root used by --all-prod.")
    .option("--draft <creation-draft-id>", "Limit to one draft; repeatable.", repeated)
    .option("--json")
    .option("--summary", "Print compact counts and blocker details only.")
    .action(run);

  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
