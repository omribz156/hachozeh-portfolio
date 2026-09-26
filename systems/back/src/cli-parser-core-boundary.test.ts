import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function readRepoSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "..", "..", relativePath), "utf8");
}

describe("CLI parser core ownership", () => {
  it("keeps command-index discovery in one shared helper", async () => {
    const [horizonSource, seerCreateSource, oracleSource, seerSource] = await Promise.all([
      readRepoSource("systems/back/src/scripts/horizon-args.ts"),
      readRepoSource("systems/back/src/scripts/seer-create-args.ts"),
      readRepoSource("systems/oracle/src/oracle-cli-commander.ts"),
      readRepoSource("systems/seer/src/main-args.ts")
    ]);

    for (const source of [horizonSource, seerCreateSource, oracleSource, seerSource]) {
      expect(source).toContain("findCommanderCommandIndex");
      expect(source).not.toContain("function findCommandIndex");
    }
  });

  it("exposes the shared CLI helper to plain Node consumers", () => {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        [
          "const { findCommanderCommandIndex } = require('@navi/cli/commander-argv');",
          "const index = findCommanderCommandIndex(['--json', 'alerts'], new Set(['--json']));",
          "process.stdout.write(String(index));"
        ].join(" ")
      ],
      {
        cwd: join(process.cwd(), "..", ".."),
        encoding: "utf8"
      }
    );

    expect(output).toBe("1");
  });
});
