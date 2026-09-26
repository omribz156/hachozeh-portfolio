import { z } from "zod";

import {
  resolveMarketIdFromInput,
  type OracleInspectionRequest
} from "./inspect-market-service";
import type { RequestActor, VoidMarketRequest } from "../../back/src/platform-surface/oracle";
import type { EvaluateCredibleReportingOptions } from "./credible-reporting-evaluator-service";
import type { CaptureTradingViewFxSnapshotOptions } from "./tradingview-fx-snapshot-service";
import type { RunOracleLifecycleHeartbeatOptions } from "./lifecycle-heartbeat-service";
import type { RunOracleLifecycleOptions } from "./lifecycle-run-service";
import type { RunOracleOfficialFinalIntakeOptions } from "./official-final-intake-service";
import type { OperatorObservedEventRequest } from "./operator-observed-event-service";
import type { OperatorResolveRequest } from "./operator-resolve-service";
import { parseOracleCommandWithCommander } from "./oracle-cli-commander";
import type { ReadOracleAlertsOptions } from "./oracle-alerts-service";
import type { ReadOracleResolveInboxOptions } from "./resolve-inbox-service";
import type { ReadOracleReviewQueueOptions } from "./review-queue-service";
import type { ReviewOracleCaseRequest } from "./review-action-requests";
import type { OracleSourceCapabilityCheckInput } from "./source-capability-service";

const ORACLE_COMMANDS = [
  "inspect-close-condition",
  "inspect-market",
  "inspect-resolution",
  "review-queue",
  "resolve-inbox",
  "official-final-intake",
  "case-history",
  "case-detail",
  "approve-close-condition-case",
  "approve-resolution-case",
  "reject-case",
  "request-more-evidence",
  "intake-candidate-evidence",
  "intake-credible-report",
  "approve-resolution-candidate",
  "operator-resolve",
  "operator-observed-event",
  "void-market",
  "capture-tradingview-fx-snapshot",
  "credible-reporting-evaluate",
  "family-route-audit",
  "capability-check",
  "alerts",
  "lifecycle-run",
  "lifecycle-heartbeat"
] as const;

export type OracleCommand = (typeof ORACLE_COMMANDS)[number];

export type ParsedArgs = {
  command?: OracleCommand;
  flags: Map<string, string>;
  helpRequested: boolean;
  helpText?: string;
  jsonMode: boolean;
  jsonlMode: boolean;
};

export type OracleReviewActionCommand =
  | "approve-resolution-case"
  | "approve-close-condition-case"
  | "reject-case"
  | "request-more-evidence";

export type OracleReviewCaseCommandInput = {
  oracleCaseId: string;
  actor: RequestActor;
  request: ReviewOracleCaseRequest;
};

export type OracleObservedEventCommandInput = {
  actor: RequestActor;
  request: OperatorObservedEventRequest;
};

export type OracleCapabilityCheckCommandInput = OracleSourceCapabilityCheckInput;

export type OracleTradingViewFxSnapshotCommandOptions = Pick<
  CaptureTradingViewFxSnapshotOptions,
  "marketId" | "symbol" | "observedAt" | "idempotencyKey"
>;

export type OracleCredibleReportingEvaluateCommandOptions = Pick<
  EvaluateCredibleReportingOptions,
  "marketId" | "dryRun" | "now"
>;

export type OracleVoidMarketCommandInput = {
  marketId: string;
  actor: RequestActor;
  request: VoidMarketRequest;
};

export type OracleOperatorResolveCommandExecutionInput = {
  actor: RequestActor;
  request: OperatorResolveRequest;
};

const OracleReviewQueueCaseStatusSchema = z.enum([
  "review_needed",
  "recommended",
  "no_action",
  "all"
]);
const OracleCaseTypeFlagSchema = z.enum([
  "close_condition_check",
  "resolution_check"
]);
const OracleAlertsMarketStatusSchema = z.enum([
  "open",
  "closed",
  "all"
]);
const OracleOperatorResolveModeSchema = z.enum([
  "test",
  "official",
  "manual"
]);
const NonEmptyFlagSchema = z.string().trim().min(1);
const PositiveIntegerFlagSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number(value))
  .refine((value) => value > 0);
const NonNegativeIntegerFlagSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number(value));
const PositiveNumberFlagSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0);

function parseOptionalFlagValue<T>(
  flags: Map<string, string>,
  name: string,
  schema: z.ZodType<T>,
  message: string
): T | undefined {
  const value = flags.get(name)?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new Error(message);
  }

  return parsed.data;
}

function parseRequiredFlagValue(flags: Map<string, string>, name: string): string {
  const parsed = NonEmptyFlagSchema.safeParse(flags.get(name));

  if (!parsed.success) {
    throw new Error(`Missing required flag --${name}`);
  }

  return parsed.data;
}

function parseOptionalStringFlag(flags: Map<string, string>, name: string): string | null {
  const value = flags.get(name);

  if (typeof value === "undefined") {
    return null;
  }

  const parsed = NonEmptyFlagSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function parseBooleanFlagValue(flags: Map<string, string>, name: string): boolean | undefined {
  return parseOptionalFlagValue(
    flags,
    name,
    z.enum(["true", "false"]).transform((value) => value === "true"),
    `Flag --${name} must be true or false.`
  );
}

function parseOptionalDateFlag(flags: Map<string, string>, name: string): Date | undefined {
  const value = flags.get(name)?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = z
    .string()
    .trim()
    .transform((candidate) => new Date(candidate))
    .refine((candidate) => !Number.isNaN(candidate.getTime()))
    .safeParse(value);

  if (!parsed.success) {
    throw new Error(`Flag --${name} must be an ISO timestamp.`);
  }

  return parsed.data;
}

function parseOracleCliActor(flags: Map<string, string>): RequestActor {
  return {
    actorId: parseOptionalStringFlag(flags, "actor-id") ?? "oracle_cli_operator",
    mode: "session",
    sessionId: parseOptionalStringFlag(flags, "session-id") ?? "oracle_cli_session",
    role: "admin"
  };
}

function readReviewActionIdempotencyPrefix(command: OracleReviewActionCommand): string {
  switch (command) {
    case "approve-resolution-case":
      return "oracle-approve";
    case "approve-close-condition-case":
      return "oracle-approve-close";
    case "reject-case":
      return "oracle-reject";
    case "request-more-evidence":
      return "oracle-request-more-evidence";
  }
}

function isOracleReviewActionCommand(command: OracleCommand | undefined): command is OracleReviewActionCommand {
  return (
    command === "approve-resolution-case" ||
    command === "approve-close-condition-case" ||
    command === "reject-case" ||
    command === "request-more-evidence"
  );
}

export function parseOracleReviewQueueCommandOptions(
  flags: Map<string, string>
): ReadOracleReviewQueueOptions {
  const market = flags.get("market")?.trim();

  return {
    caseStatus:
      parseOptionalFlagValue(
        flags,
        "case-status",
        OracleReviewQueueCaseStatusSchema,
        "case-status must be one of: review_needed, recommended, no_action, all."
      ) ?? "review_needed",
    caseType: parseOptionalFlagValue(
      flags,
      "case-type",
      OracleCaseTypeFlagSchema,
      "case-type must be one of: close_condition_check, resolution_check."
    ),
    marketId: market ? resolveMarketIdFromInput(market) : undefined,
    limit: parseOptionalFlagValue(
      flags,
      "limit",
      PositiveIntegerFlagSchema,
      "limit must be a positive integer."
    )
  };
}

export function parseOracleAlertsCommandOptions(flags: Map<string, string>): ReadOracleAlertsOptions {
  return {
    marketStatus:
      parseOptionalFlagValue(
        flags,
        "market-status",
        OracleAlertsMarketStatusSchema,
        "market-status must be one of: open, closed, all."
      ) ?? "all",
    reviewStaleHours: parseOptionalFlagValue(
      flags,
      "review-stale-hours",
      PositiveNumberFlagSchema,
      "review-stale-hours must be a positive number."
    ),
    recommendedStaleHours: parseOptionalFlagValue(
      flags,
      "recommended-stale-hours",
      PositiveNumberFlagSchema,
      "recommended-stale-hours must be a positive number."
    ),
    closedResolutionGraceHours: parseOptionalFlagValue(
      flags,
      "closed-resolution-grace-hours",
      PositiveNumberFlagSchema,
      "closed-resolution-grace-hours must be a positive number."
    ),
    precloseFetchGapHours: parseOptionalFlagValue(
      flags,
      "preclose-fetch-gap-hours",
      PositiveNumberFlagSchema,
      "preclose-fetch-gap-hours must be a positive number."
    ),
    persistSnapshot: true
  };
}

export function parseOracleReadLimitCommandOptions(
  flags: Map<string, string>
): ReadOracleResolveInboxOptions & Pick<RunOracleOfficialFinalIntakeOptions, "marketId" | "limit"> {
  const market = flags.get("market")?.trim();

  return {
    marketId: market ? resolveMarketIdFromInput(market) : undefined,
    limit: parseOptionalFlagValue(
      flags,
      "limit",
      PositiveIntegerFlagSchema,
      "limit must be a positive integer."
    )
  };
}

export function parseOracleCaseHistoryCommandInput(
  flags: Map<string, string>
): {
  marketId: string;
  options: Omit<ReadOracleReviewQueueOptions, "marketId">;
} {
  return {
    marketId: resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market")),
    options: {
      caseStatus:
        parseOptionalFlagValue(
          flags,
          "case-status",
          OracleReviewQueueCaseStatusSchema,
          "case-status must be one of: review_needed, recommended, no_action, all."
        ) ?? "all",
      caseType: parseOptionalFlagValue(
        flags,
        "case-type",
        OracleCaseTypeFlagSchema,
        "case-type must be one of: close_condition_check, resolution_check."
      ),
      limit: parseOptionalFlagValue(
        flags,
        "limit",
        PositiveIntegerFlagSchema,
        "limit must be a positive integer."
      )
    }
  };
}

export function parseOracleLifecycleRunCommandOptions(
  flags: Map<string, string>
): RunOracleLifecycleOptions {
  return {
    ...parseOracleReadLimitCommandOptions(flags),
    dryRun: parseBooleanFlagValue(flags, "dry-run") ?? false,
    now: parseOptionalDateFlag(flags, "now")
  };
}

export function parseOracleLifecycleHeartbeatCommandOptions(
  flags: Map<string, string>
): RunOracleLifecycleHeartbeatOptions {
  return {
    ...parseOracleLifecycleRunCommandOptions(flags),
    maxTicks: parseOptionalFlagValue(
      flags,
      "max-ticks",
      PositiveIntegerFlagSchema,
      "max-ticks must be a positive integer."
    ),
    intervalMs: parseOptionalFlagValue(
      flags,
      "interval-ms",
      NonNegativeIntegerFlagSchema,
      "interval-ms must be a non-negative integer."
    ),
    persistSnapshot: true,
    operatorRemindersEnabled: parseBooleanFlagValue(flags, "operator-reminders") ?? undefined,
    requireLock: parseBooleanFlagValue(flags, "require-lock") ?? true
  };
}

export function parseOracleReviewCaseCommandInput(
  command: OracleReviewActionCommand,
  flags: Map<string, string>
): OracleReviewCaseCommandInput {
  const oracleCaseId = parseRequiredFlagValue(flags, "case");
  const idempotencyPrefix = readReviewActionIdempotencyPrefix(command);

  return {
    oracleCaseId,
    actor: parseOracleCliActor(flags),
    request: {
      reviewNote: parseOptionalStringFlag(flags, "review-note"),
      idempotencyKey:
        parseOptionalStringFlag(flags, "idempotency-key") ??
        `${idempotencyPrefix}:${oracleCaseId}:${new Date().toISOString()}`
    }
  };
}

export function validateOracleReviewCaseCommandPayload(flags: Map<string, string>): void {
  parseRequiredFlagValue(flags, "case");
}

export function parseOracleObservedEventCommandInput(
  flags: Map<string, string>
): OracleObservedEventCommandInput {
  return {
    actor: parseOracleCliActor(flags),
    request: {
      marketId: resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market")),
      summary: parseRequiredFlagValue(flags, "summary"),
      observedAt: parseOptionalDateFlag(flags, "observed-at")?.toISOString() ?? null,
      observedOutcomeKey: parseOptionalStringFlag(flags, "observed-outcome-key"),
      sourceUrl: parseOptionalStringFlag(flags, "source-url"),
      sourceLabel: parseOptionalStringFlag(flags, "source-label"),
      note: parseOptionalStringFlag(flags, "note"),
      idempotencyKey: parseOptionalStringFlag(flags, "idempotency-key")
    }
  };
}

export function parseOracleCapabilityCheckCommandInput(
  flags: Map<string, string>
): OracleCapabilityCheckCommandInput {
  return {
    sourceId: parseRequiredFlagValue(flags, "source-id"),
    measurementKind: parseRequiredFlagValue(flags, "measurement"),
    resultShape: parseRequiredFlagValue(flags, "shape"),
    sourceUrl: parseOptionalStringFlag(flags, "source-url")
  };
}

export function parseOracleTradingViewFxSnapshotCommandOptions(
  flags: Map<string, string>
): OracleTradingViewFxSnapshotCommandOptions {
  return {
    marketId: resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market")),
    symbol: parseRequiredFlagValue(flags, "symbol"),
    observedAt: parseOptionalDateFlag(flags, "observed-at"),
    idempotencyKey: parseOptionalStringFlag(flags, "idempotency-key") ?? undefined
  };
}

export function parseOracleCredibleReportingEvaluateCommandOptions(
  flags: Map<string, string>
): OracleCredibleReportingEvaluateCommandOptions {
  return {
    marketId: resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market")),
    dryRun: parseBooleanFlagValue(flags, "dry-run") ?? false,
    now: parseOptionalDateFlag(flags, "now")
  };
}

export function parseOracleVoidMarketCommandInput(
  flags: Map<string, string>
): OracleVoidMarketCommandInput {
  const marketId = resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market"));

  return {
    marketId,
    actor: parseOracleCliActor(flags),
    request: {
      reason: parseRequiredFlagValue(flags, "reason"),
      note: parseOptionalStringFlag(flags, "note"),
      idempotencyKey:
        parseOptionalStringFlag(flags, "idempotency-key") ??
        `oracle-void:${marketId}:${new Date().toISOString()}`,
      requestedAt: parseOptionalDateFlag(flags, "requested-at")?.toISOString()
    }
  };
}

export function validateOracleVoidMarketCommandPayload(flags: Map<string, string>): void {
  parseRequiredFlagValue(flags, "market");
  parseRequiredFlagValue(flags, "reason");
  parseOptionalDateFlag(flags, "requested-at");
}

export function parseOracleOperatorResolveCommandInput(
  flags: Map<string, string>
): OperatorResolveRequest {
  const mode = parseOptionalFlagValue(
    flags,
    "mode",
    OracleOperatorResolveModeSchema,
    "--mode must be test, official, or manual."
  );

  if (!mode) {
    throw new Error("Missing required flag --mode");
  }

  return {
    marketId: resolveMarketIdFromInput(parseRequiredFlagValue(flags, "market")),
    mode,
    winningOutcomeId: parseOptionalStringFlag(flags, "winning-outcome-id"),
    winningOutcomeKey: parseOptionalStringFlag(flags, "winning-outcome-key"),
    reasonSummary: parseRequiredFlagValue(flags, "reason-summary"),
    evidenceUrl: parseRequiredFlagValue(flags, "evidence-url"),
    evidenceLabel: parseRequiredFlagValue(flags, "evidence-label"),
    claimSummary: parseOptionalStringFlag(flags, "claim-summary"),
    evidenceSummary: parseOptionalStringFlag(flags, "evidence-summary"),
    resolvedAtObserved: parseOptionalStringFlag(flags, "resolved-at-observed"),
    approve: parseBooleanFlagValue(flags, "approve") ?? false,
    reviewNote: parseOptionalStringFlag(flags, "review-note"),
    idempotencyKey: parseOptionalStringFlag(flags, "idempotency-key"),
    persistResult: parseBooleanFlagValue(flags, "persist")
  };
}

export function parseOracleOperatorResolveCommandExecutionInput(
  flags: Map<string, string>
): OracleOperatorResolveCommandExecutionInput {
  return {
    actor: parseOracleCliActor(flags),
    request: parseOracleOperatorResolveCommandInput(flags)
  };
}

function validateOracleCommandPayload(parsed: ParsedArgs): void {
  if (parsed.helpRequested) {
    return;
  }

  if (parsed.command === "review-queue") {
    parseOracleReviewQueueCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "alerts") {
    parseOracleAlertsCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "operator-resolve") {
    parseOracleOperatorResolveCommandInput(parsed.flags);
    return;
  }

  if (parsed.command === "operator-observed-event") {
    parseOracleObservedEventCommandInput(parsed.flags);
    return;
  }

  if (parsed.command === "capability-check") {
    parseOracleCapabilityCheckCommandInput(parsed.flags);
    return;
  }

  if (parsed.command === "capture-tradingview-fx-snapshot") {
    parseOracleTradingViewFxSnapshotCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "credible-reporting-evaluate") {
    parseOracleCredibleReportingEvaluateCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "void-market") {
    validateOracleVoidMarketCommandPayload(parsed.flags);
    return;
  }

  if (parsed.command === "resolve-inbox" || parsed.command === "official-final-intake") {
    parseOracleReadLimitCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "case-history") {
    parseOracleCaseHistoryCommandInput(parsed.flags);
    return;
  }

  if (parsed.command === "lifecycle-run") {
    parseOracleLifecycleRunCommandOptions(parsed.flags);
    return;
  }

  if (parsed.command === "lifecycle-heartbeat") {
    parseOracleLifecycleHeartbeatCommandOptions(parsed.flags);
    return;
  }

  if (isOracleReviewActionCommand(parsed.command)) {
    validateOracleReviewCaseCommandPayload(parsed.flags);
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const commanderParsed = parseOracleCommandWithCommander(argv);

  if (commanderParsed) {
    validateOracleCommandPayload(commanderParsed);
    return commanderParsed;
  }

  throw new Error("Oracle Commander parser did not return a parse result.");
}

export function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}

export function readBooleanFlag(flags: Map<string, string>, name: string): boolean | undefined {
  const value = flags.get(name);

  if (!value) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Flag --${name} must be true or false.`);
}

export function readDateFlag(flags: Map<string, string>, name: string): Date | undefined {
  const value = flags.get(name)?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Flag --${name} must be an ISO timestamp.`);
  }

  return parsed;
}

export function parseList(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeHttpsCliUrl(value: string, flagName: string): string {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to the consistent CLI-facing error below.
  }

  throw new Error(`--${flagName} must be an HTTPS URL.`);
}

export function buildSources(flags: Map<string, string>): OracleInspectionRequest["sources"] {
  const ids = parseList(flags.get("source-id"));
  const urls = parseList(flags.get("source-url"));
  const labels = parseList(flags.get("source-label"));
  const types = parseList(flags.get("source-type"));
  const claims = parseList(flags.get("claim-summary"));
  const independentGroupIds = parseList(flags.get("independent-group-id"));
  const capturedAts = parseList(flags.get("source-captured-at"));

  if (urls.length === 0) {
    throw new Error("At least one --source-url is required.");
  }

  return urls.map((sourceUrl, index) => ({
    sourceId: ids[index] ?? ids[0],
    sourceUrl: normalizeHttpsCliUrl(sourceUrl, "source-url"),
    sourceLabel: labels[index] ?? labels[0] ?? `Source ${index + 1}`,
    sourceType: types[index] ?? types[0] ?? "official",
    independentGroupId: independentGroupIds[index] ?? independentGroupIds[0],
    claimSummary: claims[index] ?? claims[0] ?? `Claim ${index + 1}`,
    capturedAt: capturedAts[index] ?? capturedAts[0]
  }));
}
