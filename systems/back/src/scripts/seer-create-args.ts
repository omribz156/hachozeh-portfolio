import { Command } from "commander";
import { z } from "zod";

import { findCommanderCommandIndex } from "@navi/cli/commander-argv";

export type SeerCreateCommand = "list" | "materialize" | "publish";

export type SeerCreateListOptions = Record<string, never>;

export type SeerCreateMaterializeOptions = {
  all: boolean;
  draft?: string;
  force: boolean;
  marketEnvironment?: "prod" | "test";
  // Event-level: render the multi-line probability chart in the event detail
  // view (events.display_flags.showGraph). Setting it on any one child of an
  // event applies to the whole event (display_flags merge). Default false.
  showGraph: boolean;
  // Event-level discovery display flags. Undefined means do not write/override
  // that event display flag during materialization.
  showParentInDiscovery?: boolean;
  showChildrenInDiscovery?: boolean;
};

export type SeerCreatePublishOptions = {
  all: boolean;
  allowManualResolution: boolean;
  draft?: string;
  marketEnvironment?: "prod" | "test";
  seedAmount?: string;
};

export type ParsedSeerCreateArgs =
  | {
      command: SeerCreateCommand | undefined;
      helpRequested: true;
      helpText?: string;
      jsonMode: boolean;
      options: undefined;
      unknownCommand?: string;
    }
  | {
      command: "list";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: SeerCreateListOptions;
      unknownCommand?: undefined;
    }
  | {
      command: "materialize";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: SeerCreateMaterializeOptions;
      unknownCommand?: undefined;
    }
  | {
      command: "publish";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: SeerCreatePublishOptions;
      unknownCommand?: undefined;
    }
  | {
      command: undefined;
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: undefined;
      unknownCommand?: string;
    };

const COMMAND_DISCOVERY_BOOLEAN_OPTIONS = new Set([
  "--json",
  "--help"
]);

const OptionalStringSchema = z.string().trim().min(1).optional();

function readOptionalString(value: unknown): string | undefined {
  const parsed = OptionalStringSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readBooleanOption(value: unknown, flagName: string, fallback: boolean): boolean {
  const parsed = z.union([
    z.boolean(),
    z.string().trim().min(1)
  ]).optional().safeParse(value);

  if (!parsed.success || parsed.data === undefined) {
    return fallback;
  }

  if (parsed.data === true || parsed.data === "true") {
    return true;
  }

  if (parsed.data === false || parsed.data === "false") {
    return false;
  }

  throw new Error(`Flag --${flagName} must be true or false.`);
}

function readOptionalBooleanOption(value: unknown, flagName: string): boolean | undefined {
  const parsed = z.union([
    z.boolean(),
    z.string().trim().min(1)
  ]).optional().safeParse(value);

  if (!parsed.success || parsed.data === undefined) {
    return undefined;
  }

  if (parsed.data === true || parsed.data === "true") {
    return true;
  }

  if (parsed.data === false || parsed.data === "false") {
    return false;
  }

  throw new Error(`Flag --${flagName} must be true or false.`);
}

function readMarketEnvironmentOption(value: unknown): "prod" | "test" | undefined {
  const environment = readOptionalString(value);

  if (!environment) {
    return undefined;
  }

  if (environment !== "prod" && environment !== "test") {
    throw new Error("Flag --market-environment must be prod or test.");
  }

  return environment;
}

function buildSeerCreateCommand(commandName: SeerCreateCommand): Command {
  const command = new Command(commandName)
    .allowExcessArguments(true)
    .allowUnknownOption(true)
    .exitOverride()
    .option("--json");

  if (commandName === "materialize") {
    command
      .option("--all [value]")
      .option("--draft [value]")
      .option("--force [value]")
      .option("--market-environment [value]")
      .option("--show-graph [value]")
      .option("--show-parent-in-discovery [value]")
      .option("--show-children-in-discovery [value]");
    return command;
  }

  if (commandName === "publish") {
    command
      .option("--all [value]")
      .option("--allow-manual-resolution [value]")
      .option("--draft [value]")
      .option("--market-environment [value]")
      .option("--seed-amount [value]");
  }

  return command;
}

function readMaterializeOptions(options: Record<string, unknown>): SeerCreateMaterializeOptions {
  return {
    all: readBooleanOption(options.all, "all", false),
    draft: readOptionalString(options.draft),
    force: readBooleanOption(options.force, "force", false),
    marketEnvironment: readMarketEnvironmentOption(options.marketEnvironment),
    showGraph: readBooleanOption(options.showGraph, "show-graph", false),
    showParentInDiscovery: readOptionalBooleanOption(
      options.showParentInDiscovery,
      "show-parent-in-discovery"
    ),
    showChildrenInDiscovery: readOptionalBooleanOption(
      options.showChildrenInDiscovery,
      "show-children-in-discovery"
    )
  };
}

function readPublishOptions(options: Record<string, unknown>): SeerCreatePublishOptions {
  return {
    all: readBooleanOption(options.all, "all", false),
    allowManualResolution: readBooleanOption(options.allowManualResolution, "allow-manual-resolution", false),
    draft: readOptionalString(options.draft),
    marketEnvironment: readMarketEnvironmentOption(options.marketEnvironment),
    seedAmount: readOptionalString(options.seedAmount)
  };
}

function isSeerCreateCommand(value: string): value is SeerCreateCommand {
  return value === "list" ||
    value === "materialize" ||
    value === "publish";
}

export function parseSeerCreateArgs(argv: string[]): ParsedSeerCreateArgs {
  const args = argv.slice(2);
  const commandIndex = findCommanderCommandIndex(args, COMMAND_DISCOVERY_BOOLEAN_OPTIONS);
  const rawCommand = commandIndex >= 0 ? args[commandIndex] : undefined;
  const jsonMode = args.includes("--json");
  const helpRequested = args.includes("--help");

  if (!rawCommand) {
    return {
      command: undefined,
      helpRequested,
      jsonMode,
      options: undefined
    };
  }

  if (!isSeerCreateCommand(rawCommand)) {
    return {
      command: undefined,
      helpRequested,
      jsonMode,
      options: undefined,
      unknownCommand: rawCommand
    };
  }

  const commandArgs = [
    ...args.slice(0, commandIndex),
    ...args.slice(commandIndex + 1)
  ].filter((arg) => arg !== "--json");
  const command = buildSeerCreateCommand(rawCommand);

  if (helpRequested) {
    return {
      command: rawCommand,
      helpRequested: true,
      helpText: command.helpInformation(),
      jsonMode,
      options: undefined
    };
  }

  command.parse(commandArgs, {
    from: "user"
  });
  const options = command.opts<Record<string, unknown>>();

  if (rawCommand === "list") {
    return {
      command: rawCommand,
      helpRequested: false,
      jsonMode,
      options: {}
    };
  }

  if (rawCommand === "materialize") {
    return {
      command: rawCommand,
      helpRequested: false,
      jsonMode,
      options: readMaterializeOptions(options)
    };
  }

  return {
    command: rawCommand,
    helpRequested: false,
    jsonMode,
    options: readPublishOptions(options)
  };
}
