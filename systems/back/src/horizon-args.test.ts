import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseHorizonArgs } from "./scripts/horizon-args";

async function readBackSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("horizon CLI args", () => {
  it("parses close-sweep through the Horizon Commander boundary", () => {
    const parsed = parseHorizonArgs([
      "node",
      "horizon.ts",
      "close-sweep",
      "--limit",
      "5",
      "--dry-run",
      "--json"
    ]);

    expect(parsed.command).toBe("close-sweep");
    expect(parsed.jsonMode).toBe(true);
    expect(parsed.options).toEqual({
      at: undefined,
      dryRun: true,
      limit: 5
    });
  });

  it("validates close-sweep option shapes with Zod-backed errors", () => {
    expect(() =>
      parseHorizonArgs([
        "node",
        "horizon.ts",
        "close-sweep",
        "--limit",
        "0"
      ])
    ).toThrow("Flag --limit must be a positive integer.");

    expect(() =>
      parseHorizonArgs([
        "node",
        "horizon.ts",
        "close-sweep",
        "--limit",
        "1.5"
      ])
    ).toThrow("Flag --limit must be a positive integer.");

    expect(() =>
      parseHorizonArgs([
        "node",
        "horizon.ts",
        "close-sweep",
        "--dry-run",
        "maybe"
      ])
    ).toThrow("Flag --dry-run must be true or false.");
  });

  it("preserves unknown command handling for horizon.ts", () => {
    const parsed = parseHorizonArgs([
      "node",
      "horizon.ts",
      "not-a-command"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.unknownCommand).toBe("not-a-command");
    expect(parsed.helpRequested).toBe(false);
  });

  it("returns generated command help scoped to Horizon commands", () => {
    const parsed = parseHorizonArgs([
      "node",
      "horizon.ts",
      "close-market",
      "--help"
    ]);

    expect(parsed.command).toBe("close-market");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: close-market");
    expect(parsed.helpText).toContain("--market [value]");
    expect(parsed.helpText).not.toContain("--seed-amount [value]");
  });

  it("keeps root help ownership with horizon.ts", () => {
    const parsed = parseHorizonArgs([
      "node",
      "horizon.ts",
      "--help"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toBeUndefined();
  });

  it("moves Horizon off the generic backend script parser registry", async () => {
    const [horizonSource, scriptArgsSource, horizonArgsSource] = await Promise.all([
      readBackSource("scripts/horizon.ts"),
      readBackSource("scripts/script-args.ts"),
      readBackSource("scripts/horizon-args.ts")
    ]);

    expect(horizonSource).toContain("./horizon-args");
    expect(horizonSource).not.toContain("parseCliArgs");
    expect(scriptArgsSource).not.toContain('"close-sweep"');
    expect(scriptArgsSource).not.toContain('"close-market"');
    expect(scriptArgsSource).not.toContain('"inspect-close"');
    expect(horizonArgsSource).toContain('from "commander"');
    expect(horizonArgsSource).toContain('from "zod"');
    expect(horizonArgsSource).not.toContain("as ParsedHorizonArgs");
  });
});
