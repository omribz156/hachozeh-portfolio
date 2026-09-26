import { Command } from "commander";
import { z } from "zod";

import { findCommanderCommandIndex } from "@navi/cli/commander-argv";

export type HorizonCommand = "alerts" | "close-market" | "close-sweep" | "inspect-close";

export type HorizonCloseSweepOptions = {
  at?: string;
  dryRun: boolean;
  limit: number;
};

export type HorizonInspectCloseOptions = {
  approvedBy?: string;
  at?: string;
  context?: string;
  market: string;
  note?: string;
  reason?: string;
  sourceRef?: string;
  trigger?: string;
};

export type HorizonCloseMarketOptions = {
  approvedBy?: string;
  at?: string;
  context?: string;
  idempotencyKey?: string;
  market: string;
  oracleCaseId?: string;
  reason?: string;
  sourceRef?: string;
  trigger?: string;
};

export type HorizonAlertsOptions = {
  at?: string;
};

export type ParsedHorizonArgs =
  | {
      command: HorizonCommand | undefined;
      helpRequested: true;
      helpText?: string;
      jsonMode: boolean;
      options: undefined;
      unknownCommand?: string;
    }
  | {
      command: "alerts";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: HorizonAlertsOptions;
      unknownCommand?: undefined;
    }
  | {
      command: "close-market";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: HorizonCloseMarketOptions;
      unknownCommand?: undefined;
    }
  | {
      command: "close-sweep";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: HorizonCloseSweepOptions;
      unknownCommand?: undefined;
    }
  | {
      command: "inspect-close";
      helpRequested: false;
      helpText?: string;
      jsonMode: boolean;
      options: HorizonInspectCloseOptions;
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

function readRequiredString(value: unknown, flagName: string): string {
  const parsed = OptionalStringSchema.safeParse(value);

  if (!parsed.success || !parsed.data) {
    throw new Error(`Missing required flag --${flagName}`);
  }

  return parsed.data;
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

function readPositiveIntegerOption(value: unknown, flagName: string, fallback: number): number {
  const parsed = z.union([
    z.number(),
    z.string().trim().min(1)
  ]).optional().safeParse(value);

  if (!parsed.success || parsed.data === undefined) {
    return fallback;
  }

  const numeric = typeof parsed.data === "number"
    ? parsed.data
    : /^[1-9]\d*$/.test(parsed.data)
      ? Number(parsed.data)
      : Number.NaN;

  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`Flag --${flagName} must be a positive integer.`);
  }

  return numeric;
}

function buildHorizonCommand(commandName: HorizonCommand): Command {
  const command = new Command(commandName)
    .allowExcessArguments(true)
    .allowUnknownOption(true)
    .exitOverride();

  if (commandName === "alerts") {
    command.option("--at [value]");
    return command;
  }

  if (commandName === "close-sweep") {
    command
      .option("--at [value]")
      .option("--dry-run [value]")
      .option("--limit [value]");
    return command;
  }

  if (commandName === "inspect-close") {
    command
      .option("--approved-by [value]")
      .option("--at [value]")
      .option("--context [value]")
      .option("--market [value]")
      .option("--note [value]")
      .option("--reason [value]")
      .option("--source-ref [value]")
      .option("--trigger [value]");
    return command;
  }

  command
    .option("--approved-by [value]")
    .option("--at [value]")
    .option("--context [value]")
    .option("--idempotency-key [value]")
    .option("--market [value]")
    .option("--oracle-case-id [value]")
    .option("--reason [value]")
    .option("--source-ref [value]")
    .option("--trigger [value]");
  return command;
}

function readAlertsOptions(options: Record<string, unknown>): HorizonAlertsOptions {
  return {
    at: readOptionalString(options.at)
  };
}

function readCloseSweepOptions(options: Record<string, unknown>): HorizonCloseSweepOptions {
  return {
    at: readOptionalString(options.at),
    dryRun: readBooleanOption(options.dryRun, "dry-run", false),
    limit: readPositiveIntegerOption(options.limit, "limit", 50)
  };
}

function readInspectCloseOptions(options: Record<string, unknown>): HorizonInspectCloseOptions {
  return {
    approvedBy: readOptionalString(options.approvedBy),
    at: readOptionalString(options.at),
    context: readOptionalString(options.context),
    market: readRequiredString(options.market, "market"),
    note: readOptionalString(options.note),
    reason: readOptionalString(options.reason),
    sourceRef: readOptionalString(options.sourceRef),
    trigger: readOptionalString(options.trigger)
  };
}

function readCloseMarketOptions(options: Record<string, unknown>): HorizonCloseMarketOptions {
  return {
    approvedBy: readOptionalString(options.approvedBy),
    at: readOptionalString(options.at),
    context: readOptionalString(options.context),
    idempotencyKey: readOptionalString(options.idempotencyKey),
    market: readRequiredString(options.market, "market"),
    oracleCaseId: readOptionalString(options.oracleCaseId),
    reason: readOptionalString(options.reason),
    sourceRef: readOptionalString(options.sourceRef),
    trigger: readOptionalString(options.trigger)
  };
}

function isHorizonCommand(value: string): value is HorizonCommand {
  return value === "alerts" ||
    value === "close-market" ||
    value === "close-sweep" ||
    value === "inspect-close";
}

export function parseHorizonArgs(argv: string[]): ParsedHorizonArgs {
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

  if (!isHorizonCommand(rawCommand)) {
    return {
      command: undefined,
      helpRequested,
      helpText: helpRequested
        ? new Command(rawCommand).exitOverride().helpInformation()
        : undefined,
      jsonMode,
      options: undefined,
      unknownCommand: rawCommand
    };
  }

  const commandArgs = [
    ...args.slice(0, commandIndex),
    ...args.slice(commandIndex + 1)
  ].filter((arg) => arg !== "--json");
  const command = buildHorizonCommand(rawCommand);

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

  if (rawCommand === "alerts") {
    return {
      command: rawCommand,
      helpRequested: false,
      jsonMode,
      options: readAlertsOptions(options)
    };
  }

  if (rawCommand === "close-market") {
    return {
      command: rawCommand,
      helpRequested: false,
      jsonMode,
      options: readCloseMarketOptions(options)
    };
  }

  if (rawCommand === "close-sweep") {
    return {
      command: rawCommand,
      helpRequested: false,
      jsonMode,
      options: readCloseSweepOptions(options)
    };
  }

  return {
    command: rawCommand,
    helpRequested: false,
    jsonMode,
    options: readInspectCloseOptions(options)
  };
}
