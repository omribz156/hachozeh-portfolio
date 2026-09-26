import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "./auth/actor-resolver";
import { lockUserAccount, unlockUserAccount } from "./auth/user-ops-service";
import {
  reverseStarterGrant,
} from "./auth/starter-grant-reversal-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

const DB_POOL = {} as Pool;

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "src", relativePath), "utf8");
}

describe("admin user boundary Zod ownership", () => {
  it("keeps admin user mutation body parsing on the shared Zod boundary helper", async () => {
    const [userOpsSource, starterGrantSource, zodBoundarySource] = await Promise.all([
      readSource("auth/user-ops-service.ts"),
      readSource("auth/starter-grant-reversal-service.ts"),
      readSource("shared/zod-request-body.ts")
    ]);

    for (const source of [userOpsSource, starterGrantSource]) {
      expect(source).toContain("../shared/zod-request-body");
      expect(source).not.toContain("function isObjectRecord");
      expect(source).not.toContain("typeof value !== \"string\"");
    }

    expect(zodBoundarySource).toContain('from "zod"');
  });

  it("preserves user-ops boundary errors before database work", async () => {
    await expect(
      lockUserAccount(DB_POOL, "user_target_1", [], ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object."
    });

    await expect(
      lockUserAccount(DB_POOL, "user_target_1", {}, ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "reasonCode is required."
    });

    await expect(
      lockUserAccount(DB_POOL, "user_target_1", { reasonCode: 123 }, ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "reasonCode is required."
    });

    await expect(
      unlockUserAccount(DB_POOL, "user_target_1", "bad", ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object."
    });
  });

  it("preserves starter-grant reversal boundary errors before database work", async () => {
    await expect(
      reverseStarterGrant(DB_POOL, "user_target_1", null, ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object."
    });

    await expect(
      reverseStarterGrant(DB_POOL, "user_target_1", { reasonCode: " " }, ADMIN_ACTOR)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "reasonCode is required."
    });
  });
});
