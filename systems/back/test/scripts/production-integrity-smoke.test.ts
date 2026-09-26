import { describe, expect, it } from "vitest";

import {
  formatProductionIntegrityAlert,
  parseProductionIntegritySmokeOptions,
  shouldAlertProductionIntegrity
} from "../../src/scripts/production-integrity-smoke";
import type { ProductionIntegrityReport } from "../../src/ops/production-integrity-checks";

function report(verdict: ProductionIntegrityReport["verdict"]): ProductionIntegrityReport {
  return {
    objectType: "production_integrity_report",
    generatedAt: "2026-06-28T10:00:00.000Z",
    verdict,
    checks: [
      {
        name: "platform_treasury_below_low_watermark",
        severity: "watch",
        count: verdict === "watch" ? 1 : 0
      },
      {
        name: "ledger_unbalanced_transactions",
        severity: "bad",
        count: verdict === "bad" ? 2 : 0
      }
    ]
  };
}

describe("production integrity smoke", () => {
  it("alerts on bad reports when alerting is enabled", () => {
    expect(shouldAlertProductionIntegrity(report("bad"), {
      alert: true,
      alertOnWatch: false
    })).toBe(true);
  });

  it("only alerts on watch reports when alert-on-watch is enabled", () => {
    expect(shouldAlertProductionIntegrity(report("watch"), {
      alert: true,
      alertOnWatch: false
    })).toBe(false);
    expect(shouldAlertProductionIntegrity(report("watch"), {
      alert: true,
      alertOnWatch: true
    })).toBe(true);
  });

  it("formats a compact secret-free alert message", () => {
    expect(formatProductionIntegrityAlert(report("bad"))).toBe(
      "production-integrity: bad at 2026-06-28T10:00:00.000Z; bad:ledger_unbalanced_transactions=2"
    );
  });

  it("parses monitor flags for receipt and Telegram alert mode", () => {
    const options = parseProductionIntegritySmokeOptions([
      "--json",
      "--fail-on-watch",
      "--alert",
      "--alert-on-watch",
      "--receipt-path=workspace/runtime/integrity/test.jsonl"
    ]);

    expect(options).toMatchObject({
      json: true,
      failOnWatch: true,
      alert: true,
      alertOnWatch: true,
      receiptPath: "workspace/runtime/integrity/test.jsonl"
    });
    expect(options.alertScriptPath.replaceAll("\\", "/")).toContain("workspace/scripts/platform-alert.sh");
  });
});
