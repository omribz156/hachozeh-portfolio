#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const defaults = {
  renderYaml: path.join(repoRoot, "render.yaml"),
  contract: path.join(repoRoot, "workspace/deploy/production-env-contract.md"),
  local: false,
  strict: false,
  json: false
};

function usage() {
  console.log(`Usage:
  workspace/scripts/render-env-contract-check.mjs [options]

Options:
  --render-yaml <path>   Render blueprint path. Defaults to render.yaml.
  --contract <path>      Production env contract doc. Defaults to workspace/deploy/production-env-contract.md.
  --local                Also check current process env for required secret-like keys.
  --strict               Fail on secret-like render.yaml keys missing from the contract.
  --json                 Emit JSON.
  -h, --help             Show help.

Purpose:
  Static env contract guard for production deploys. Verifies keys documented in
  the production env contract are declared in render.yaml, and flags keys in
  render.yaml that are missing from the contract. Does not print secret values.
`);
}

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--render-yaml") {
      options.renderYaml = path.resolve(argv[++index] ?? "");
    } else if (arg.startsWith("--render-yaml=")) {
      options.renderYaml = path.resolve(arg.slice("--render-yaml=".length));
    } else if (arg === "--contract") {
      options.contract = path.resolve(argv[++index] ?? "");
    } else if (arg.startsWith("--contract=")) {
      options.contract = path.resolve(arg.slice("--contract=".length));
    } else if (arg === "--local") {
      options.local = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }
  return options;
}

function readFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(2);
  }
}

function collectRenderKeys(renderYaml) {
  const keys = new Set();
  const keyPattern = /^\s*-\s+key:\s*([A-Z0-9_]+)\s*$/gm;
  let match;
  while ((match = keyPattern.exec(renderYaml)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function collectContractKeys(markdown) {
  const keys = new Set();
  const envPattern = /\b([A-Z][A-Z0-9_]{2,})=/g;
  let match;
  while ((match = envPattern.exec(markdown)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function isSecretLike(key) {
  return /TOKEN|SECRET|PASSWORD|PRIVATE|DSN|KEY|RECIPIENT|DATABASE_URL|INTERNAL_API_BASE_URL/.test(key);
}

function isRenderRequiredContractKey(key) {
  if (
    /^(BACKUP_|MIGRATION_|WATCHDOG_|PITR_|RESTORE_DRILL_|NAVI_BACKUP_DIR$|NAVI_COMMIT_SHA$|NAVI_BUILD_TIMESTAMP$|NAVI_RELEASE_ID$)/.test(key)
  ) {
    return false;
  }
  if (/^(DB_PRIVILEGE_AUDIT_|DOCTOR_REPORT_PATH$|PRODUCTION_INTEGRITY_RECEIPT_PATH$)/.test(key)) {
    return false;
  }
  if (key === "DOCTOR_DIAGNOSTICS_BEARER") {
    return false;
  }
  if (/^AVATAR_REQUIRE_MALWARE_SCAN$/.test(key)) {
    return false;
  }
  return true;
}

function sorted(values) {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

const options = parseArgs(process.argv.slice(2));
const renderYaml = readFile(options.renderYaml);
const contract = readFile(options.contract);
const renderKeys = collectRenderKeys(renderYaml);
const contractKeys = collectContractKeys(contract);

const missingFromRender = sorted([...contractKeys].filter((key) => isRenderRequiredContractKey(key) && !renderKeys.has(key)));
const missingFromContract = sorted([...renderKeys].filter((key) => !contractKeys.has(key) && isSecretLike(key)));
const localMissing = options.local
  ? sorted([...contractKeys].filter((key) => isSecretLike(key) && !process.env[key]))
  : [];

const receipt = {
  objectType: "render_env_contract_check",
  renderYaml: path.relative(repoRoot, options.renderYaml),
  contract: path.relative(repoRoot, options.contract),
  renderKeyCount: renderKeys.size,
  contractKeyCount: contractKeys.size,
  missingFromRender,
  missingFromContract,
  localMissing,
  strict: options.strict,
  liveRenderEnvInspection: "not_checked_by_render_cli"
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log("Render Env Contract Check");
  console.log(`- render.yaml keys: ${receipt.renderKeyCount}`);
  console.log(`- contract keys: ${receipt.contractKeyCount}`);
  console.log(`- missing from render.yaml: ${missingFromRender.length ? missingFromRender.join(", ") : "none"}`);
  console.log(`- secret-like keys missing from contract: ${missingFromContract.length ? missingFromContract.join(", ") : "none"}${options.strict ? "" : " (warning)"}`);
  if (options.local) {
    console.log(`- local missing secret-like keys: ${localMissing.length ? localMissing.join(", ") : "none"}`);
  }
  console.log("- live Render env values: not checked; installed Render CLI does not expose env-group inspection");
}

if (missingFromRender.length > 0 || (options.strict && missingFromContract.length > 0) || localMissing.length > 0) {
  process.exit(1);
}
