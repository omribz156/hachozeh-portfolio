import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCreateMarketDraftRequest } from "./lifecycle/management/create-market-draft-service";

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("create market draft boundary Zod ownership", () => {
  it("keeps create-market-draft body parsing on Zod-backed boundary helpers", async () => {
    const [requestParserSource, fieldReadersSource, oracleSourcePolicySource] = await Promise.all([
      readSource("lifecycle/management/create-market-draft/request-parser.ts"),
      readSource("lifecycle/management/create-market-draft/field-readers.ts"),
      readSource("lifecycle/management/create-market-draft/oracle-source-policy.ts")
    ]);

    expect(requestParserSource).toContain("shared/zod-request-body");
    expect(requestParserSource).not.toContain("typeof body");
    expect(requestParserSource).not.toContain("typeof entry");
    expect(fieldReadersSource).toContain('from "zod"');
    expect(oracleSourcePolicySource).toContain("shared/zod-request-body");
  });

  it("preserves create-market-draft nullable and required-field parser semantics", () => {
    expect(() => parseCreateMarketDraftRequest([])).toThrow(
      "Create market request body must be an object."
    );
    expect(() =>
      parseCreateMarketDraftRequest({
        title: "Who wins?",
        openAt: "2026-04-01T09:00:00Z",
        closeAt: "2026-04-02T09:00:00Z",
        resolutionSource: "iec",
        resolutionRules: "winner is official result",
        liquidityB: "1000.00000000",
        outcomes: [{ label: "A" }, { label: "B" }]
      })
    ).toThrow("idempotencyKey is required.");

    const request = parseCreateMarketDraftRequest({
      marketId: "",
      familyKey: "  family-1  ",
      eventId: " ",
      eventSlug: " election-months-2026 ",
      eventTitle: " ",
      eventDescription: "",
      eventIcon: null,
      eventChildLabel: undefined,
      title: "  Who wins?  ",
      description: " ",
      categoryKey: " politics ",
      openAt: "2026-04-01T09:00:00Z",
      closeAt: "2026-04-02T09:00:00Z",
      resolutionSource: "  iec  ",
      resolutionRules: "  winner is official result  ",
      liquidityB: "1000.00000000",
      closeOnEventCompletion: true,
      eventCompletionCloseRequiresHumanApproval: true,
      outcomes: [
        { outcomeId: " option-a ", label: " A ", shortLabel: " ", description: "", colorKey: null },
        { label: " B " }
      ],
      idempotencyKey: " create:1 "
    });

    expect(request).toMatchObject({
      marketId: null,
      familyKey: "family-1",
      eventId: null,
      eventSlug: "election-months-2026",
      eventTitle: null,
      eventDescription: null,
      eventIcon: null,
      eventChildLabel: null,
      title: "Who wins?",
      description: null,
      categoryKey: "politics",
      resolutionSource: "iec",
      resolutionRules: "winner is official result",
      outcomes: [
        {
          outcomeId: "option-a",
          label: "A",
          shortLabel: null,
          description: null,
          colorKey: null
        },
        {
          outcomeId: null,
          label: "B",
          shortLabel: null,
          description: null,
          colorKey: null
        }
      ],
      idempotencyKey: "create:1"
    });
  });
});
