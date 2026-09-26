#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLD = 7;
const MAX_MESSAGE_LENGTH = 180;

export function parseSecuritySeverity(rawSeverity, context) {
  if (rawSeverity === undefined || rawSeverity === null) {
    return null;
  }

  if (typeof rawSeverity === "number") {
    if (!Number.isFinite(rawSeverity)) {
      throw new Error(`${context}: security-severity must be a finite number`);
    }
    return rawSeverity;
  }

  if (typeof rawSeverity !== "string") {
    throw new Error(`${context}: security-severity must be a number or numeric string`);
  }

  const trimmed = rawSeverity.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!/^[+-]?(\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    throw new Error(`${context}: security-severity must be numeric (${JSON.stringify(rawSeverity)})`);
  }

  const parsed = Number(trimmed);
  return parsed;
}

export function resolveMessage(result) {
  const message = result?.message?.text ?? result?.message?.markdown ?? result?.shortMessage ?? "";
  if (typeof message !== "string") {
    return "No message";
  }
  const trimmed = message.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

export function resolveRuleId(result, ruleDescriptor) {
  return String(ruleDescriptor?.id ?? result.ruleId ?? "unknown");
}

function collectSarifFiles(input) {
  const stats = fs.statSync(input);

  if (stats.isFile()) {
    if (path.extname(input) !== ".sarif") {
      throw new Error(`Expected a .sarif file: ${input}`);
    }
    return [input];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not file or directory: ${input}`);
  }

  const entries = fs.readdirSync(input, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const joined = path.join(input, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSarifFiles(joined));
    } else if (entry.isFile() && path.extname(entry.name) === ".sarif") {
      files.push(joined);
    }
  }
  return files;
}

export function collectSarifFilesFromInputs(inputs) {
  if (inputs.length === 0) {
    throw new Error("No SARIF files or directories were provided");
  }

  const fileSet = new Set();
  for (const rawInput of inputs) {
    const input = path.resolve(rawInput);
    if (!fs.existsSync(input)) {
      throw new Error(`Input does not exist: ${input}`);
    }
    for (const file of collectSarifFiles(input)) {
      fileSet.add(file);
    }
  }

  const files = [...fileSet].sort();
  if (files.length === 0) {
    throw new Error("No SARIF files found in provided inputs");
  }

  return files;
}

function resolveRuleDescriptor(result, run, context) {
  const driver = run?.tool?.driver;
  const extensions = run?.tool?.extensions ?? [];
  const reference = result.rule?.toolComponent;
  let components = [driver, ...extensions].filter(Boolean);

  // CodeQL query packs can store descriptors in extensions, not the driver.
  if (reference) {
    if (reference.index !== undefined) {
      if (!Number.isInteger(reference.index) || reference.index < 0 || !extensions[reference.index]) {
        throw new Error(`${context}: invalid tool component index`);
      }
      components = [extensions[reference.index]];
    }
    components = components.filter((component) =>
      (reference.name === undefined || component.name === reference.name) &&
      (reference.guid === undefined || component.guid === reference.guid)
    );
    if (components.length !== 1) {
      throw new Error(`${context}: unresolved or ambiguous tool component`);
    }
  }

  const id = result.rule?.id ?? result.ruleId;
  const index = result.rule?.index ?? result.ruleIndex;
  if (result.rule?.id && result.ruleId && result.rule.id !== result.ruleId) {
    throw new Error(`${context}: rule id conflicts with result.ruleId`);
  }
  if (index !== undefined) {
    const component = reference ? components[0] : driver;
    const rule = Number.isInteger(index) && index >= 0 ? component?.rules?.[index] : undefined;
    if (rule) {
      if (id && rule.id !== id) {
        throw new Error(`${context}: rule index conflicts with rule id`);
      }
      return rule;
    }
    throw new Error(`${context}: unable to resolve rule descriptor index`);
  }

  if (typeof id === "string" && id.length > 0) {
    const matches = components.flatMap((component) =>
      (component.rules ?? []).filter((rule) => rule?.id === id)
    );
    if (matches.length > 1) {
      throw new Error(`${context}: ambiguous rule descriptor`);
    }
    if (matches.length === 1) {
      return matches[0];
    }
  }

  throw new Error(`${context}: unable to resolve rule descriptor`);
}

export function collectHighFindingsFromSarifDocument(document, filePath, threshold) {
  if (!document || typeof document !== "object") {
    throw new Error(`Malformed SARIF document (${filePath}): expected object`);
  }
  if (!Array.isArray(document.runs)) {
    throw new Error(`Malformed SARIF document (${filePath}): missing runs array`);
  }

  const matches = [];

  for (const run of document.runs) {
    if (!run || typeof run !== "object" || !Array.isArray(run.results)) {
      continue;
    }

    for (const result of run.results) {
      if (!result || typeof result !== "object") {
        throw new Error(`Malformed SARIF result (${filePath}): expected object`);
      }

      const context = `Malformed SARIF result (${filePath}): ${result.rule?.id ?? result.ruleId ?? "unknown rule"} / index ${result.rule?.index ?? result.ruleIndex ?? "n/a"}`;
      const descriptor = resolveRuleDescriptor(result, run, context);
      const severityValue = parseSecuritySeverity(descriptor?.properties?.["security-severity"], context);

      if (severityValue === null || severityValue < threshold) {
        continue;
      }

      matches.push({
        file: filePath,
        ruleId: resolveRuleId(result, descriptor),
        severity: severityValue,
        message: resolveMessage(result),
      });
    }
  }

  return matches;
}

export function collectHighFindingsFromPaths(inputs, threshold = DEFAULT_THRESHOLD) {
  const files = collectSarifFilesFromInputs(inputs);
  const findings = [];
  for (const file of files) {
    let document;
    try {
      document = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`Malformed SARIF file (${file}): ${error.message}`);
    }
    findings.push(...collectHighFindingsFromSarifDocument(document, file, Number(threshold)));
  }

  return findings;
}

export function printFindings(findings, threshold) {
  if (findings.length === 0) {
    console.log(`No CodeQL findings with security-severity >= ${threshold}.`);
    return;
  }

  console.error(`CodeQL found ${findings.length} finding(s) with security-severity >= ${threshold}:`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:`);
    console.error(`  ${finding.ruleId} @ severity=${finding.severity}`);
    console.error(`  ${finding.message}`);
  }
}

export function parseArgs(argv) {
  let threshold = DEFAULT_THRESHOLD;
  const inputs = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node check-codeql-sarif-gate.mjs [--threshold <7.0>] <sarif_file_or_dir>...");
      process.exit(0);
    }

    if (arg === "--threshold") {
      const rawValue = argv[index + 1];
      if (rawValue === undefined) {
        throw new Error("--threshold requires a value");
      }
      threshold = Number(rawValue);
      if (Number.isNaN(threshold)) {
        throw new Error(`Invalid --threshold value: ${rawValue}`);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--threshold=")) {
      threshold = Number(arg.slice("--threshold=".length));
      if (Number.isNaN(threshold)) {
        throw new Error(`Invalid --threshold value: ${arg}`);
      }
      continue;
    }

    inputs.push(arg);
  }

  return { threshold, inputs };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { threshold, inputs } = parseArgs(process.argv.slice(2));
    const findings = collectHighFindingsFromPaths(inputs, threshold);
    printFindings(findings, threshold);
    process.exit(findings.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(`CodeQL SARIF gate failed: ${error.message}`);
    process.exit(1);
  }
}
