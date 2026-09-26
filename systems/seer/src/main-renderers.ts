import type {
  MarketContractV1,
  MarketCreationDraft,
  ReviewHandoffItem
} from "./contracts";
import type { MarketCreationReadinessItem } from "./creation-drafts";
import type { SeerSignal } from "./pipeline";
import type { SeerPayload } from "./main-types";

function truncateValue(value: string, maxLength = 220): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

export function renderContractHumanLines(contract: MarketContractV1 | undefined): string[] {
  if (!contract) {
    return ["contract: missing"];
  }

  const blockers = contract.reviewBlockers.length > 0 ? contract.reviewBlockers.join(",") : "none";
  const outcomeMap = contract.outcomeMap
    .map((outcome) => `${outcome.outcomeLabel} => ${outcome.resolutionPath}`)
    .join(" ; ");

  return [
    `contract: ${contract.measurement}`,
    `  authority: ${contract.resolutionAuthorityType}`,
    `  source: ${contract.resolutionSource.label}${contract.resolutionSource.url ? ` | ${contract.resolutionSource.url}` : ""}`,
    `  timeline: ${contract.timeline.closeShape || "missing"}${contract.timeline.closeAt ? ` | closeAt=${contract.timeline.closeAt}` : ""}`,
    `  rule: ${truncateValue(contract.resolutionRule)}`,
    `  outcomes: ${truncateValue(outcomeMap || "missing")}`,
    `  blockers: ${blockers}`
  ];
}

function renderReviewQueueItemHumanLine(item: ReviewHandoffItem): string {
  const sourceUrl = item.contract?.resolutionSource.url ?? "missing-source-url";
  const closeAt = item.contract?.timeline.closeAt ?? item.suggestedCloseShape ?? "missing-close";
  const blockers = item.contract?.reviewBlockers.length ? item.contract.reviewBlockers.join(",") : "none";
  const shaping = item.marketShaping ? ` | shaping=${item.marketShaping.tier}` : "";

  return `- ${item.reviewItemId} | ${item.candidateMarketId} | ${item.headline} | action=${item.recommendedAction}${shaping} | source=${sourceUrl} | close=${closeAt} | contractBlockers=${blockers} | failures=${item.failureReasons?.join(",") || "none"} | confidence=${item.confidence}`;
}

function renderDraftHumanLine(item: MarketCreationDraft): string {
  const sourceUrl = item.contract?.resolutionSource.url ?? item.resolutionSource;
  const blockers = item.contract?.reviewBlockers.length ? item.contract.reviewBlockers.join(",") : "none";
  const shaping = item.marketShaping ? ` | shaping=${item.marketShaping.tier}` : "";

  return `- ${item.title} | category=${item.categoryKey ?? item.category} | close=${item.closeAt} | source=${sourceUrl}${shaping} | contractBlockers=${blockers} | sources=${item.topSourceIds?.join(",") ?? "none"}`;
}

function renderReadinessHumanLine(item: MarketCreationReadinessItem): string {
  const blockers = item.blockers.length > 0 ? item.blockers.join(",") : "ready";
  const fetchNeeds = item.fetchNeeds.length > 0 ? ` | fetch=${item.fetchNeeds.join(",")}` : "";
  const contractBlockers = item.contract?.reviewBlockers.length
    ? ` | contract=${item.contract.reviewBlockers.join(",")}`
    : item.contract
      ? " | contract=ready"
      : "";
  const source = item.contract?.resolutionSource.url ? ` | source=${item.contract.resolutionSource.url}` : "";
  const close = item.contract?.timeline.closeAt ? ` | closeAt=${item.contract.timeline.closeAt}` : "";
  const shaping = item.marketShaping ? ` | shaping=${item.marketShaping.tier}` : "";

  return `- ${item.question} | action=${item.latestAction} | category=${item.category ?? "unknown"} | blockers=${blockers}${contractBlockers}${source}${close}${shaping}${fetchNeeds}`;
}

export function renderHumanSummary(payload: SeerPayload): string {
  switch (payload.command) {
    case "heartbeat":
      return [
        "seer heartbeat",
        `fetched: ${payload.heartbeatSummary?.fetchedCount ?? 0}`,
        `imported: ${payload.heartbeatSummary?.importedCount ?? 0}`,
        `skipped: ${payload.heartbeatSummary?.skippedCount ?? 0}`,
        ...(payload.heartbeatSummary?.sourceRuns ?? []).map(
          (run) =>
            `- ${run.label} | status=${run.status} | fetched=${run.fetchedCount} | imported=${run.importedCount} | skipped=${run.skippedCount}${run.note ? ` | note=${run.note}` : ""}`
        ),
        `active: ${payload.reviewQueueSections?.active.length ?? 0}`,
        `rework: ${payload.reviewQueueSections?.rework.length ?? 0}`,
        `reviewed: ${payload.reviewQueueSections?.reviewed.length ?? 0}`,
        `selectable: ${payload.reviewQueueSnapshot?.itemCount ?? payload.reviewQueue?.length ?? 0}`,
        `planned registry: ${payload.plannedRegistrySnapshot?.familyCount ?? 0} families / ${payload.plannedRegistrySnapshot?.eventCount ?? 0} events`,
        `creation drafts: ${payload.marketCreationDraftSnapshot?.itemCount ?? payload.marketCreationDrafts?.length ?? 0}`,
        ...(payload.importedSignals ?? []).map((signal) => `- imported: ${signal.title}`)
      ].join("\n");
    case "platform-shapes":
      return [
        "seer platform-shapes",
        `platforms: ${payload.platformShapeSnapshots?.length ?? 0}`,
        ...(payload.platformShapeSnapshots ?? []).flatMap((snapshot) => [
          `- ${snapshot.platform} | examples=${snapshot.exampleCount} | fetch=${snapshot.fetchUrl}`,
          ...snapshot.examples.map(
            (example) =>
              `  ${example.title} | form=${example.marketForm}${example.category ? ` | category=${example.category}` : ""}${example.closeTime ? ` | close=${example.closeTime}` : ""}`
          )
        ]),
        ...(payload.importedSignals?.length
          ? [`imported reference signals: ${payload.importedSignals.length}`, `path: ${payload.intakeLogPath ?? "unknown"}`]
          : []),
        `latest snapshot: ${payload.platformShapesPath ?? "unknown"}`
      ].join("\n");
    case "operator-lead-add":
      return [
        "seer operator-lead-add",
        `stored: ${payload.operatorLead?.leadId ?? "unknown"}`,
        `status: ${payload.operatorLead?.status ?? "unknown"}`,
        `expected lane: ${payload.operatorLead?.expectedLane ?? "unknown"}`,
        `role: ${payload.operatorLead?.leadRole ?? "unknown"}`,
        `lead log: ${payload.operatorLeadLogPath ?? "unknown"}`,
        `latest: ${payload.operatorLeadsPath ?? "unknown"}`
      ].join("\n");
    case "operator-leads":
      return [
        "seer operator-leads",
        `items: ${payload.operatorLeads?.length ?? 0}`,
        `path: ${payload.operatorLeadLogPath ?? "unknown"}`,
        ...(payload.operatorLeads ?? []).map(
          (lead) =>
            `- ${lead.leadId} | lane=${lead.expectedLane} | status=${lead.status} | role=${lead.leadRole} | source=${lead.leadSourceType} | prompt=${truncateValue(lead.rawPrompt, 120)}`
        )
      ].join("\n");
    case "import-signals":
      return [
        "seer import-signals",
        `file: ${payload.importFile ?? "unknown"}`,
        `imported: ${payload.importedCount ?? 0}`,
        `path: ${payload.intakeLogPath ?? "unknown"}`,
        ...(payload.importedSignals ?? []).map(
          (signal) => `- ${signal.title} | source=${signal.sourceId} | category=${signal.category}`
        )
      ].join("\n");
    case "intake-log":
      return [
        "seer intake-log",
        `items: ${payload.importedCount ?? 0}`,
        `path: ${payload.intakeLogPath ?? "unknown"}`,
        ...(payload.importedSignals ?? []).map(
          (signal) => `- ${signal.title} | source=${signal.sourceId} | category=${signal.category}`
        )
      ].join("\n");
    case "source-add":
      return [
        "seer source-add",
        `stored: ${payload.sourceEntry?.sourceId ?? "unknown"}`,
        `label: ${payload.sourceEntry?.label ?? "unknown"}`,
        `class: ${payload.sourceEntry?.primaryClass ?? "unknown"}`,
        `stages: ${payload.sourceEntry?.stageUsefulness.join(",") ?? "unknown"}`,
        `lifecycle: ${
          payload.sourceEntry?.lifecycleCapabilities
            ?.map(
              (capability) =>
                `${capability.measurementKind}/${capability.resultShape}/${capability.oracleCapability}`
            )
            .join(",") ?? "none"
        }`,
        `path: ${payload.sourceRegistryPath ?? "unknown"}`
      ].join("\n");
    case "sources":
      return [
        "seer sources",
        `sources: ${payload.sourceRegistry?.length ?? 0}`,
        `manual log: ${payload.sourceRegistryPath ?? "unknown"}`,
        ...(payload.sourceRegistry ?? []).map(
          (source) => `- ${source.label} | class=${source.primaryClass} | stages=${source.stageUsefulness.join(",")}`
        )
      ].join("\n");
    case "market-families":
      return [
        "seer market-families",
        `families: ${payload.marketFamilies?.length ?? 0}`,
        ...(payload.marketFamilies ?? []).map(
          (family) =>
            `- ${family.familyKey} | ${family.labelHe} | category=${family.category} | route=${family.measurementKind}/${family.resultShape} | sources=${family.sourceCandidates.map((sourceCandidate) => `${sourceCandidate.sourceId}:${sourceCandidate.adapterReadiness}`).join(",")}`
        )
      ].join("\n");
    case "family-readiness":
      return [
        "seer family-readiness",
        `families: ${payload.familyReadinessSnapshot?.familyCount ?? 0}`,
        `routes: ${payload.familyReadinessSnapshot?.routeCount ?? 0}`,
        `status: ${Object.entries(payload.familyReadinessSnapshot?.statusCounts ?? {})
          .filter(([, count]) => count > 0)
          .map(([status, count]) => `${status}=${count}`)
          .join(",")}`,
        ...(payload.familyReadinessSnapshot?.items ?? []).map(
          (family) =>
            `- ${family.familyKey} | ${family.labelHe} | best=${family.bestReadinessStatus} | next=${family.operatorNextAction}`
        )
      ].join("\n");
    case "scan":
      return renderScanHumanSummary(payload.signals ?? []);
    case "cluster":
      return [
        "seer cluster",
        `lineages: ${payload.lineages?.length ?? 0}`,
        `tracked events: ${payload.trackedEvents?.length ?? 0}`,
        ...(payload.trackedEvents ?? []).map(
          (event) =>
            `- ${event.title} | lane=${event.eventLane ?? "unknown"} | maturity=${event.maturity} | next=${event.nextSuggestedAction}${event.liveEvent ? ` | liveNext=${event.liveEvent.nextGate}` : ""}`
        )
      ].join("\n");
    case "propose":
      return [
        "seer propose",
        `candidate markets: ${payload.candidateMarkets?.length ?? 0}`,
        ...(payload.candidateMarkets ?? []).map(
          (market) =>
            `- ${market.question} | status=${market.status} | readiness=${market.worthinessAssessment.reviewReadiness} | failures=${market.worthinessAssessment.failureReasons.join(",") || "none"}`
        )
      ].join("\n");
    case "review-queue":
      return [
        "seer review-queue",
        `active: ${payload.reviewQueueSections?.active.length ?? 0}`,
        `rework: ${payload.reviewQueueSections?.rework.length ?? 0}`,
        `reviewed: ${payload.reviewQueueSections?.reviewed.length ?? 0}`,
        `selectable: ${payload.reviewQueueSnapshot?.itemCount ?? payload.reviewQueue?.length ?? 0}`,
        `planned registry: ${payload.plannedRegistrySnapshot?.familyCount ?? 0} families / ${payload.plannedRegistrySnapshot?.eventCount ?? 0} events`,
        `stored: ${payload.reviewQueueSnapshot?.snapshotId ?? "unknown"}`,
        `latest: ${payload.reviewQueuePath ?? "unknown"}`,
        ...(payload.reviewQueue ?? []).map(renderReviewQueueItemHumanLine)
      ].join("\n");
    case "queue-latest":
      return [
        "seer queue-latest",
        `snapshot: ${payload.reviewQueueSnapshot?.snapshotId ?? "none"}`,
        `active: ${payload.reviewQueueSections?.active.length ?? 0}`,
        `rework: ${payload.reviewQueueSections?.rework.length ?? 0}`,
        `reviewed: ${payload.reviewQueueSections?.reviewed.length ?? 0}`,
        `selectable: ${payload.reviewQueueSnapshot?.itemCount ?? 0}`,
        `path: ${payload.reviewQueuePath ?? "unknown"}`,
        ...((payload.reviewQueueSnapshot?.items ?? []).map(
          (item) => `- ${item.headline} | action=${item.recommendedAction} | confidence=${item.confidence}`
        ))
      ].join("\n");
    case "queue-history":
      return [
        "seer queue-history",
        `snapshots: ${payload.reviewQueueHistory?.length ?? 0}`,
        `path: ${payload.reviewQueueHistoryPath ?? "unknown"}`,
        ...((payload.reviewQueueHistory ?? []).map(
          (snapshot) => `- ${snapshot.snapshotId} | items=${snapshot.itemCount} | generated=${snapshot.generatedAt}`
        ))
      ].join("\n");
    case "planned-registry":
      return [
        "seer planned-registry",
        `snapshot: ${payload.plannedRegistrySnapshot?.snapshotId ?? "none"}`,
        `families: ${payload.plannedRegistrySnapshot?.familyCount ?? 0}`,
        `events: ${payload.plannedRegistrySnapshot?.eventCount ?? 0}`,
        `bindings: ${payload.plannedRegistrySnapshot?.bindingCount ?? 0}`,
        `path: ${payload.plannedRegistryPath ?? "unknown"}`,
        ...((payload.plannedRegistrySnapshot?.marketBindings ?? []).map(
          (binding) =>
            `- ${binding.question} | family=${binding.familyId} | event=${binding.eventId} | market=${binding.marketFamilyKey} | authority=${binding.resolutionAuthorityType ?? "unknown"}`
        ))
      ].join("\n");
    case "planned-registry-history":
      return [
        "seer planned-registry-history",
        `snapshots: ${payload.plannedRegistryHistory?.length ?? 0}`,
        `path: ${payload.plannedRegistryHistoryPath ?? "unknown"}`,
        ...((payload.plannedRegistryHistory ?? []).map(
          (snapshot) =>
            `- ${snapshot.snapshotId} | families=${snapshot.familyCount} | events=${snapshot.eventCount} | bindings=${snapshot.bindingCount} | generated=${snapshot.generatedAt}`
        ))
      ].join("\n");
    case "family-requests":
      return [
        "seer family-requests",
        `items: ${payload.sourceFamilyRequestSnapshot?.itemCount ?? payload.sourceFamilyRequests?.length ?? 0}`,
        `latest: ${payload.sourceFamilyRequestsPath ?? "unknown"}`,
        ...(payload.sourceFamilyRequests ?? []).map(
          (request) =>
            `- ${request.sourceId} | ${request.measurementKind}/${request.resultShape} | status=${request.status} | next=${request.operatorNextAction} | candidates=${request.requestedByCandidateMarketIds.length}`
        )
      ].join("\n");
    case "family-requests-latest":
      return [
        "seer family-requests-latest",
        `snapshot: ${payload.sourceFamilyRequestSnapshot?.snapshotId ?? "none"}`,
        `items: ${payload.sourceFamilyRequestSnapshot?.itemCount ?? 0}`,
        `path: ${payload.sourceFamilyRequestsPath ?? "unknown"}`,
        ...((payload.sourceFamilyRequestSnapshot?.items ?? []).map(
          (request) =>
            `- ${request.sourceId} | ${request.measurementKind}/${request.resultShape} | status=${request.status} | next=${request.operatorNextAction}`
        ))
      ].join("\n");
    case "review-feedback":
      return [
        "seer review-feedback",
        `stored: ${payload.feedbackItem?.reviewFeedbackId ?? "unknown"}`,
        `review item: ${payload.feedbackItem?.reviewItemId ?? "unknown"}`,
        `action: ${payload.feedbackItem?.action ?? "unknown"}`,
        `feedback log: ${payload.feedbackLogPath ?? "unknown"}`,
        ...(payload.reworkAttempt
          ? [
              `rework: ${payload.reworkAttempt.status}`,
              `change-summary: ${payload.reworkAttempt.changeSummary}`
            ]
          : [])
      ].join("\n");
    case "feedback-log":
      return [
        "seer feedback-log",
        `items: ${payload.feedbackLog?.length ?? 0}`,
        `path: ${payload.feedbackLogPath ?? "unknown"}`,
        ...(payload.feedbackLog ?? []).map(
          (item) => `- ${item.reviewItemId} | ${item.action} | ${item.reasonCategory}`
        )
      ].join("\n");
    case "rework-log":
      return [
        "seer rework-log",
        `items: ${payload.reworkAttempts?.length ?? 0}`,
        `path: ${payload.reworkLogPath ?? "unknown"}`,
        ...(payload.reworkAttempts ?? []).map(
          (item) =>
            `- ${item.reviewItemId} | ${item.status} | ${item.reasonCategory} | ${item.changeSummary}`
        )
      ].join("\n");
    case "create-drafts":
      return [
        "seer create-drafts",
        `items: ${payload.marketCreationDraftSnapshot?.itemCount ?? payload.marketCreationDrafts?.length ?? 0}`,
        `snapshot: ${payload.marketCreationDraftSnapshot?.snapshotId ?? "unknown"}`,
        `latest: ${payload.marketCreationDraftsPath ?? "unknown"}`,
        ...(payload.marketCreationDrafts ?? []).map(renderDraftHumanLine)
      ].join("\n");
    case "draft-readiness":
      return [
        "seer draft-readiness",
        `items: ${payload.marketCreationReadiness?.length ?? 0}`,
        ...(payload.marketCreationReadiness ?? []).map(renderReadinessHumanLine)
      ].join("\n");
    case "drafts-latest":
      return [
        "seer drafts-latest",
        `snapshot: ${payload.marketCreationDraftSnapshot?.snapshotId ?? "none"}`,
        `items: ${payload.marketCreationDraftSnapshot?.itemCount ?? 0}`,
        `path: ${payload.marketCreationDraftsPath ?? "unknown"}`,
        ...((payload.marketCreationDraftSnapshot?.items ?? []).map(renderDraftHumanLine))
      ].join("\n");
    case "drafts-history":
      return [
        "seer drafts-history",
        `snapshots: ${payload.marketCreationDraftHistory?.length ?? 0}`,
        `path: ${payload.marketCreationDraftHistoryPath ?? "unknown"}`,
        ...((payload.marketCreationDraftHistory ?? []).map(
          (snapshot) => `- ${snapshot.snapshotId} | items=${snapshot.itemCount} | generated=${snapshot.generatedAt}`
        ))
      ].join("\n");
  }
}

export function renderScanHumanSummary(signals: SeerSignal[]): string {
  const groups = new Map<
    string,
    {
      title: string;
      origins: Set<string>;
      intakeLanes: Set<string>;
      classes: Set<string>;
      categories: Set<string>;
      marketability: Set<string>;
      refs: string[];
    }
  >();

  for (const signal of signals) {
    const current = groups.get(signal.clusterKey) ?? {
      title: signal.title,
      origins: new Set<string>(),
      intakeLanes: new Set<string>(),
      classes: new Set<string>(),
      categories: new Set<string>(),
      marketability: new Set<string>(),
      refs: []
    };

    current.origins.add(signal.signalOrigin);
    current.intakeLanes.add(signal.intakeLane);
    current.classes.add(signal.sourceClass);
    current.categories.add(signal.category);
    current.marketability.add(signal.marketability);

    if (!current.refs.includes(signal.sourceRef)) {
      current.refs.push(signal.sourceRef);
    }

    groups.set(signal.clusterKey, current);
  }

  return [
    "seer scan",
    `cards: ${groups.size}`,
    `raw signals: ${signals.length}`,
    ...[...groups.values()].map(
      (group) =>
        `- ${group.title} | lane=${[...group.intakeLanes].join(",")} | category=${[...group.categories].join(",")} | marketability=${[...group.marketability].join(",")} | origins=${[...group.origins].join(",")} | classes=${[...group.classes].join(",")} | sources=${group.refs.join(" ; ")}`
    )
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "Usage: npm --prefix systems/back run seer -- <command> [--json]",
    "",
    "Commands:",
    "  heartbeat        Fetch heartbeat sources, append new signals, and rebuild the queue.",
    "  platform-shapes  Pull Polymarket + Kalshi reference markets for shape/data learning.",
    "  operator-lead-add Capture one human/operator lead receipt.",
    "  operator-leads   Show stored operator lead receipts.",
    "  import-signals   Import manual seer signals from a JSON or JSONL file.",
    "  intake-log       Show imported manual seer signals.",
    "  source-add       Add one manual source entry to the registry log.",
    "  sources          Show the seer source registry.",
    "  market-families  Show the market-family registry used before creation drafts.",
    "  family-readiness Show family/source/adapter readiness in one operator view.",
    "  scan             Emit the seeded signal intake set.",
    "  cluster          Emit lineages plus tracked events.",
    "  propose          Emit candidate market objects.",
    "  review-queue     Emit and persist review-ready handoff items.",
    "  queue-latest     Show the latest persisted review queue snapshot.",
    "  queue-history    Show persisted review queue snapshot history.",
    "  planned-registry Show the latest planned family/event/market registry snapshot.",
    "  planned-registry-history Show persisted planned registry snapshot history.",
    "  family-requests Show and persist Seer -> Oracle source-family adapter requests.",
    "  family-requests-latest Show the latest persisted source-family request snapshot.",
    "  review-feedback  Append one review decision to the feedback log.",
    "  feedback-log     Show the stored review feedback log.",
    "  rework-log       Show recorded rework attempts and replay state.",
    "  create-drafts    Build and persist backend-ready market creation drafts.",
    "  draft-readiness  Explain why reviewed items did or did not cross into creation drafts.",
    "  drafts-latest    Show the latest persisted market creation draft snapshot.",
    "  drafts-history   Show persisted market creation draft snapshot history.",
    "",
    "Flags:",
    "  --json           Print machine-readable JSON payload.",
    "  --lifecycle      For source-add: pipe-separated measurementKind/resultShape/oracleCapability triples.",
    "  --as-signals     For platform-shapes only: also import reference examples into the manual signal log.",
    "  --bridge-only    For heartbeat only: return source-run/import summary without rebuilding review surfaces.",
    "  --include-manual For family-requests only: include known manual-resolution families as upgrade candidates.",
    "  --help           Show this help."
  ].join("\n");
}
