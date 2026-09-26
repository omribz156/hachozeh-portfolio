import { readFileSync } from "node:fs";

const [snapshotPath, receiptPath] = process.argv.slice(2);
if (!snapshotPath || !receiptPath) {
  console.error("usage: market-watch-receipt-check.mjs <snapshot.json> <receipt>");
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const receipt = readFileSync(receiptPath, "utf8");
const items = Array.isArray(snapshot.items) ? snapshot.items : [];

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectStrings(entry, output));
  }
  return output;
}

const strings = collectStrings(items);
const watchRequired = strings.includes("market-watch-pings-only-no-mutation");
const planIds = [...new Set(strings.flatMap((value) => {
  const match = value.match(/^market-watch-plan=([A-Za-z0-9_.:-]+)$/);
  return match ? [match[1]] : [];
}))];
const eventIds = [...new Set(items
  .map((item) => item?.eventId ?? item?.event?.id ?? null)
  .filter((value) => typeof value === "string" && value.trim()))];
const errors = [];

if (!watchRequired) errors.push("snapshot does not declare market-watch-pings-only-no-mutation");
if (!/(status\s*:\s*installed|enabled\s*:\s*`?true|installed plan id)/i.test(receipt)) {
  errors.push("receipt does not prove an installed/enabled watch plan");
}
for (const planId of planIds) {
  if (!receipt.includes(planId)) errors.push(`receipt does not match declared plan id: ${planId}`);
}
for (const eventId of eventIds) {
  if (!receipt.includes(eventId)) errors.push(`receipt does not match declared event id: ${eventId}`);
}

const result = {
  objectType: "market_watch_receipt_check",
  valid: errors.length === 0,
  snapshotPath,
  receiptPath,
  planIds,
  eventIds,
  errors
};
console.log(JSON.stringify(result));
if (errors.length > 0) process.exitCode = 2;
