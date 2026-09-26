import { describe, expect, it, vi } from "vitest";

import { withSavepoint } from "../../src/shared/transaction-savepoint";

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  calls: string[];
};

function createMockClient(): MockClient {
  const calls: string[] = [];

  return {
    calls,
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    })
  };
}

describe("transaction savepoint helper", () => {
  it("releases the savepoint after successful callback work", async () => {
    const client = createMockClient();

    const result = await withSavepoint(client, "signup_welcome", async () => 123);

    expect(result).toEqual({ success: true, value: 123 });
    expect(client.calls).toEqual([
      "savepoint signup_welcome",
      "release savepoint signup_welcome"
    ]);
  });

  it("returns failure result and rolls back before release on callback error", async () => {
    const client = createMockClient();

    const result = await withSavepoint(client, "faucet_streak_milestone", async () => {
      throw new Error("notification failed");
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
    }
    expect(client.calls).toEqual([
      "savepoint faucet_streak_milestone",
      "rollback to savepoint faucet_streak_milestone",
      "release savepoint faucet_streak_milestone"
    ]);
  });

  it("rejects invalid savepoint names", async () => {
    const client = createMockClient();

    await expect(
      withSavepoint(client, "bad-name", async () => "noop")
    ).rejects.toThrow("Invalid savepoint name");

    expect(client.calls).toHaveLength(0);
  });
});
