import { describe, expect, it, vi } from "vitest";

import {
  createMarketStreamBus,
  type MarketStreamResponse
} from "../../src/http/market-stream-bus";

function createResponse(): MarketStreamResponse {
  return {
    write: vi.fn(),
    writableEnded: false,
    once: vi.fn()
  } satisfies MarketStreamResponse;
}

describe("market stream bus", () => {
  it("broadcasts market events only to matching market streams", () => {
    const bus = createMarketStreamBus();
    const matchingResponse = createResponse();
    const otherResponse = createResponse();

    const closeMatching = bus.addConnection("next-prime-minister", matchingResponse);
    bus.addConnection("other-market", otherResponse);

    const delivered = bus.broadcast("next-prime-minister", "market.trade", {
      tradeId: "trade_1"
    });

    expect(delivered).toBe(1);
    expect(matchingResponse.write).toHaveBeenCalledWith("event: market.trade\n");
    expect(matchingResponse.write).toHaveBeenCalledWith('data: {"tradeId":"trade_1"}\n\n');
    expect(otherResponse.write).not.toHaveBeenCalled();

    closeMatching();

    expect(
      bus.broadcast("next-prime-minister", "market.trade", {
        tradeId: "trade_2"
      })
    ).toBe(0);
    expect(bus.getStats()).toEqual({
      markets: 1,
      connections: 1,
      maxConnections: 1000
    });
  });

  it("strips control characters from SSE framing fields", () => {
    const bus = createMarketStreamBus();
    const response = createResponse();

    bus.addConnection("next-prime-minister", response);
    bus.broadcast("next-prime-minister", "market.trade\nretry: 1", {
      eventId: "trade_1\nretry: 1",
      eventType: "trade"
    });

    expect(response.write).toHaveBeenCalledWith("id: trade_1retry: 1\n");
    expect(response.write).toHaveBeenCalledWith("event: market.traderetry: 1\n");
  });

  it("reports market stream capacity by market and frees capacity on close", () => {
    const bus = createMarketStreamBus({
      maxConnectionsPerMarket: 1,
      maxTotalConnections: 10
    });

    expect(bus.canAcceptConnection("next-prime-minister")).toBe(true);

    const close = bus.addConnection("next-prime-minister", createResponse());

    expect(bus.canAcceptConnection("next-prime-minister")).toBe(false);
    expect(bus.canAcceptConnection("other-market")).toBe(true);

    close();

    expect(bus.canAcceptConnection("next-prime-minister")).toBe(true);
  });

  it("reports market stream capacity across all markets", () => {
    const bus = createMarketStreamBus({
      maxConnectionsPerMarket: 10,
      maxTotalConnections: 1
    });

    bus.addConnection("next-prime-minister", createResponse());

    expect(bus.canAcceptConnection("next-prime-minister")).toBe(false);
    expect(bus.canAcceptConnection("other-market")).toBe(false);
  });
});
