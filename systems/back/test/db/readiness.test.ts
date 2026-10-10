import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../src/db/client/pool";
import { checkDatabaseReadiness } from "../../src/db/readiness";

afterEach(() => vi.useRealTimers());
describe("database readiness", () => {
  it("coalesces probes, caches briefly and uses a bounded real query", async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });
    const pool = { query } as unknown as Queryable;
    const first = checkDatabaseReadiness(pool);
    expect(checkDatabaseReadiness(pool)).toBe(first);
    expect(await first).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(query).toHaveBeenCalledWith({ text: "select 1", query_timeout: 5000 });
    expect(await checkDatabaseReadiness(pool)).toMatchObject({ ok: true });
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    await checkDatabaseReadiness(pool);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("does not expose connection errors or internal targets", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("private host/password/certificate detail")) } as unknown as Queryable;
    expect(await checkDatabaseReadiness(pool)).toEqual({ ok: false, latencyMs: expect.any(Number) });
  });
  it("bounds a hung pool and does not start duplicate pending work", async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockImplementation(() => new Promise(() => {}));
    const pool = { query } as unknown as Queryable;
    const result = checkDatabaseReadiness(pool);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(60000);
    expect(await checkDatabaseReadiness(pool)).toMatchObject({ ok: false });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
