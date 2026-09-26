import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { revokeOtherCurrentUserSessions } from "./auth/current-user-session-revoke-service";

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

const DB_POOL = {} as Pool;

describe("current user session boundary Zod ownership", () => {
  it("keeps current-user session mutation body parsing on the shared Zod boundary helper", async () => {
    const [serviceSource, zodBoundarySource] = await Promise.all([
      readSource("auth/current-user-session-revoke-service.ts"),
      readSource("shared/zod-request-body.ts")
    ]);

    expect(serviceSource).toContain("../shared/zod-request-body");
    expect(serviceSource).not.toContain("function isObjectRecord");
    expect(serviceSource).not.toContain("typeof value === \"object\"");
    expect(zodBoundarySource).toContain('from "zod"');
  });

  it("preserves current-user session mutation boundary errors before database work", async () => {
    await expect(
      revokeOtherCurrentUserSessions(DB_POOL, "user_1", "session_1", [])
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object."
    });

    await expect(
      revokeOtherCurrentUserSessions(DB_POOL, "user_1", "session_1", "bad")
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object."
    });
  });
});
