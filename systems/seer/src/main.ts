import type {
  CandidateMarket,
  LineageRef,
  ManualSeerSignal,
  MarketCreationDraft,
  MarketCreationDraftSnapshot,
  MarketFamilyRegistryEntry,
  OperatorLead,
  PlannedRegistrySnapshot,
  PlatformShapeSnapshot,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSections,
  ReviewQueueSnapshot,
  ReworkAttemptItem,
  SeerCommand,
  SourceClass,
  SourceFamilyRequest,
  SourceFamilyRequestSnapshot,
  SourceLifecycleCapabilityHint,
  SourceRegistryEntry,
  TrackedEvent
} from "./contracts";
import type { SeerPayload } from "./main-types";
import {
  buildAndPersistMarketCreationDraftSnapshot,
  buildMarketCreationReadiness,
  type MarketCreationReadinessItem
} from "./creation-drafts";
import type { HeartbeatSourceRun } from "./heartbeat";
import {
  appendManualSeerSignals,
  appendOperatorLead,
  appendReworkAttempt,
  appendReviewFeedback,
  getLatestMarketCreationDraftsPath,
  getLatestOperatorLeadsPath,
  getLatestSourceFamilyRequestsPath,
  getMarketCreationDraftHistoryPath,
  appendSourceRegistryEntry,
  getLatestPlatformShapesPath,
  getLatestPlannedRegistryPath,
  getManualSignalLogPath,
  getOperatorLeadLogPath,
  getLatestReviewQueuePath,
  getPlannedRegistryHistoryPath,
  getReworkAttemptLogPath,
  getReviewFeedbackLogPath,
  getReviewQueueHistoryPath,
  getSourceFamilyRequestHistoryPath,
  getSourceRegistryLogPath,
  persistLatestPlatformShapeSnapshots,
  persistSourceFamilyRequestSnapshot,
  readLatestMarketCreationDraftSnapshot,
  readLatestPlannedRegistrySnapshot,
  readLatestSourceFamilyRequestSnapshot,
  readLatestReviewQueueSnapshot,
  readMarketCreationDraftHistory,
  readManualSeerSignals,
  readOperatorLeads,
  readPlannedRegistryHistory,
  readReworkAttemptLog,
  readReviewFeedbackLog,
  readReviewQueueHistory
} from "./persistence";
import { buildSourceFamilyRequestsFromReadiness } from "./source-family-requests";
import {
  buildFamilyReadinessSnapshot,
  type FamilyReadinessSnapshot
} from "./family-readiness";
import { seededMarketFamilyRegistry } from "./market-family-registry";
import { buildOperatorLead } from "./operator-leads";
import type { SeerSignal } from "./pipeline";
import {
  fetchKalshiShapeSnapshot,
  fetchPolymarketShapeSnapshot,
  toPlatformReferenceSignals
} from "./platform-market-reference";
import {
  buildCandidateMarkets,
  buildSeerLineages,
  buildTrackedEvents,
  scanSeerSignals
} from "./pipeline";
import { runSeerHeartbeat } from "./heartbeat";
import {
  buildReworkAttempt,
  findReviewItemForFeedback,
  shouldCreateReworkAttempt
} from "./rework-loop";
import { listSeerSources } from "./source-registry";
import { slugify } from "./text";
import { renderHelp, renderHumanSummary } from "./main-renderers";
import {
  allowedSourceAuthorityProfiles,
  allowedSourceClasses,
  allowedSourceCurationModes,
  allowedSourceJobs,
  allowedSourceNoiseProfiles,
  allowedSourceSpeedProfiles,
  allowedSourceStages,
  normalizeImportedSignals,
  parseArgs,
  parseEnumList,
  parseLifecycleCapabilities,
  parseList,
  parseOptionalEnum,
  parseReviewFeedbackCommandInput,
  requireFlag,
  SEER_COMMANDS
} from "./main-args";
import {
  buildQueueSectionsFromFeedback,
  ensureReworkAttemptsBackfilled
} from "./main-payload-helpers";

export { renderContractHumanLines, renderScanHumanSummary } from "./main-renderers";
export { parseLifecycleCapabilities } from "./main-args";
export type { SeerCommand } from "./contracts";
export type { SeerPayload } from "./main-types";

async function buildPayload(command: SeerCommand, flags: Map<string, string>): Promise<SeerPayload> {
  const generatedAt = new Date().toISOString();

  switch (command) {
    case "heartbeat": {
      const bridgeOnly = flags.get("bridge-only") === "true";
      const existingSignals = await readManualSeerSignals();
      const heartbeatResult = await runSeerHeartbeat(generatedAt, existingSignals);
      const importedSignals = heartbeatResult.importedSignals;

      if (importedSignals.length > 0) {
        await appendManualSeerSignals(importedSignals);
      }

      if (bridgeOnly) {
        return {
          command,
          generatedAt,
          importedSignals,
          importedCount: importedSignals.length,
          heartbeatSummary: {
            fetchedCount: heartbeatResult.fetchedCount,
            importedCount: heartbeatResult.importedCount,
            skippedCount: heartbeatResult.skippedCount,
            sourceRuns: heartbeatResult.sourceRuns
          }
        };
      }

      const { reviewQueue, reviewQueueSections, reviewQueueSnapshot, plannedRegistrySnapshot } =
        await buildQueueSectionsFromFeedback(generatedAt);
      const marketCreationDraftSnapshot = await buildAndPersistMarketCreationDraftSnapshot(generatedAt);

      return {
        command,
        generatedAt,
        importedSignals,
        importedCount: importedSignals.length,
        reviewQueue,
        reviewQueueSections,
        reviewQueueSnapshot,
        plannedRegistrySnapshot,
        plannedRegistryPath: getLatestPlannedRegistryPath(),
        plannedRegistryHistoryPath: getPlannedRegistryHistoryPath(),
        marketCreationDrafts: marketCreationDraftSnapshot.items,
        marketCreationDraftSnapshot,
        marketCreationDraftsPath: getLatestMarketCreationDraftsPath(),
        marketCreationDraftHistoryPath: getMarketCreationDraftHistoryPath(),
        reviewQueuePath: getLatestReviewQueuePath(),
        reviewQueueHistoryPath: getReviewQueueHistoryPath(),
        heartbeatSummary: {
          fetchedCount: heartbeatResult.fetchedCount,
          importedCount: heartbeatResult.importedCount,
          skippedCount: heartbeatResult.skippedCount,
          sourceRuns: heartbeatResult.sourceRuns
        }
      };
    }
    case "platform-shapes": {
      const snapshots = await Promise.all([
        fetchPolymarketShapeSnapshot(generatedAt),
        fetchKalshiShapeSnapshot(generatedAt)
      ]);
      const asSignals = flags.get("as-signals") === "true";
      const importedSignals = asSignals ? snapshots.flatMap((snapshot) => toPlatformReferenceSignals(snapshot)) : undefined;

      if (importedSignals && importedSignals.length > 0) {
        await appendManualSeerSignals(importedSignals);
      }

      await persistLatestPlatformShapeSnapshots(snapshots);

      return {
        command,
        generatedAt,
        platformShapeSnapshots: snapshots,
        importedSignals,
        importedCount: importedSignals?.length ?? 0,
        intakeLogPath: importedSignals ? getManualSignalLogPath() : undefined,
        platformShapesPath: getLatestPlatformShapesPath()
      };
    }
    case "operator-lead-add": {
      const operatorLead = buildOperatorLead(
        {
          createdBy: flags.get("created-by"),
          leadUrl: flags.get("lead-url"),
          leadSourceType: flags.get("lead-source-type"),
          leadRole: flags.get("lead-role"),
          rawPrompt: requireFlag(flags, "raw-prompt"),
          initialDomain: flags.get("initial-domain"),
          expectedLane: flags.get("expected-lane"),
          status: flags.get("status"),
          convertedEventId: flags.get("converted-event-id"),
          externalQuestion: flags.get("external-question"),
          externalOutcomes: parseList(flags.get("external-outcomes")),
          externalCloseTime: flags.get("external-close-time"),
          externalRules: flags.get("external-rules"),
          externalSourceRefs: parseList(flags.get("external-source-refs")),
          trainingUse: flags.get("training-use"),
          receiptRef: flags.get("receipt-ref"),
          notes: parseList(flags.get("notes"))
        },
        generatedAt
      );

      await appendOperatorLead(operatorLead);

      return {
        command,
        generatedAt,
        operatorLead,
        operatorLeadLogPath: getOperatorLeadLogPath(),
        operatorLeadsPath: getLatestOperatorLeadsPath()
      };
    }
    case "operator-leads":
      return {
        command,
        generatedAt,
        operatorLeads: await readOperatorLeads(),
        operatorLeadLogPath: getOperatorLeadLogPath(),
        operatorLeadsPath: getLatestOperatorLeadsPath()
      };
    case "import-signals": {
      const importFile = requireFlag(flags, "file");
      const importedSignals = await normalizeImportedSignals(importFile, generatedAt);
      await appendManualSeerSignals(importedSignals);

      return {
        command,
        generatedAt,
        importedSignals,
        importedCount: importedSignals.length,
        importFile,
        intakeLogPath: getManualSignalLogPath()
      };
    }
    case "intake-log":
      const importedSignals = await readManualSeerSignals();
      return {
        command,
        generatedAt,
        importedSignals,
        importedCount: importedSignals.length,
        intakeLogPath: getManualSignalLogPath()
      };
    case "source-add": {
      const label = requireFlag(flags, "label");
      const primaryClass = requireFlag(flags, "class") as SourceClass;

      if (!allowedSourceClasses.includes(primaryClass)) {
        throw new Error(`Invalid --class. Expected one of: ${allowedSourceClasses.join(", ")}`);
      }

      const stageUsefulness = parseEnumList(flags.get("stages"), allowedSourceStages, "stages");
      const categoryFit = parseList(flags.get("categories"));

      if (!stageUsefulness || stageUsefulness.length === 0) {
        throw new Error(`Missing required flag --stages`);
      }

      if (!categoryFit || categoryFit.length === 0) {
        throw new Error(`Missing required flag --categories`);
      }

      const homepage = flags.get("url");
      const sourceEntry: SourceRegistryEntry = {
        objectType: "source_registry_entry",
        sourceId: flags.get("source-id")?.trim() || `src_${slugify(homepage ?? label)}`,
        label,
        primaryClass,
        accessSurface: parseOptionalEnum(flags.get("surface"), ["html", "rss", "api", "calendar", "dataset", "account", "internal-stream", "manual-import"], "surface") ?? "html",
        status: "seeded",
        curationMode: parseOptionalEnum(flags.get("curation-mode"), allowedSourceCurationModes, "curation-mode") ?? "manual-seed",
        stageUsefulness,
        categoryFit,
        createdAt: generatedAt,
        updatedAt: generatedAt,
        ownerLabel: flags.get("owner"),
        homepage,
        secondaryClasses: parseEnumList(flags.get("secondary-classes"), allowedSourceClasses, "secondary-classes"),
        primaryJobs: parseEnumList(flags.get("jobs"), allowedSourceJobs, "jobs"),
        speedProfile: parseOptionalEnum(flags.get("speed"), allowedSourceSpeedProfiles, "speed"),
        noiseProfile: parseOptionalEnum(flags.get("noise"), allowedSourceNoiseProfiles, "noise"),
        authorityProfile: parseOptionalEnum(flags.get("authority"), allowedSourceAuthorityProfiles, "authority"),
        domainNotes: parseList(flags.get("notes")),
        lineageAffinity: parseList(flags.get("lineages")),
        seerPath: "manual-operator-intake",
        flags: parseList(flags.get("flags")),
        lifecycleCapabilities: parseLifecycleCapabilities(flags.get("lifecycle"))
      };

      await appendSourceRegistryEntry(sourceEntry);

      return {
        command,
        generatedAt,
        sourceEntry,
        sourceRegistryPath: getSourceRegistryLogPath()
      };
    }
    case "sources":
      return {
        command,
        generatedAt,
        sourceRegistry: await listSeerSources(),
        sourceRegistryPath: getSourceRegistryLogPath()
      };
    case "market-families":
      return {
        command,
        generatedAt,
        marketFamilies: seededMarketFamilyRegistry
      };
    case "family-readiness":
      return {
        command,
        generatedAt,
        familyReadinessSnapshot: buildFamilyReadinessSnapshot(
          seededMarketFamilyRegistry,
          await listSeerSources(),
          generatedAt
        )
      };
    case "scan":
      return { command, generatedAt, signals: await scanSeerSignals() };
    case "cluster":
      await ensureReworkAttemptsBackfilled();
      return {
        command,
        generatedAt,
        lineages: await buildSeerLineages(),
        trackedEvents: await buildTrackedEvents()
      };
    case "propose":
      await ensureReworkAttemptsBackfilled();
      return {
        command,
        generatedAt,
        trackedEvents: await buildTrackedEvents(),
        candidateMarkets: await buildCandidateMarkets()
      };
    case "review-queue": {
      const { reviewQueue, reviewQueueSections, reviewQueueSnapshot, plannedRegistrySnapshot } =
        await buildQueueSectionsFromFeedback(generatedAt);

      return {
        command,
        generatedAt,
        reviewQueue,
        reviewQueueSections,
        reviewQueueSnapshot,
        plannedRegistrySnapshot,
        plannedRegistryPath: getLatestPlannedRegistryPath(),
        plannedRegistryHistoryPath: getPlannedRegistryHistoryPath(),
        reviewQueuePath: getLatestReviewQueuePath(),
        reviewQueueHistoryPath: getReviewQueueHistoryPath()
      };
    }
    case "queue-latest":
      await ensureReworkAttemptsBackfilled();
      const latestSnapshot = await readLatestReviewQueueSnapshot();
      return {
        command,
        generatedAt,
        reviewQueueSnapshot: latestSnapshot,
        reviewQueueSections: latestSnapshot?.queueSections,
        reviewQueuePath: getLatestReviewQueuePath()
      };
    case "queue-history":
      return {
        command,
        generatedAt,
        reviewQueueHistory: await readReviewQueueHistory(),
        reviewQueueHistoryPath: getReviewQueueHistoryPath()
      };
    case "planned-registry":
      return {
        command,
        generatedAt,
        plannedRegistrySnapshot: await readLatestPlannedRegistrySnapshot(),
        plannedRegistryPath: getLatestPlannedRegistryPath()
      };
    case "planned-registry-history":
      return {
        command,
        generatedAt,
        plannedRegistryHistory: await readPlannedRegistryHistory(),
        plannedRegistryHistoryPath: getPlannedRegistryHistoryPath()
      };
    case "family-requests": {
      const marketCreationReadiness = await buildMarketCreationReadiness();
      const sourceFamilyRequests = buildSourceFamilyRequestsFromReadiness(
        marketCreationReadiness,
        generatedAt,
        {
          includeManual: flags.get("include-manual") === "true"
        }
      );
      const sourceFamilyRequestSnapshot = await persistSourceFamilyRequestSnapshot(
        sourceFamilyRequests,
        generatedAt
      );

      return {
        command,
        generatedAt,
        marketCreationReadiness,
        sourceFamilyRequests,
        sourceFamilyRequestSnapshot,
        sourceFamilyRequestsPath: getLatestSourceFamilyRequestsPath(),
        sourceFamilyRequestHistoryPath: getSourceFamilyRequestHistoryPath()
      };
    }
    case "family-requests-latest":
      return {
        command,
        generatedAt,
        sourceFamilyRequestSnapshot: await readLatestSourceFamilyRequestSnapshot(),
        sourceFamilyRequestsPath: getLatestSourceFamilyRequestsPath()
      };
    case "review-feedback": {
      const input = parseReviewFeedbackCommandInput(flags);

      const item: ReviewFeedbackItem = {
        objectType: "review_feedback_item",
        reviewFeedbackId: `rf_${slugify(`${Date.now()}_${input.reviewItemId}`)}`,
        reviewItemId: input.reviewItemId,
        candidateMarketId: input.candidateMarketId,
        action: input.action,
        reasonCategory: input.reasonCategory,
        reasonSummary: input.reasonSummary,
        reviewedAt: generatedAt,
        lineageId: input.lineageId,
        editedCategory: input.editedCategory,
        editedQuestion: input.editedQuestion,
        editedOutcomes: input.editedOutcomes,
        editedCloseShape: input.editedCloseShape,
        editedResolutionAnchor: input.editedResolutionAnchor,
        notes: input.notes
      };

      await appendReviewFeedback(item);
      const queueHistory = await readReviewQueueHistory();
      const sourceItem = shouldCreateReworkAttempt(item.action) ? findReviewItemForFeedback(queueHistory, item) : null;
      const reworkAttempt = sourceItem ? buildReworkAttempt(item, sourceItem) : undefined;

      if (reworkAttempt) {
        await appendReworkAttempt(reworkAttempt);
      }

      return {
        command,
        generatedAt,
        feedbackItem: item,
        feedbackLogPath: getReviewFeedbackLogPath(),
        reworkAttempt,
        reworkLogPath: getReworkAttemptLogPath()
      };
    }
    case "create-drafts": {
      const snapshot = await buildAndPersistMarketCreationDraftSnapshot(generatedAt);

      return {
        command,
        generatedAt,
        marketCreationDrafts: snapshot.items,
        marketCreationDraftSnapshot: snapshot,
        marketCreationDraftsPath: getLatestMarketCreationDraftsPath(),
        marketCreationDraftHistoryPath: getMarketCreationDraftHistoryPath()
      };
    }
    case "draft-readiness":
      return {
        command,
        generatedAt,
        marketCreationReadiness: await buildMarketCreationReadiness()
      };
    case "drafts-latest": {
      const latestSnapshot = await readLatestMarketCreationDraftSnapshot();

      return {
        command,
        generatedAt,
        marketCreationDrafts: latestSnapshot?.items,
        marketCreationDraftSnapshot: latestSnapshot,
        marketCreationDraftsPath: getLatestMarketCreationDraftsPath()
      };
    }
    case "drafts-history":
      return {
        command,
        generatedAt,
        marketCreationDraftHistory: await readMarketCreationDraftHistory(),
        marketCreationDraftHistoryPath: getMarketCreationDraftHistoryPath()
      };
    case "feedback-log":
      return {
        command,
        generatedAt,
        feedbackLog: await readReviewFeedbackLog(),
        feedbackLogPath: getReviewFeedbackLogPath()
      };
    case "rework-log":
      await ensureReworkAttemptsBackfilled();
      return {
        command,
        generatedAt,
        reworkAttempts: await readReworkAttemptLog(),
        reworkLogPath: getReworkAttemptLogPath()
      };
  }
}

async function run(argv: string[]): Promise<number> {
  const { command, flags, jsonMode, helpRequested, helpText } = parseArgs(argv);

  if (helpRequested || !command) {
    console.log(helpText ?? renderHelp());
    return helpRequested ? 0 : 1;
  }

  if (!SEER_COMMANDS.includes(command)) {
    console.error(`Unknown seer command: ${command}`);
    console.error(renderHelp());
    return 1;
  }

  const payload = await buildPayload(command, flags);

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(renderHumanSummary(payload));
  return 0;
}

run(process.argv)
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
