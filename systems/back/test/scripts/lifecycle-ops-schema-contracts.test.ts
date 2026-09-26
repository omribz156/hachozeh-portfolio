import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const repoRoot = join(process.cwd(), "../..");

describe("lifecycle operator SQL schema contracts", () => {
  it("reads an Oracle case winner from its current field in cascade previews", () => {
    const script = source("src/scripts/event-cascade-preview.ts");
    expect(script).toContain("oc.current_winning_outcome_id as winning_outcome_id");
    expect(script).not.toContain("oc.winning_outcome_id");
  });

  it("derives incident recipients and refunds through immutable ledger entries", () => {
    const script = source("src/scripts/market-post-incident-audit.ts");
    expect(script).toContain("join ledger_entries le");
    expect(script).toContain("credit_user_cash_incident_compensation");
    expect(script).not.toContain("target_account_id");
  });

  it("keeps no-arg production doctor wrapper dry-run usable under strict bash", () => {
    const output = execFileSync("bash", ["workspace/scripts/lifecycle-ops.sh", "production-doctor"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("Tool: production-doctor");
    expect(output).toContain("Dry-run only");
    expect(output).toContain("Render job command: node -e");
    expect(output).toContain("[98,97,115,101,54,52]");
    expect(output).not.toContain("`base64`");
    expect(output).not.toContain("'\\''base64'\\''");
  });

  it("keeps the compact Render production doctor output aware of lifecycle integrity", () => {
    const script = source("../../workspace/scripts/render-backend-tool-job.sh");
    expect(script).toContain('module.name==="market_watch"');
    expect(script).toContain('module.name==="market_integrity"');
    expect(script).toContain('module.name==="lifecycle_queue"');
    expect(script).toContain('module.name==="notification_integrity"');
    expect(script).toContain("entry.issueCount=module.report?.issueCount");
    expect(script).toContain("entry.blockerCount=module.report?.blockerCount");
  });

  it("runs queue doctor through a compact Render wrapper", () => {
    const script = source("../../workspace/scripts/render-backend-tool-job.sh");
    expect(script).toContain('runLifecycleQueueDoctor');
    expect(script).toContain('item.severity!=="ok"');
  });

  it("validates that a watch receipt matches the plan and event declared by the draft", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hachozeh-watch-receipt-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const receiptPath = join(tempDir, "watch-plan-receipt.md");
    try {
      writeFileSync(snapshotPath, JSON.stringify({
        items: [{
          eventId: "evt-show",
          contract: {
            operational: {
              notes: [
                "market-watch-pings-only-no-mutation",
                "market-watch-plan=show_official_watch"
              ]
            }
          }
        }]
      }));
      writeFileSync(receiptPath, [
        "Status: installed",
        "- plan id: `show_official_watch`",
        "- event id: `evt-show`",
        "- Enabled: `true`"
      ].join("\n"));

      const output = execFileSync("node", [
        "workspace/scripts/lib/market-watch-receipt-check.mjs",
        snapshotPath,
        receiptPath
      ], { cwd: repoRoot, encoding: "utf8" });
      expect(JSON.parse(output)).toMatchObject({ valid: true, planIds: ["show_official_watch"] });

      writeFileSync(receiptPath, "Status: installed\n- plan id: `different_plan`\n- event id: `evt-show`");
      expect(() => execFileSync("node", [
        "workspace/scripts/lib/market-watch-receipt-check.mjs",
        snapshotPath,
        receiptPath
      ], { cwd: repoRoot, stdio: "pipe" })).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts the top-level production doctor receipt instead of nested event reports", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hachozeh-render-log-"));
    const logPath = join(tempDir, "production-doctor.log");
    try {
      writeFileSync(logPath, [
        '2026-07-15 22:11:41  {"objectType":"event_dependency_doctor","status":"clean"}',
        '2026-07-15 22:11:42  {"event":"production_doctor_report","verdict":"ok","modules":{"event_integrity":{"report":{"events":[{"objectType":"event_dependency_doctor"}]}}}}'
      ].join("\n"));

      const output = execFileSync("bash", ["-lc", 'source workspace/scripts/lib/render-json-job.sh; render_job_extract_json_from_log "$LOG_PATH"'], {
        cwd: repoRoot,
        env: { ...process.env, LOG_PATH: logPath },
        encoding: "utf8"
      });
      const receipt = JSON.parse(output) as { event?: string; verdict?: string; objectType?: string };

      expect(receipt.event).toBe("production_doctor_report");
      expect(receipt.verdict).toBe("ok");
      expect(receipt.objectType).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
