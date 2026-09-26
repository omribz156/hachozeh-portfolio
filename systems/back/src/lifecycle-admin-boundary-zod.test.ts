import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCloseMarketRequest } from "./lifecycle/horizon/close-market-service";
import { parsePublishMarketRequest } from "./lifecycle/management/publish-market-service";
import { parseVoidMarketRequest } from "./lifecycle/management/void-market-service";

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("admin lifecycle boundary Zod ownership", () => {
  it("keeps publish, close, and void body parsing on the shared Zod boundary helper", async () => {
    const sources = await Promise.all([
      readSource("lifecycle/horizon/close-market-service.ts"),
      readSource("lifecycle/management/publish-market/request-parser.ts"),
      readSource("lifecycle/management/void-market-service.ts")
    ]);

    for (const source of sources) {
      expect(source).toContain("shared/zod-request-body");
      expect(source).not.toContain("function readTrimmedString");
    }
  });

  it("preserves direct parser errors and nullable whitespace behavior for lifecycle actions", () => {
    expect(() => parseCloseMarketRequest([])).toThrow("Close request body must be an object.");
    expect(() =>
      parseCloseMarketRequest({
        triggerType: "scheduled_time",
        reason: "Routine close"
      })
    ).toThrow("idempotencyKey is required.");

    expect(parseCloseMarketRequest({
      triggerType: "scheduled_time",
      reason: "  Routine close  ",
      sourceUrl: "   ",
      note: "",
      oracleCaseId: null,
      triggeredByOracleId: undefined,
      approvedByHumanId: "  admin_1  ",
      idempotencyKey: "  close:1  ",
      requestedAt: "   "
    })).toMatchObject({
      reason: "Routine close",
      sourceUrl: null,
      note: null,
      oracleCaseId: null,
      triggeredByOracleId: null,
      approvedByHumanId: "admin_1",
      idempotencyKey: "close:1",
      requestedAt: undefined
    });

    expect(() => parsePublishMarketRequest(null)).toThrow("Publish request body must be an object.");
    expect(() => parsePublishMarketRequest({
      seedAmount: "100.000000"
    })).toThrow("idempotencyKey is required.");
    expect(parsePublishMarketRequest({
      publishAt: " ",
      seedAmount: " 100.000000 ",
      note: " ",
      reviewId: null,
      checklistVersion: "",
      managementApprovedAt: undefined,
      idempotencyKey: " publish:1 "
    })).toMatchObject({
      publishAt: null,
      seedAmount: "100.000000",
      note: null,
      reviewId: null,
      checklistVersion: null,
      managementApprovedAt: null,
      idempotencyKey: "publish:1"
    });

    expect(() => parseVoidMarketRequest("bad")).toThrow("Void request body must be an object.");
    expect(() => parseVoidMarketRequest({
      reason: "cleanup"
    })).toThrow("idempotencyKey is required.");
    expect(parseVoidMarketRequest({
      reason: " cleanup ",
      note: " ",
      idempotencyKey: " void:1 ",
      requestedAt: ""
    })).toMatchObject({
      reason: "cleanup",
      note: null,
      idempotencyKey: "void:1",
      requestedAt: undefined
    });
  });
});
