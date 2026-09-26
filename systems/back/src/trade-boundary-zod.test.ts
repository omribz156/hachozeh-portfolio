import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("trade boundary Zod ownership", () => {
  it("keeps quote and trade write body parsing on Zod instead of shared manual readers", async () => {
    const [quoteSource, tradeSource, zodBoundarySource] = await Promise.all([
      readSource("engine/pricing/quote-service.ts"),
      readSource("engine/trading/trade-request.ts"),
      readSource("shared/zod-request-body.ts")
    ]);

    for (const source of [quoteSource, tradeSource]) {
      expect(source).toContain("../../shared/zod-request-body");
      expect(source).not.toContain("../../shared/request-body");
    }

    expect(zodBoundarySource).toContain('from "zod"');
  });
});
