import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import {
  collectHighFindingsFromPaths,
  collectHighFindingsFromSarifDocument,
  parseSecuritySeverity,
  resolveMessage,
} from "./check-codeql-sarif-gate.mjs";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "codeql-sarif-gate");
const scriptPath = path.join(process.cwd(), "workspace", "scripts", "check-codeql-sarif-gate.mjs");
const defaultThreshold = 7;

test("parseSecuritySeverity accepts valid numeric formats", () => {
  assert.equal(parseSecuritySeverity(9), 9);
  assert.equal(parseSecuritySeverity("9.4"), 9.4);
});

test("parseSecuritySeverity rejects malformed numeric values", () => {
  assert.throws(() => parseSecuritySeverity("high"), /numeric/);
});

test("resolveMessage truncates long messages", () => {
  const longMessage = "x".repeat(500);
  assert.ok(resolveMessage({ message: { text: longMessage } }).endsWith("..."));
});

test("collects high findings using rule index", () => {
  const findings = collectHighFindingsFromPaths(
    [path.join(fixturesRoot, "rule-index.sarif")],
    defaultThreshold
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "R1");
  assert.equal(findings[0].severity, 8.9);
});

test("collects high findings using ruleId fallback", () => {
  const findings = collectHighFindingsFromPaths(
    [path.join(fixturesRoot, "rule-id-fallback.sarif")],
    defaultThreshold
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "RB-2");
  assert.equal(findings[0].severity, 9.2);
});

test("scans multiple runs and multiple files", () => {
  const findings = collectHighFindingsFromPaths([path.join(fixturesRoot, "multi")], defaultThreshold);
  assert.equal(findings.length, 4);
  const ids = new Set(findings.map((item) => item.ruleId));
  assert.deepEqual(ids, new Set(["R9", "RA-2", "MR-1", "MR-3"]));
});

test("ignores low and missing severity findings", () => {
  const findings = collectHighFindingsFromPaths(
    [path.join(fixturesRoot, "low-and-missing-severity.sarif")],
    defaultThreshold
  );
  assert.equal(findings.length, 0);
});

test("throws on malformed severity values", () => {
  assert.throws(
    () =>
      collectHighFindingsFromPaths(
        [path.join(fixturesRoot, "malformed-severity.sarif")],
        defaultThreshold
      ),
    /security-severity/
  );
});

test("throws on malformed SARIF files", () => {
  assert.throws(
    () => collectHighFindingsFromPaths([path.join(fixturesRoot, "malformed-sarif.sarif")], defaultThreshold),
    /Malformed SARIF file/
  );
});

test("CLI exit 0 for zero high-severity findings", () => {
  const child = spawnSync(process.execPath, [scriptPath, "--threshold", "7", path.join(fixturesRoot, "low-and-missing-severity.sarif")], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
});

test("CLI exits 1 for high findings", () => {
  const child = spawnSync(process.execPath, [scriptPath, "--threshold", "7", path.join(fixturesRoot, "multi")], { encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /CodeQL found 4 finding/);
});

function extensionDocument(result, extensions) {
  return { runs: [{
    tool: {
      driver: { name: "CodeQL", rules: [] },
      extensions: extensions ?? [{
        name: "codeql/javascript-queries",
        guid: "javascript-pack",
        rules: [{ id: "js/polynomial-redos", properties: { "security-severity": "7.5" } }],
      }],
    },
    results: [result],
  }] };
}

for (const component of [{ index: 0 }, { name: "codeql/javascript-queries" }, { guid: "javascript-pack" }]) {
  test(`resolves CodeQL extension rules by ${Object.keys(component)[0]}`, () => {
    const doc = extensionDocument({ rule: { index: 0, toolComponent: component } });
    const findings = collectHighFindingsFromSarifDocument(doc, "fixture.sarif", 7);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "js/polynomial-redos");
  });
}

test("resolves a unique ruleId in extensions without a component reference", () => {
  const doc = extensionDocument({ ruleId: "js/polynomial-redos" });
  assert.equal(collectHighFindingsFromSarifDocument(doc, "fixture.sarif", 7).length, 1);
});

test("does not silently pass an invalid extension index", () => {
  const doc = extensionDocument({ rule: { index: 0, toolComponent: { index: 8 } } });
  assert.throws(() => collectHighFindingsFromSarifDocument(doc, "fixture.sarif", 7), /tool component/);
});

test("rejects ambiguous rule ids across components", () => {
  const rule = { id: "same-id", properties: { "security-severity": "9" } };
  const doc = extensionDocument({ ruleId: "same-id" }, [
    { name: "a", rules: [rule] }, { name: "b", rules: [rule] },
  ]);
  assert.throws(() => collectHighFindingsFromSarifDocument(doc, "fixture.sarif", 7), /ambiguous/);
});

test("never uses a low-severity rule when its index conflicts with the result id", () => {
  const doc = extensionDocument({ rule: { index: 0, id: "high", toolComponent: { index: 0 } } }, [{
    name: "a", rules: [
      { id: "low", properties: { "security-severity": "2" } },
      { id: "high", properties: { "security-severity": "9" } },
    ],
  }]);
  assert.throws(() => collectHighFindingsFromSarifDocument(doc, "fixture.sarif", 7), /conflicts/);
});
