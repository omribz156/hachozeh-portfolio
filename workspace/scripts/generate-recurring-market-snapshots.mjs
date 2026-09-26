#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

function requireArg(name) {
  const value = args.get(name);
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function deepMap(value, mapper) {
  if (typeof value === "string") {
    return mapper(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepMap(item, mapper));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepMap(item, mapper)]));
  }
  return value;
}

function replaceAll(input, pairs) {
  let output = input;
  for (const [from, to] of pairs) {
    output = output.split(from).join(to);
  }
  return output;
}

function setExpectedResolutionAt(value, iso) {
  if (Array.isArray(value)) {
    for (const item of value) {
      setExpectedResolutionAt(item, iso);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, "expectedResolutionAt")) {
    value.expectedResolutionAt = iso;
  }
  for (const item of Object.values(value)) {
    setExpectedResolutionAt(item, iso);
  }
}

function runWeather() {
  const fromPath = requireArg("--weather-from");
  const outPath = requireArg("--weather-out");
  const fromDate = requireArg("--weather-from-date");
  const toDate = requireArg("--weather-to-date");
  const fromNextDate = requireArg("--weather-from-next-date");
  const toNextDate = requireArg("--weather-to-next-date");
  const fromHe = requireArg("--weather-from-he");
  const toHe = requireArg("--weather-to-he");
  const fromNextHe = requireArg("--weather-from-next-he");
  const toNextHe = requireArg("--weather-to-next-he");
  const expectedResolutionAt = requireArg("--weather-expected-resolution-at");
  const snapshot = readJson(fromPath);
  const next = deepMap(snapshot, (text) =>
    replaceAll(text, [
      [fromDate, toDate],
      [fromNextDate, toNextDate],
      [fromHe, toHe],
      [fromNextHe, toNextHe],
      ["weather-city-high-temp-2026-07-16-prod", "weather-city-high-temp-2026-07-23-prod"],
      ["2026-07-17-prod", "2026-07-23-prod"]
    ])
  );
  next.snapshotId = "market-creation-drafts-weather-city-high-temp-2026-07-23-prod";
  next.generatedAt = new Date().toISOString();
  setExpectedResolutionAt(next, expectedResolutionAt);
  writeJson(outPath, next);
}

function runCrypto() {
  const fromPath = requireArg("--crypto-from");
  const outPath = requireArg("--crypto-out");
  const fromDate = requireArg("--crypto-from-date");
  const toDate = requireArg("--crypto-to-date");
  const fromNextDate = requireArg("--crypto-from-next-date");
  const toNextDate = requireArg("--crypto-to-next-date");
  const fromHe = requireArg("--crypto-from-he");
  const toHe = requireArg("--crypto-to-he");
  const fromNextHe = requireArg("--crypto-from-next-he");
  const toNextHe = requireArg("--crypto-to-next-he");
  const snapshot = readJson(fromPath);
  const next = deepMap(
    {
      ...snapshot,
      items: snapshot.items.slice(0, 2)
    },
    (text) =>
      replaceAll(text, [
        [fromDate, toDate],
        [fromNextDate, toNextDate],
        [fromHe, toHe],
        [fromNextHe, toNextHe],
        ["mcds-crypto-travel-eurovision-2026-07-prod-20260706T080500Z", "mcds-crypto-close-range-2026-07-16-prod"],
        ["crypto-travel-eurovision-2026-07-prod", "crypto-close-range-2026-07-16-prod"]
      ])
  );
  next.snapshotId = "mcds-crypto-close-range-2026-07-16-prod";
  next.generatedAt = new Date().toISOString();
  writeJson(outPath, next);
}

const mode = requireArg("--mode");
if (mode === "weather") {
  runWeather();
} else if (mode === "crypto") {
  runCrypto();
} else {
  throw new Error(`unsupported --mode ${mode}`);
}
