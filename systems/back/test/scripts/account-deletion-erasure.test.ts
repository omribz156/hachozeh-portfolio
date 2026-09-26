import { describe, expect, it } from "vitest";

import { parseAccountDeletionErasureArgs } from "../../src/scripts/account-deletion-erasure";

describe("account deletion erasure CLI args", () => {
  it("defaults to a bounded dry-run sweep", () => {
    expect(parseAccountDeletionErasureArgs([])).toEqual({
      execute: false,
      json: false,
      limit: 50,
      requestId: null,
      actorId: "system:privacy-erasure",
      pending: false
    });
  });

  it("parses execute, request id, actor, json, limit, and pending", () => {
    expect(parseAccountDeletionErasureArgs([
      "--execute",
      "--json",
      "--request-id",
      "delete_1",
      "--actor-id=ops_1",
      "--limit=25"
    ])).toEqual({
      execute: true,
      json: true,
      limit: 25,
      requestId: "delete_1",
      actorId: "ops_1",
      pending: false
    });

    expect(parseAccountDeletionErasureArgs(["--pending", "--json"])).toEqual({
      execute: false,
      json: true,
      limit: 50,
      requestId: null,
      actorId: "system:privacy-erasure",
      pending: true
    });
  });

  it("caps limit to 500", () => {
    expect(parseAccountDeletionErasureArgs(["--limit=999"]).limit).toBe(500);
  });

  it("rejects pending with mutating or targeted flags", () => {
    expect(() => parseAccountDeletionErasureArgs(["--pending", "--execute"]))
      .toThrow("--pending is read-only");
    expect(() => parseAccountDeletionErasureArgs(["--pending", "--request-id=delete_1"]))
      .toThrow("--pending cannot be combined");
  });
});
