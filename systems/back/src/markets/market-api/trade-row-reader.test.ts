import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../db/client/pool";
import { readAllHistoryTradeRows } from "./trade-row-reader";

function fakeQueryable(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  return { db: { query } as unknown as Queryable, query };
}

describe("readAllHistoryTradeRows", () => {
  it("issues no LIMIT and a single-arg query when called without options (backfill-base-candles usage)", async () => {
    const { db, query } = fakeQueryable([]);

    await readAllHistoryTradeRows(db, "some-market-key");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toMatch(/limit \$2/i);
    expect(values).toHaveLength(1);
  });

  it("pushes a SQL LIMIT and passes the cap as the second bound param when a limit is given", async () => {
    const { db, query } = fakeQueryable([]);

    await readAllHistoryTradeRows(db, "some-market-key", { limit: 20000 });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/limit \$2/i);
    expect(values).toEqual(expect.arrayContaining([20000]));
    expect(values).toHaveLength(2);
  });

  it("returns rows unchanged (row shape/count is the only truncation signal available to callers)", async () => {
    const rows = [{ trade_id: "1" }, { trade_id: "2" }];
    const { db } = fakeQueryable(rows);

    const result = await readAllHistoryTradeRows(db, "some-market-key", { limit: 2 });

    expect(result).toEqual(rows);
  });
});
