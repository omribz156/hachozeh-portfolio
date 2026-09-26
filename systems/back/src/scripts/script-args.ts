import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function readStringArg(args: string[], name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (equalsValue !== undefined) {
    return equalsValue;
  }

  const flag = `--${name}`;
  const index = args.findIndex((arg) => arg === flag);
  if (index >= 0) {
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      return next;
    }
  }

  return fallback;
}

export function readPositiveNumberArg(args: string[], name: string, fallback: number): number {
  const raw = readStringArg(args, name, "");

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return parsed;
}

export function readNonNegativeNumberArg(args: string[], name: string, fallback: number): number {
  const raw = readStringArg(args, name, "");

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsed;
}

export function readOptionalPositiveIntegerArg(args: string[], name: string): number | null {
  const raw = readStringArg(args, name, "");

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

export function readEnvValue(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

export function inferRepoRoot(envName: string): string {
  if (process.env[envName]) {
    return resolve(process.env[envName]);
  }

  if (process.env.INIT_CWD && existsSync(resolve(process.env.INIT_CWD, "systems/back/package.json"))) {
    return resolve(process.env.INIT_CWD);
  }

  if (existsSync(resolve(process.cwd(), "systems/back/package.json"))) {
    return process.cwd();
  }

  if (existsSync(resolve(process.cwd(), "../../systems/back/package.json"))) {
    return resolve(process.cwd(), "../..");
  }

  return process.cwd();
}
