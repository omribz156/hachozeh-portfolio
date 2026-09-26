#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const defaultLimits = new Map([
  ["hachozeh-horizon-scheduler", 20],
  ["hachozeh-oracle-worker", 20],
  ["hachozeh-market-watch", 60],
  ["hachozeh-prod-doctor-hourly", 120]
]);

function usage() {
  console.log(`Usage:
  workspace/scripts/render-cron-freshness-check.mjs [options]

Options:
  --service <name>       Limit to cron service name. Can be repeated.
  --max-age-min <n>      Override max age for all selected crons.
  --allow-suspended      Do not fail on suspended crons.
  --json                 Emit JSON.
  -h, --help             Show help.

Purpose:
  Check Render cron jobs are not suspended and have a recent successful run.
`);
}

function parseArgs(argv) {
  const options = { services: [], maxAgeMin: null, allowSuspended: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--service") {
      options.services.push(argv[++index] ?? "");
    } else if (arg.startsWith("--service=")) {
      options.services.push(arg.slice("--service=".length));
    } else if (arg === "--max-age-min") {
      options.maxAgeMin = Number(argv[++index] ?? NaN);
    } else if (arg.startsWith("--max-age-min=")) {
      options.maxAgeMin = Number(arg.slice("--max-age-min=".length));
    } else if (arg === "--allow-suspended") {
      options.allowSuspended = true;
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
  if (options.maxAgeMin !== null && (!Number.isFinite(options.maxAgeMin) || options.maxAgeMin <= 0)) {
    console.error("--max-age-min must be a positive number.");
    process.exit(2);
  }
  return options;
}

function renderServices() {
  const output = execFileSync("render", ["services", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output).map((row) => row.service).filter(Boolean);
}

const options = parseArgs(process.argv.slice(2));
const now = Date.now();
const crons = renderServices()
  .filter((service) => service.type === "cron_job")
  .filter((service) => options.services.length === 0 || options.services.includes(service.name));

const rows = crons.map((service) => {
  const last = service.serviceDetails?.lastSuccessfulRunAt ?? null;
  const lastMs = last ? Date.parse(last) : NaN;
  const ageMin = Number.isFinite(lastMs) ? Math.round((now - lastMs) / 60000) : null;
  const maxAgeMin = options.maxAgeMin ?? defaultLimits.get(service.name) ?? 120;
  const suspended = service.suspended !== "not_suspended";
  const fresh = ageMin !== null && ageMin <= maxAgeMin;
  const ok = fresh && (options.allowSuspended || !suspended);
  return {
    name: service.name,
    id: service.id,
    schedule: service.serviceDetails?.schedule ?? null,
    suspended,
    lastSuccessfulRunAt: last,
    ageMin,
    maxAgeMin,
    ok
  };
});

const failures = rows.filter((row) => !row.ok);
const receipt = {
  objectType: "render_cron_freshness_check",
  checkedAt: new Date(now).toISOString(),
  rows,
  failures
};

if (options.json) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log("Render cron freshness check");
  for (const row of rows) {
    const status = row.ok ? "ok" : "fail";
    const age = row.ageMin === null ? "never" : `${row.ageMin}m`;
    const suspended = row.suspended ? " suspended" : "";
    console.log(`${status} ${row.name} last=${age} max=${row.maxAgeMin}m schedule=${row.schedule}${suspended}`);
  }
}

if (failures.length > 0) process.exit(1);
