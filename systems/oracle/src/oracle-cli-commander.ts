import { Command } from "commander";

import { findCommanderCommandIndex } from "@navi/cli/commander-argv";
import type { ParsedArgs } from "./oracle-cli-args";

type CommanderParseResult = {
  flags: Map<string, string>;
  helpText?: string;
};

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

type OracleCommanderCommand = (typeof ORACLE_COMMANDS)[number];

const COMMON_OPTIONS = [
  "--actor-id [value]",
  "--ambiguity-level [value]",
  "--approve [value]",
  "--authority-profile [value]",
  "--candidate-evidence-id [value]",
  "--captured-at [value]",
  "--case [value]",
  "--case-status [value]",
  "--case-type [value]",
  "--claim-summary [value]",
  "--close-condition-satisfied [value]",
  "--closed-resolution-grace-hours [hours]",
  "--configured-role [value]",
  "--dry-run [value]",
  "--evidence-label [value]",
  "--evidence-summary [value]",
  "--evidence-url [value]",
  "--fallback-evidence-standard [value]",
  "--fallback-resolution [value]",
  "--fetch-readiness [value]",
  "--idempotency-key [value]",
  "--independent-group-id [value]",
  "--interval-ms [value]",
  "--json",
  "--jsonl",
  "--limit [value]",
  "--market [value]",
  "--market-status [status]",
  "--max-ticks [value]",
  "--measurement [value]",
  "--mode [value]",
  "--note [value]",
  "--now [value]",
  "--observed-at [value]",
  "--observed-outcome-key [value]",
  "--operator-reminders [value]",
  "--persist [value]",
  "--preclose-fetch-gap-hours [hours]",
  "--primary-failure-reason [value]",
  "--primary-source-url [value]",
  "--reason [value]",
  "--reason-summary [value]",
  "--recommended-next-action [value]",
  "--recommended-stale-hours [hours]",
  "--require-lock [value]",
  "--requested-at [value]",
  "--requires-human-review [value]",
  "--resolved-at-observed [value]",
  "--review-note [value]",
  "--review-notes [value]",
  "--review-reason [value]",
  "--review-severity [value]",
  "--review-stale-hours [hours]",
  "--review-summary [value]",
  "--review-type [value]",
  "--session-id [value]",
  "--shape [value]",
  "--signal-id [value]",
  "--source-captured-at [value]",
  "--source-id [value]",
  "--source-label [value]",
  "--source-type [value]",
  "--source-url [value]",
  "--summary [value]",
  "--summary-override [value]",
  "--symbol [value]",
  "--title [value]",
  "--winning-outcome-id [value]",
  "--winning-outcome-key [value]"
] as const;

const COMMAND_SPECIFIC_OPTIONS: Partial<Record<OracleCommanderCommand, readonly string[]>> = {};
const COMMAND_DISCOVERY_BOOLEAN_OPTIONS = new Set([
  "--json",
  "--jsonl",
  "--help"
]);

function isOracleCommand(value: string): value is OracleCommanderCommand {
  return ORACLE_COMMANDS.some((command) => command === value);
}

function buildCommand(commandName: OracleCommanderCommand): Command {
  const command = new Command(commandName)
    .allowExcessArguments(true)
    .allowUnknownOption(true)
    .exitOverride();

  const options = new Set([
    ...COMMON_OPTIONS,
    ...(COMMAND_SPECIFIC_OPTIONS[commandName] ?? [])
  ]);

  for (const option of options) {
    command.option(option);
  }

  return command;
}

function readFlagName(optionSpec: string): string {
  return optionSpec.slice(2).split(/[ <[]/, 1)[0]!;
}

function toCommanderOptionKey(flagName: string): string {
  return flagName.replace(/-([a-z0-9])/g, (_match, character: string) =>
    character.toUpperCase()
  );
}

function collectKnownFlagNames(commandName: OracleCommanderCommand): Set<string> {
  return new Set(
    [
      ...COMMON_OPTIONS,
      ...(COMMAND_SPECIFIC_OPTIONS[commandName] ?? [])
    ].map(readFlagName)
  );
}

function collectFlags(command: Command, commandName: OracleCommanderCommand): Map<string, string> {
  const flags = new Map<string, string>();
  const options = command.opts<Record<string, unknown>>();

  for (const flagName of collectKnownFlagNames(commandName)) {
    if (flagName === "json" || flagName === "jsonl") {
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

function parseCommandArgs(
  commandName: OracleCommanderCommand,
  args: string[]
): CommanderParseResult {
  const command = buildCommand(commandName);

  if (args.includes("--help")) {
    return {
      flags: new Map(),
      helpText: command.helpInformation()
    };
  }

  command.parse(args, {
    from: "user"
  });

  return {
    flags: collectFlags(command, commandName)
  };
}

export function parseOracleCommandWithCommander(argv: string[]): ParsedArgs | null {
  const args = argv.slice(2);
  const commandIndex = findCommanderCommandIndex(args, COMMAND_DISCOVERY_BOOLEAN_OPTIONS);
  const command = commandIndex >= 0 ? args[commandIndex] : undefined;

  if (!command) {
    const rootCommand = new Command("oracle");

    for (const oracleCommand of ORACLE_COMMANDS) {
      rootCommand.addCommand(buildCommand(oracleCommand));
    }

    return {
      flags: new Map(),
      helpRequested: args.includes("--help"),
      helpText: args.includes("--help") ? rootCommand.helpInformation() : undefined,
      jsonMode: args.includes("--json"),
      jsonlMode: args.includes("--jsonl")
    };
  }

  if (!isOracleCommand(command)) {
    throw new Error(`Unknown Oracle command: ${command}`);
  }

  const commandArgs = [
    ...args.slice(0, commandIndex),
    ...args.slice(commandIndex + 1)
  ].filter((arg) => arg !== "--json" && arg !== "--jsonl");
  const parsed = parseCommandArgs(command, commandArgs);

  return {
    command,
    flags: parsed.flags,
    helpRequested: Boolean(parsed.helpText),
    helpText: parsed.helpText,
    jsonMode: args.includes("--json"),
    jsonlMode: args.includes("--jsonl")
  };
}
