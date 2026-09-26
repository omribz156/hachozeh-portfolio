import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseArgs,
  parseReviewFeedbackCommandInput
} from "../../seer/src/main-args";

async function readSeerSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "..", "seer", "src", relativePath), "utf8");
}

describe("seer parseArgs", () => {
  it("parses Seer commands through the Commander command tree", () => {
    const parsed = parseArgs([
      "node",
      "main.ts",
      "source-add",
      "--label",
      "Bank of Israel",
      "--class",
      "authority",
      "--stages",
      "grounding|review",
      "--categories",
      "economy|policy",
      "--json"
    ]);

    expect(parsed.command).toBe("source-add");
    expect(parsed.jsonMode).toBe(true);
    expect(parsed.helpRequested).toBe(false);
    expect(Object.fromEntries(parsed.flags)).toMatchObject({
      label: "Bank of Israel",
      class: "authority",
      stages: "grounding|review",
      categories: "economy|policy"
    });
  });

  it("keeps boolean flag compatibility", () => {
    const parsed = parseArgs([
      "node",
      "main.ts",
      "heartbeat",
      "--bridge-only"
    ]);

    expect(parsed.command).toBe("heartbeat");
    expect(Object.fromEntries(parsed.flags)).toEqual({
      "bridge-only": "true"
    });
  });

  it("tolerates unknown flags and extra positional args", () => {
    const parsed = parseArgs([
      "node",
      "main.ts",
      "scan",
      "extra-positional",
      "--future-flag",
      "loose",
      "--json"
    ]);

    expect(parsed.command).toBe("scan");
    expect(parsed.jsonMode).toBe(true);
    expect(Object.fromEntries(parsed.flags)).toEqual({
      "future-flag": "loose"
    });
  });

  it("returns Commander-generated command help", () => {
    const parsed = parseArgs([
      "node",
      "main.ts",
      "source-add",
      "--help"
    ]);

    expect(parsed.command).toBe("source-add");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: source-add");
    expect(parsed.helpText).toContain("--label [value]");
  });

  it("returns command help before review-feedback payload validation", () => {
    const parsed = parseArgs([
      "node",
      "main.ts",
      "review-feedback",
      "--action",
      "ship-it",
      "--help"
    ]);

    expect(parsed.command).toBe("review-feedback");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: review-feedback");
  });

  it.each([
    [
      ["node", "main.ts", "review-feedback", "--action", "ship-it"],
      "Invalid --action. Expected one of: approve, approve-with-edits, hold, merge, reject, escalate, request-rework"
    ],
    [
      [
        "node",
        "main.ts",
        "review-feedback",
        "--action",
        "approve",
        "--reason-category",
        "vibes"
      ],
      "Invalid --reason-category. Expected one of: good-as-is, wording-needs-improvement, outcome-structure-needs-improvement, duplicate-or-overlap, too-early, insufficient-grounding, non-resolvable, policy-risk, sensitivity-risk, proposal-quality-weak, fit, wording, duplicate, timing, outcomes, authority, sensitivity, other"
    ]
  ])("validates review-feedback payload flags before execution for %s", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it.each([
    ["review-item", "Missing required flag --review-item"],
    ["candidate-market", "Missing required flag --candidate-market"],
    ["reason-summary", "Missing required flag --reason-summary"]
  ])("requires review-feedback %s payload flag", (flagName, message) => {
    const flags = new Map([
      ["action", "approve"],
      ["reason-category", "fit"],
      ["review-item", "review_1"],
      ["candidate-market", "candidate_1"],
      ["reason-summary", "looks good"]
    ]);
    flags.delete(flagName);

    expect(() => parseReviewFeedbackCommandInput(flags)).toThrow(message);
  });

  it("normalizes review-feedback aliases and list payloads", () => {
    const parsed = parseReviewFeedbackCommandInput(new Map([
      ["action", "approve"],
      ["reason-category", "fit"],
      ["review-item", "review_1"],
      ["candidate-market", "candidate_1"],
      ["reason-summary", "looks good"],
      ["edited-outcomes", " yes | no "],
      ["notes", " first | second | "]
    ]));

    expect(parsed).toMatchObject({
      reviewItemId: "review_1",
      candidateMarketId: "candidate_1",
      action: "approve",
      reasonCategory: "good-as-is",
      reasonSummary: "looks good",
      editedOutcomes: [
        {
          label: "yes",
          kind: "named-outcome"
        },
        {
          label: "no",
          kind: "named-outcome"
        }
      ],
      notes: ["first", "second"]
    });
  });

  it("keeps review-feedback payload parsing in Zod-backed helpers", async () => {
    const [argsSource, mainSource] = await Promise.all([
      readSeerSource("main-args.ts"),
      readSeerSource("main.ts")
    ]);

    expect(argsSource).toContain('from "zod"');
    expect(argsSource).toContain("parseReviewFeedbackCommandInput");
    expect(mainSource).toContain("parseReviewFeedbackCommandInput");
    expect(mainSource).not.toContain("allowedActions.includes(action)");
    expect(mainSource).not.toContain("allowedReasonCategories.includes(rawReasonCategory)");
  });
});
