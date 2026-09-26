import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSeerCreateArgs } from "./scripts/seer-create-args";

async function readBackSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("seer-create CLI args", () => {
  it("parses publish through the seer-create Commander boundary", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "publish",
      "--draft",
      "draft_123",
      "--seed-amount",
      "2500.5",
      "--market-environment",
      "test",
      "--allow-manual-resolution",
      "--json"
    ]);

    expect(parsed.command).toBe("publish");
    expect(parsed.jsonMode).toBe(true);
    expect(parsed.options).toEqual({
      all: false,
      allowManualResolution: true,
      draft: "draft_123",
      marketEnvironment: "test",
      seedAmount: "2500.5"
    });
  });

  it("parses materialize boolean options with Zod-backed errors", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "materialize",
      "--all",
      "--force",
      "true"
    ]);

    expect(parsed.command).toBe("materialize");
    expect(parsed.options).toEqual({
      all: true,
      draft: undefined,
      force: true,
      marketEnvironment: undefined,
      showGraph: false,
      showParentInDiscovery: undefined,
      showChildrenInDiscovery: undefined
    });

    expect(() =>
      parseSeerCreateArgs([
        "node",
        "seer-create.ts",
        "materialize",
        "--force",
        "maybe"
      ])
    ).toThrow("Flag --force must be true or false.");
  });

  it("parses materialize --show-graph into the event display flag", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "materialize",
      "--draft",
      "draft_123",
      "--show-graph"
    ]);

    expect(parsed.command).toBe("materialize");
    expect(parsed.options).toEqual({
      all: false,
      draft: "draft_123",
      force: false,
      marketEnvironment: undefined,
      showGraph: true,
      showParentInDiscovery: undefined,
      showChildrenInDiscovery: undefined
    });

    expect(() =>
      parseSeerCreateArgs([
        "node",
        "seer-create.ts",
        "materialize",
        "--show-graph",
        "maybe"
      ])
    ).toThrow("Flag --show-graph must be true or false.");
  });

  it("parses materialize discovery display flags", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "materialize",
      "--draft",
      "draft_123",
      "--show-parent-in-discovery",
      "true",
      "--show-children-in-discovery",
      "true"
    ]);

    expect(parsed.command).toBe("materialize");
    expect(parsed.options).toEqual({
      all: false,
      draft: "draft_123",
      force: false,
      marketEnvironment: undefined,
      showGraph: false,
      showParentInDiscovery: true,
      showChildrenInDiscovery: true
    });

    expect(() =>
      parseSeerCreateArgs([
        "node",
        "seer-create.ts",
        "materialize",
        "--show-children-in-discovery",
        "maybe"
      ])
    ).toThrow("Flag --show-children-in-discovery must be true or false.");
  });

  it("returns generated command help scoped to seer-create commands", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "publish",
      "--help"
    ]);

    expect(parsed.command).toBe("publish");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: publish");
    expect(parsed.helpText).toContain("--seed-amount [value]");
    expect(parsed.helpText).toContain("--market-environment [value]");
    expect(parsed.helpText).not.toContain("--market [value]");
    expect(parsed.helpText).not.toContain("--approved-by [value]");
  });

  it("rejects unsupported market environments", () => {
    expect(() =>
      parseSeerCreateArgs([
        "node",
        "seer-create.ts",
        "materialize",
        "--draft",
        "draft_123",
        "--market-environment",
        "sim"
      ])
    ).toThrow("Flag --market-environment must be prod or test.");
  });

  it("keeps root help ownership with seer-create.ts", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "--help"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toBeUndefined();
  });

  it("keeps missing command distinct from unknown command", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.unknownCommand).toBeUndefined();
    expect(parsed.helpRequested).toBe(false);
  });

  it("reports unknown commands before file or database work", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "not-a-command"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.unknownCommand).toBe("not-a-command");
    expect(parsed.helpRequested).toBe(false);
  });

  it("does not turn unknown command help into root help", () => {
    const parsed = parseSeerCreateArgs([
      "node",
      "seer-create.ts",
      "not-a-command",
      "--help"
    ]);

    expect(parsed.command).toBeUndefined();
    expect(parsed.unknownCommand).toBe("not-a-command");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toBeUndefined();
  });

  it("removes the old generic backend command parser core", async () => {
    const [seerCreateSource, scriptArgsSource, seerCreateArgsSource] = await Promise.all([
      readBackSource("scripts/seer-create.ts"),
      readBackSource("scripts/script-args.ts"),
      readBackSource("scripts/seer-create-args.ts")
    ]);

    expect(seerCreateSource).toContain("./seer-create-args");
    expect(seerCreateSource).not.toContain("parseCliArgs");
    expect(scriptArgsSource).not.toContain("parseCliArgs");
    expect(scriptArgsSource).not.toContain("BACKEND_SCRIPT_COMMAND_OPTIONS");
    expect(scriptArgsSource).not.toContain("findCommanderCommandIndex");
    expect(seerCreateArgsSource).toContain('from "commander"');
    expect(seerCreateArgsSource).toContain('from "zod"');
    expect(seerCreateArgsSource).not.toContain("as ParsedSeerCreateArgs");
  });
});
