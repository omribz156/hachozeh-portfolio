import { readFile } from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";

import { findCommanderCommandIndex } from "@navi/cli/commander-argv";
import type {
  ManualSeerSignal,
  MarketForm,
  MarketMeasurementKind,
  MarketResultShape,
  OracleCapabilityStatus,
  ProposedOutcome,
  RecurringEventTemplateId,
  RecommendedAction,
  ReviewReasonCategory,
  SeerCommand,
  SourceAuthorityProfile,
  SourceClass,
  SourceCurationMode,
  SourceJob,
  SourceLifecycleCapabilityHint,
  SourceNoiseProfile,
  SourceSpeedProfile,
  SourceStage
} from "./contracts";
import { normalizeIntakeLane } from "./intake-lanes";
import { findSeerSource } from "./source-registry";
import { slugify } from "./text";

export type ParsedArgs = {
  command?: SeerCommand;
  flags: Map<string, string>;
  jsonMode: boolean;
  helpRequested: boolean;
  helpText?: string;
};

export type ReviewFeedbackCommandInput = {
  reviewItemId: string;
  candidateMarketId: string;
  action: RecommendedAction;
  reasonCategory: ReviewReasonCategory;
  reasonSummary: string;
  lineageId?: string;
  editedCategory?: string;
  editedQuestion?: string;
  editedOutcomes?: ProposedOutcome[];
  editedCloseShape?: string;
  editedResolutionAnchor?: string;
  notes?: string[];
};

export const SEER_COMMANDS = [
  "heartbeat",
  "platform-shapes",
  "operator-lead-add",
  "operator-leads",
  "import-signals",
  "intake-log",
  "source-add",
  "sources",
  "market-families",
  "family-readiness",
  "scan",
  "cluster",
  "propose",
  "review-queue",
  "queue-latest",
  "queue-history",
  "planned-registry",
  "planned-registry-history",
  "family-requests",
  "family-requests-latest",
  "review-feedback",
  "feedback-log",
  "rework-log",
  "create-drafts",
  "draft-readiness",
  "drafts-latest",
  "drafts-history"
] as const satisfies readonly SeerCommand[];

const SEER_OPTIONS = [
  "--action [value]",
  "--as-signals [value]",
  "--authority [value]",
  "--bridge-only [value]",
  "--candidate-market [value]",
  "--categories [value]",
  "--class [value]",
  "--converted-event-id [value]",
  "--created-by [value]",
  "--curation-mode [value]",
  "--edited-category [value]",
  "--edited-close-shape [value]",
  "--edited-outcomes [value]",
  "--edited-question [value]",
  "--edited-resolution-anchor [value]",
  "--expected-lane [value]",
  "--external-close-time [value]",
  "--external-outcomes [value]",
  "--external-question [value]",
  "--external-rules [value]",
  "--external-source-refs [value]",
  "--file [value]",
  "--flags [value]",
  "--include-manual [value]",
  "--initial-domain [value]",
  "--jobs [value]",
  "--json",
  "--label [value]",
  "--lead-role [value]",
  "--lead-source-type [value]",
  "--lead-url [value]",
  "--lifecycle [value]",
  "--lineage-id [value]",
  "--lineages [value]",
  "--noise [value]",
  "--notes [value]",
  "--owner [value]",
  "--raw-prompt [value]",
  "--reason-category [value]",
  "--reason-summary [value]",
  "--receipt-ref [value]",
  "--review-item [value]",
  "--secondary-classes [value]",
  "--source-id [value]",
  "--speed [value]",
  "--stages [value]",
  "--status [value]",
  "--surface [value]",
  "--training-use [value]",
  "--url [value]"
] as const;

export const allowedActions: RecommendedAction[] = [
  "approve",
  "approve-with-edits",
  "hold",
  "merge",
  "reject",
  "escalate",
  "request-rework"
];

export const allowedReasonCategories: ReviewReasonCategory[] = [
  "good-as-is",
  "wording-needs-improvement",
  "outcome-structure-needs-improvement",
  "duplicate-or-overlap",
  "too-early",
  "insufficient-grounding",
  "non-resolvable",
  "policy-risk",
  "sensitivity-risk",
  "proposal-quality-weak",
  "fit",
  "wording",
  "duplicate",
  "timing",
  "outcomes",
  "authority",
  "sensitivity",
  "other"
];

export const allowedSourceClasses: SourceClass[] = ["attention", "context", "authority", "internal"];
export const allowedSourceStages: SourceStage[] = ["sensing", "grounding", "review"];
export const allowedSourceJobs: SourceJob[] = [
  "notice-motion",
  "spot-weak-signals",
  "explain-context",
  "shape-wording",
  "ground-confidence",
  "anchor-resolution",
  "measure-user-demand",
  "reactivate-lineage"
];
export const allowedSourceCurationModes: SourceCurationMode[] = [
  "manual-seed",
  "bottom-up-observed",
  "lineage-expanded",
  "internal-native"
];
export const allowedSourceSpeedProfiles: SourceSpeedProfile[] = ["fast", "medium", "slow", "event-bound"];
export const allowedSourceNoiseProfiles: SourceNoiseProfile[] = ["low", "medium", "high"];
export const allowedSourceAuthorityProfiles: SourceAuthorityProfile[] = ["low", "medium", "high", "official"];
export const allowedMarketForms: MarketForm[] = ["binary", "multi-outcome", "date-bucket", "threshold", "range"];
export const allowedRecurringTemplateIds: RecurringEventTemplateId[] = [
  "boi-rate-decision-v1",
  "fed-rate-decision-v1",
  "ecb-rate-decision-v1",
  "knesset-dissolution-before-date-v1",
  "sports-match-winner-v1",
  "sports-regulation-3way-v1"
];
export const allowedSensitivityLevels = ["normal", "elevated", "high"] as const;
export const allowedMarketMeasurementKinds: MarketMeasurementKind[] = [
  "final_winner",
  "rate_direction",
  "deadline_yes_no",
  "threshold_crossing",
  "date_bucket",
  "official_value",
  "reported_claim"
];
export const allowedMarketResultShapes: MarketResultShape[] = [
  "home_away_winner",
  "three_way_result",
  "cut_hold_hike",
  "yes_no",
  "date_bucket",
  "multi_outcome"
];
export const allowedOracleCapabilityStatuses: OracleCapabilityStatus[] = [
  "supported_full_cycle",
  "supported_final_only",
  "credible_reporting",
  "manual_resolution_required",
  "blocked"
];

export const reasonCategoryAliases: Partial<Record<ReviewReasonCategory, ReviewReasonCategory>> = {
  fit: "good-as-is",
  wording: "wording-needs-improvement",
  duplicate: "duplicate-or-overlap",
  timing: "too-early",
  outcomes: "outcome-structure-needs-improvement",
  authority: "insufficient-grounding",
  sensitivity: "sensitivity-risk",
  other: "proposal-quality-weak"
};
const COMMAND_DISCOVERY_BOOLEAN_OPTIONS = new Set([
  "--json",
  "--help"
]);

function isSeerCommand(value: string): value is SeerCommand {
  return SEER_COMMANDS.some((command) => command === value);
}

function readFlagName(optionSpec: string): string {
  return optionSpec.slice(2).split(/[ <[]/, 1)[0]!;
}

function toCommanderOptionKey(flagName: string): string {
  return flagName.replace(/-([a-z0-9])/g, (_match, character: string) =>
    character.toUpperCase()
  );
}

function buildSeerCommand(commandName: SeerCommand): Command {
  const command = new Command(commandName)
    .allowExcessArguments(true)
    .allowUnknownOption(true)
    .exitOverride();

  for (const option of SEER_OPTIONS) {
    command.option(option);
  }

  return command;
}

function collectCommanderFlags(command: Command): Map<string, string> {
  const flags = new Map<string, string>();
  const options = command.opts<Record<string, unknown>>();

  for (const optionSpec of SEER_OPTIONS) {
    const flagName = readFlagName(optionSpec);

    if (flagName === "json") {
      continue;
    }

    const value = options[toCommanderOptionKey(flagName)];

    if (value === true) {
      flags.set(flagName, "true");
      continue;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      flags.set(flagName, value.trim());
    }
  }

  return flags;
}

function collectUnknownFlags(tokens: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (!token.startsWith("--")) {
      continue;
    }

    const next = tokens[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(token.slice(2), "true");
      continue;
    }

    flags.set(token.slice(2), next.trim());
    index += 1;
  }

  return flags;
}

function buildRootHelp(): string {
  const rootCommand = new Command("seer");

  for (const seerCommand of SEER_COMMANDS) {
    rootCommand.addCommand(buildSeerCommand(seerCommand));
  }

  return rootCommand.helpInformation();
}

function validateSeerCommandPayload(command: SeerCommand, flags: Map<string, string>): void {
  if (command === "review-feedback") {
    parseReviewFeedbackCommandInput(flags);
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const commandIndex = findCommanderCommandIndex(args, COMMAND_DISCOVERY_BOOLEAN_OPTIONS);
  const command = commandIndex >= 0 ? args[commandIndex] : undefined;

  if (!command) {
    return {
      flags: new Map(),
      jsonMode: args.includes("--json"),
      helpRequested: args.includes("--help"),
      helpText: args.includes("--help") ? buildRootHelp() : undefined
    };
  }

  if (!isSeerCommand(command)) {
    return {
      command: command as SeerCommand,
      flags: new Map(),
      jsonMode: args.includes("--json"),
      helpRequested: args.includes("--help"),
      helpText: args.includes("--help") ? buildRootHelp() : undefined
    };
  }

  const commandArgs = [
    ...args.slice(0, commandIndex),
    ...args.slice(commandIndex + 1)
  ].filter((arg) => arg !== "--json");
  const commanderCommand = buildSeerCommand(command);

  if (args.includes("--help")) {
    return {
      command,
      flags: new Map(),
      jsonMode: args.includes("--json"),
      helpRequested: true,
      helpText: commanderCommand.helpInformation()
    };
  }

  const parsed = commanderCommand.parseOptions(commandArgs);
  commanderCommand.parse(commandArgs, {
    from: "user"
  });

  const flags = new Map([
    ...collectUnknownFlags(parsed.unknown),
    ...collectCommanderFlags(commanderCommand)
  ]);

  validateSeerCommandPayload(command, flags);

  return {
    command,
    flags,
    jsonMode: args.includes("--json"),
    helpRequested: args.includes("--help")
  };
}

export function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}

const nonEmptyFlagSchema = z.string().trim().min(1);

function parseRequiredFlagValue(flags: Map<string, string>, name: string): string {
  const parsed = nonEmptyFlagSchema.safeParse(flags.get(name));

  if (!parsed.success) {
    throw new Error(`Missing required flag --${name}`);
  }

  return parsed.data;
}

function parseOptionalFlagValue(flags: Map<string, string>, name: string): string | undefined {
  const value = flags.get(name);

  if (typeof value === "undefined") {
    return undefined;
  }

  const parsed = nonEmptyFlagSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function parseEnumFlag<T extends string>(
  flags: Map<string, string>,
  name: string,
  allowed: readonly T[]
): T {
  const value = parseRequiredFlagValue(flags, name);
  const parsed = z.custom<T>((candidate) => allowed.includes(candidate as T)).safeParse(value);

  if (!parsed.success) {
    throw new Error(`Invalid --${name}. Expected one of: ${allowed.join(", ")}`);
  }

  return parsed.data;
}

export function parseReviewFeedbackCommandInput(
  flags: Map<string, string>
): ReviewFeedbackCommandInput {
  const action = parseEnumFlag(flags, "action", allowedActions);
  const rawReasonCategory = parseEnumFlag(
    flags,
    "reason-category",
    allowedReasonCategories
  );

  return {
    reviewItemId: parseRequiredFlagValue(flags, "review-item"),
    candidateMarketId: parseRequiredFlagValue(flags, "candidate-market"),
    action,
    reasonCategory: reasonCategoryAliases[rawReasonCategory] ?? rawReasonCategory,
    reasonSummary: parseRequiredFlagValue(flags, "reason-summary"),
    lineageId: parseOptionalFlagValue(flags, "lineage-id"),
    editedCategory: parseOptionalFlagValue(flags, "edited-category"),
    editedQuestion: parseOptionalFlagValue(flags, "edited-question"),
    editedOutcomes: parseEditedOutcomes(parseOptionalFlagValue(flags, "edited-outcomes")),
    editedCloseShape: parseOptionalFlagValue(flags, "edited-close-shape"),
    editedResolutionAnchor: parseOptionalFlagValue(flags, "edited-resolution-anchor"),
    notes: parseList(parseOptionalFlagValue(flags, "notes"))
  };
}

export function parseEditedOutcomes(rawValue?: string): ProposedOutcome[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  return rawValue
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((label) => ({
      label,
      kind: "named-outcome"
    }));
}

export function parseList(rawValue?: string): string[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  const values = rawValue
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return values.length > 0 ? values : undefined;
}

function parseJsonishFile<T>(contents: string): T[] {
  const trimmed = contents.trim();

  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T[];
  }

  if (trimmed.startsWith("{")) {
    return [JSON.parse(trimmed) as T];
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

type ImportedSignalDraft = {
  sourceId: string;
  intakeLane?: "planned" | "live" | "planned-event" | "shock-discovery";
  title: string;
  summary: string;
  category: string;
  whyNow: string;
  observedAt?: string;
  sourceRef?: string;
  sourceLabel?: string;
  clusterHint?: string;
  lineageHint?: string;
  recurringTemplateId?: RecurringEventTemplateId;
  keyEntities?: string[];
  notes?: string[];
  tags?: string[];
  question?: string;
  marketAngle?: string;
  marketForm?: MarketForm;
  proposedOutcomes?: Array<string | ProposedOutcome>;
  marketWorthiness?: string;
  resolutionFeasibility?: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sensitivityLevel?: "normal" | "elevated" | "high";
  ambiguityNotes?: string[];
  riskFlags?: string[];
};

function normalizeImportedOutcomes(rawValue?: Array<string | ProposedOutcome>): ProposedOutcome[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  const outcomes = rawValue
    .map((item) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label.length > 0
          ? {
              label,
              kind: "named-outcome" as const
            }
          : undefined;
      }

      const label = item.label?.trim();

      if (!label) {
        return undefined;
      }

      return {
        ...item,
        label
      };
    })
    .filter((item): item is ProposedOutcome => Boolean(item));

  return outcomes.length > 0 ? outcomes : undefined;
}

export async function normalizeImportedSignals(filePath: string, generatedAt: string): Promise<ManualSeerSignal[]> {
  const contents = await readFile(filePath, "utf8");
  const drafts = parseJsonishFile<ImportedSignalDraft>(contents);
  const normalized: ManualSeerSignal[] = [];

  for (const draft of drafts) {
    if (!draft.sourceId?.trim()) {
      throw new Error("Imported signal is missing sourceId");
    }

    if (!draft.title?.trim()) {
      throw new Error("Imported signal is missing title");
    }

    if (!draft.summary?.trim()) {
      throw new Error("Imported signal is missing summary");
    }

    if (!draft.category?.trim()) {
      throw new Error("Imported signal is missing category");
    }

    if (!draft.whyNow?.trim()) {
      throw new Error("Imported signal is missing whyNow");
    }

    const source = await findSeerSource(draft.sourceId.trim());

    if (!source) {
      throw new Error(`Imported signal references unknown sourceId: ${draft.sourceId}`);
    }

    const observedAt = draft.observedAt?.trim() || generatedAt;
    const marketForm = parseOptionalEnum(draft.marketForm, allowedMarketForms, "marketForm");
    const recurringTemplateId = parseOptionalEnum(
      draft.recurringTemplateId,
      allowedRecurringTemplateIds,
      "recurringTemplateId"
    );
    const proposedOutcomes = normalizeImportedOutcomes(draft.proposedOutcomes);

    normalized.push({
      objectType: "manual_seer_signal",
      signalId: `msig_${slugify(`${observedAt}_${draft.sourceId}_${draft.title}`)}`,
      sourceId: draft.sourceId.trim(),
      intakeLane: draft.intakeLane ? normalizeIntakeLane(draft.intakeLane) : undefined,
      recurringTemplateId,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      category: draft.category.trim(),
      whyNow: draft.whyNow.trim(),
      observedAt,
      importedAt: generatedAt,
      sourceRef: draft.sourceRef?.trim() || source.homepage || source.sourceId,
      sourceLabel: draft.sourceLabel?.trim() || source.label,
      clusterHint: draft.clusterHint?.trim(),
      lineageHint: draft.lineageHint?.trim(),
      keyEntities: draft.keyEntities?.map((value) => value.trim()).filter((value) => value.length > 0),
      notes: draft.notes?.map((value) => value.trim()).filter((value) => value.length > 0),
      tags: draft.tags?.map((value) => value.trim()).filter((value) => value.length > 0),
      question: draft.question?.trim(),
      marketAngle: draft.marketAngle?.trim(),
      marketForm,
      proposedOutcomes,
      marketWorthiness: draft.marketWorthiness?.trim(),
      resolutionFeasibility: draft.resolutionFeasibility?.trim(),
      suggestedCloseShape: draft.suggestedCloseShape?.trim(),
      suggestedResolutionAnchor: draft.suggestedResolutionAnchor?.trim(),
      sensitivityLevel: parseOptionalEnum(draft.sensitivityLevel, allowedSensitivityLevels, "sensitivityLevel"),
      ambiguityNotes: draft.ambiguityNotes?.map((value) => value.trim()).filter((value) => value.length > 0),
      riskFlags: draft.riskFlags?.map((value) => value.trim()).filter((value) => value.length > 0)
    });
  }

  return normalized;
}

export function parseEnumList<T extends string>(
  rawValue: string | undefined,
  allowed: readonly T[],
  flagName: string
): T[] | undefined {
  const values = parseList(rawValue);

  if (!values) {
    return undefined;
  }

  for (const value of values) {
    if (!allowed.includes(value as T)) {
      throw new Error(`Invalid --${flagName}. Expected values from: ${allowed.join(", ")}`);
    }
  }

  return values as T[];
}

export function parseOptionalEnum<T extends string>(
  rawValue: string | undefined,
  allowed: readonly T[],
  flagName: string
): T | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (!allowed.includes(rawValue as T)) {
    throw new Error(`Invalid --${flagName}. Expected one of: ${allowed.join(", ")}`);
  }

  return rawValue as T;
}

export function parseLifecycleCapabilities(rawValue: string | undefined): SourceLifecycleCapabilityHint[] | undefined {
  const entries = parseList(rawValue);

  if (!entries) {
    return undefined;
  }

  return entries.map((entry) => {
    const [measurementKind, resultShape, oracleCapability, ...noteParts] = entry
      .split("/")
      .map((part) => part.trim());

    if (
      !measurementKind ||
      !allowedMarketMeasurementKinds.includes(measurementKind as MarketMeasurementKind) ||
      !resultShape ||
      !allowedMarketResultShapes.includes(resultShape as MarketResultShape) ||
      !oracleCapability ||
      !allowedOracleCapabilityStatuses.includes(oracleCapability as OracleCapabilityStatus)
    ) {
      throw new Error(
        `Invalid --lifecycle entry "${entry}". Expected measurementKind/resultShape/oracleCapability[/note].`
      );
    }

    return {
      measurementKind: measurementKind as MarketMeasurementKind,
      resultShape: resultShape as MarketResultShape,
      oracleCapability: oracleCapability as OracleCapabilityStatus,
      notes: noteParts.length > 0 ? [noteParts.join("/")] : undefined
    };
  });
}
