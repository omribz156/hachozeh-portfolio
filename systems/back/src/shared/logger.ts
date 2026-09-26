import type { LogLevel } from "../config/env";

type LogContext = Record<string, unknown>;

const LOG_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  return value;
}

function normalizeContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, normalizeError(value)])
  );
}

export class Logger {
  constructor(
    private readonly minimumLevel: LogLevel,
    private readonly bindings: LogContext = {}
  ) {}

  child(bindings: LogContext): Logger {
    return new Logger(this.minimumLevel, {
      ...this.bindings,
      ...bindings
    });
  }

  debug(message: string, context: LogContext = {}): void {
    this.write("debug", message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.write("info", message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.write("warn", message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    if (LOG_ORDER[level] < LOG_ORDER[this.minimumLevel]) {
      return;
    }

    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...normalizeContext(context)
    };

    const line = JSON.stringify(record, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }

      if (typeof value === "undefined") {
        return null;
      }

      return value;
    });

    if (level === "warn" || level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

export function createLogger(level: LogLevel, bindings: LogContext = {}): Logger {
  return new Logger(level, bindings);
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return "string_thrown";
  }

  if (error === null || typeof error === "undefined") {
    return String(error);
  }

  return "non_error_thrown";
}
