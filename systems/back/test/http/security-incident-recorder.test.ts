import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../src/db/client/pool";
import { createSecurityIncidentRecorder } from "../../src/observability/security-incident-recorder";

afterEach(() => vi.restoreAllMocks());
const signal = { source: "web" as const, kind: "burst" as const, requests: 101, rejected: 100, windowSeconds: 60 };

describe("durable security summaries", () => {
  it("bounds writes while preserving alert delivery and recovery", async () => {
    let now = 0;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const send = vi.fn().mockResolvedValue(true);
    const record = createSecurityIncidentRecorder({ query } as unknown as Queryable, send, () => now);
    for (let i = 0; i < 100; i++) await record(signal);
    expect(query).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(100);
    await record({ ...signal, kind: "recovery" });
    expect(query).toHaveBeenCalledTimes(2);
    now = 600_000;
    await record(signal);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("retains an allowlisted summary even when Telegram fails", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const record = createSecurityIncidentRecorder({ query } as unknown as Queryable, async () => false);
    expect(await record({ ...signal, cookie: "private-cookie" } as typeof signal)).toBe(false);
    const values = query.mock.calls[0]?.[1];
    expect(values?.[2]).toBe("security.traffic.signal");
    expect(JSON.parse(values?.[5])).toMatchObject({ requests: 101, rejected: 100, source: "web", kind: "burst" });
    expect(JSON.stringify(values)).not.toContain("private-cookie");
  });
  it("still delivers when database persistence fails, without logging raw errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi.fn().mockRejectedValue(new Error("private-db-connection"));
    const send = vi.fn().mockResolvedValue(true);
    const record = createSecurityIncidentRecorder({ query } as unknown as Queryable, send);
    expect(await record(signal)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-db-connection");
  });
});
