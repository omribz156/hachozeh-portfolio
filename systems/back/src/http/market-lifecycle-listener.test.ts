import { describe, expect, it, vi, beforeEach } from "vitest";

// broadcastMarketLifecycleEvent re-reads prices for the snapshot push; stub the read layer
// so the dispatch fan-out is testable without a database.
vi.mock("../markets/market-api-read-service", () => ({
  readMarketPrices: vi.fn(async () => null),
  readMarketTrades: vi.fn(async () => null)
}));

import {
  dispatchMarketLifecycle,
  parseMarketLifecycleNotice
} from "./market-lifecycle-listener";
import type { MarketStreamBus } from "./market-stream-bus";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger)
  };
  return logger;
}

function makeDeps(
  readAffectedUserIds?: (dbPool: unknown, marketId: string, status: string) => Promise<string[]>
) {
  const marketBroadcast = vi.fn((_marketKey: string, _eventName: string, _payload: unknown) => {});
  const portfolioBroadcastActor = vi.fn(
    (_actorId: string, _eventType: string, _payload: Record<string, unknown>) => 1
  );
  const portfolioBroadcastAll = vi.fn((_eventType: string, _payload: unknown) => 0);
  return {
    marketBroadcast,
    portfolioBroadcastActor,
    portfolioBroadcastAll,
    deps: {
      dbPool: {} as never,
      marketStreamBus: { broadcast: marketBroadcast } as unknown as MarketStreamBus,
      portfolioStreamBus: {
        broadcastActor: portfolioBroadcastActor,
        broadcastAll: portfolioBroadcastAll
      } as unknown as PortfolioStreamBus,
      logger: makeLogger() as never,
      readAffectedUserIds: readAffectedUserIds as never
    }
  };
}

describe("parseMarketLifecycleNotice", () => {
  it("accepts a closed transition", () => {
    expect(parseMarketLifecycleNotice('{"marketId":"m1","status":"closed"}')).toEqual({
      marketId: "m1",
      status: "closed"
    });
  });

  it("accepts a resolved transition", () => {
    expect(parseMarketLifecycleNotice('{"marketId":"m1","status":"resolved"}')).toEqual({
      marketId: "m1",
      status: "resolved"
    });
  });

  it("accepts a voided transition", () => {
    expect(parseMarketLifecycleNotice('{"marketId":"m1","status":"voided"}')).toEqual({
      marketId: "m1",
      status: "voided"
    });
  });

  it("rejects malformed json, missing id, and non-lifecycle statuses", () => {
    expect(parseMarketLifecycleNotice(undefined)).toBeNull();
    expect(parseMarketLifecycleNotice("not json")).toBeNull();
    expect(parseMarketLifecycleNotice('{"status":"resolved"}')).toBeNull();
    expect(parseMarketLifecycleNotice('{"marketId":"m1","status":"open"}')).toBeNull();
    expect(parseMarketLifecycleNotice('{"marketId":"m1","status":"draft"}')).toBeNull();
  });
});

describe("dispatchMarketLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("close: broadcasts the market lifecycle flip and touches NO portfolio", async () => {
    const readAffected = vi.fn(async () => ["user_1"]);
    const { deps, marketBroadcast, portfolioBroadcastActor } = makeDeps(readAffected);

    await dispatchMarketLifecycle({ marketId: "m1", status: "closed" }, deps);

    const lifecycleCall = marketBroadcast.mock.calls.find((c) => c[1] === "market.lifecycle");
    expect(lifecycleCall?.[0]).toBe("m1"); // unknown id falls back to itself as the bus key
    expect(lifecycleCall?.[2]).toMatchObject({ action: "closed" });
    expect(portfolioBroadcastActor).not.toHaveBeenCalled();
    expect(readAffected).not.toHaveBeenCalled();
  });

  it("resolved: flips the market AND pushes each settled holder's portfolio", async () => {
    const readAffected = vi.fn(async () => ["user_1", "user_2"]);
    const { deps, marketBroadcast, portfolioBroadcastActor } = makeDeps(readAffected);

    await dispatchMarketLifecycle({ marketId: "m1", status: "resolved" }, deps);

    expect(marketBroadcast.mock.calls.some((c) => c[1] === "market.lifecycle")).toBe(true);
    expect(readAffected).toHaveBeenCalledWith(deps.dbPool, "m1", "resolved");
    expect(portfolioBroadcastActor).toHaveBeenCalledTimes(2);
    const pushedActors = portfolioBroadcastActor.mock.calls.map((c) => c[0]);
    expect(pushedActors).toEqual(["user_1", "user_2"]);
    expect(
      portfolioBroadcastActor.mock.calls.every((c) => c[1] === "portfolio.snapshot_invalidated")
    ).toBe(true);
    // resolved → reason 'settlement'
    expect(portfolioBroadcastActor.mock.calls.every((c) => c[2]?.reason === "settlement")).toBe(true);
  });

  it("voided: flips the market AND pushes each refunded holder's portfolio with reason 'void'", async () => {
    const readAffected = vi.fn(async () => ["user_9"]);
    const { deps, marketBroadcast, portfolioBroadcastActor } = makeDeps(readAffected);

    await dispatchMarketLifecycle({ marketId: "m1", status: "voided" }, deps);

    expect(marketBroadcast.mock.calls.some((c) => c[1] === "market.lifecycle")).toBe(true);
    expect(readAffected).toHaveBeenCalledWith(deps.dbPool, "m1", "voided");
    expect(portfolioBroadcastActor).toHaveBeenCalledTimes(1);
    expect(portfolioBroadcastActor.mock.calls[0][0]).toBe("user_9");
    expect(portfolioBroadcastActor.mock.calls[0][2]?.reason).toBe("void");
  });

  it("settling status with no holders: still flips the market, no portfolio pushes", async () => {
    const readAffected = vi.fn(async () => []);
    const { deps, marketBroadcast, portfolioBroadcastActor } = makeDeps(readAffected);

    await dispatchMarketLifecycle({ marketId: "m1", status: "resolved" }, deps);

    expect(marketBroadcast.mock.calls.some((c) => c[1] === "market.lifecycle")).toBe(true);
    expect(portfolioBroadcastActor).not.toHaveBeenCalled();
  });

  it("a holders-read failure does not throw and skips portfolio pushes", async () => {
    const readAffected = vi.fn(async () => {
      throw new Error("db down");
    });
    const { deps, marketBroadcast, portfolioBroadcastActor } = makeDeps(readAffected);

    await expect(
      dispatchMarketLifecycle({ marketId: "m1", status: "voided" }, deps)
    ).resolves.toBeUndefined();

    expect(marketBroadcast.mock.calls.some((c) => c[1] === "market.lifecycle")).toBe(true);
    expect(portfolioBroadcastActor).not.toHaveBeenCalled();
  });
});
