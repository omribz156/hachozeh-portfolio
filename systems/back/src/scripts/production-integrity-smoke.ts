import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import {
  runProductionIntegrityChecks,
  type ProductionIntegrityReport
} from "../ops/production-integrity-checks";
import { inferRepoRoot, readEnvValue, readStringArg } from "./script-args";

const execFileAsync = promisify(execFile);

const repoRoot = inferRepoRoot("INTEGRITY_REPO_ROOT");

export type ProductionIntegritySmokeOptions = {
  json: boolean;
  failOnWatch: boolean;
  alert: boolean;
  alertOnWatch: boolean;
  receiptPath: string;
  alertScriptPath: string;
};

export function parseProductionIntegritySmokeOptions(
  args = process.argv.slice(2)
): ProductionIntegritySmokeOptions {
  return {
    json: args.includes("--json"),
    failOnWatch: args.includes("--fail-on-watch"),
    alert: args.includes("--alert"),
    alertOnWatch: args.includes("--alert-on-watch"),
    receiptPath: readStringArg(
      args,
      "receipt-path",
      readEnvValue("PRODUCTION_INTEGRITY_RECEIPT_PATH", "")
    ),
    alertScriptPath: resolve(
      repoRoot,
      readStringArg(
        args,
        "alert-script",
        readEnvValue("PLATFORM_ALERT_SCRIPT", "workspace/scripts/platform-alert.sh")
      )
    )
  };
}

function resolveReceiptPath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function nonZeroChecks(report: ProductionIntegrityReport) {
  return report.checks.filter((check) => check.count > 0);
}

export function shouldAlertProductionIntegrity(
  report: ProductionIntegrityReport,
  options: Pick<ProductionIntegritySmokeOptions, "alert" | "alertOnWatch">
): boolean {
  if (!options.alert) {
    return false;
  }

  return report.verdict === "bad" || (options.alertOnWatch && report.verdict === "watch");
}

export function formatProductionIntegrityAlert(report: ProductionIntegrityReport): string {
  const checks = nonZeroChecks(report);
  const details = checks.length
    ? checks.map((check) => `${check.severity}:${check.name}=${check.count}`).join(", ")
    : "no non-zero checks";

  return `production-integrity: ${report.verdict} at ${report.generatedAt}; ${details}`;
}

async function appendReceipt(path: string, report: ProductionIntegrityReport): Promise<void> {
  if (!path.trim()) {
    return;
  }

  const resolved = resolveReceiptPath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await appendFile(resolved, `${JSON.stringify(report)}\n`);
}

async function sendPlatformAlert(scriptPath: string, message: string): Promise<void> {
  try {
    const result = await execFileAsync(scriptPath, ["--require-delivery", "send", message], {
      timeout: 15_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) {
      console.log(`[production-integrity] platform alert result: ${output}`);
    }
  } catch (error) {
    console.error(
      `[production-integrity] platform alert failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function run(): Promise<void> {
  const options = parseProductionIntegritySmokeOptions();
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    const report = await runProductionIntegrityChecks(dbPool);
    await appendReceipt(options.receiptPath, report);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        [
          `production-integrity: verdict=${report.verdict}`,
          ...report.checks.map((check) => (
            `production-integrity: ${check.severity}: ${check.name}=${check.count}`
          ))
        ].join("\n")
      );
    }

    if (shouldAlertProductionIntegrity(report, options)) {
      await sendPlatformAlert(options.alertScriptPath, formatProductionIntegrityAlert(report));
    }

    if (report.verdict === "bad" || (options.failOnWatch && report.verdict === "watch")) {
      process.exitCode = 1;
    }
  } finally {
    await dbPool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
