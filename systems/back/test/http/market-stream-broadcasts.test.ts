import { describe, expect, it, vi } from "vitest";

import {
  broadcastMarketCommentEvent,
  broadcastMarketTradeEvent
} from "../../src/http/market-stream-broadcasts";
import { createMarketStreamBus, type MarketStreamResponse } from "../../src/http/market-stream-bus";
import type { Logger } from "../../src/shared/logger";

const readMarketTradesMock = vi.fn();
vi.mock("../../src/markets/market-api-read-service", () => ({
  readMarketTrades: (...args: unknown[]) => readMarketTradesMock(...args),
  readMarketPrices: vi.fn(async () => null) // snapshot returns early → no extra broadcast
}));

function createResponse(): MarketStreamResponse {
  return {
    write: vi.fn(),
    writableEnded: false,
    once: vi.fn()
  } satisfies MarketStreamResponse;
}

function writtenData(response: MarketStreamResponse): string[] {
  return (response.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("market stream broadcasts", () => {
  it("broadcasts comment events over the existing market stream bus", () => {
    const bus = createMarketStreamBus();
    const response = createResponse();

    bus.addConnection("next-prime-minister", response);

    broadcastMarketCommentEvent({
      dbPool: {} as never,
      requestLogger: {} as Logger,
      marketStreamBus: bus,
      marketKey: "next-prime-minister",
      eventType: "comment.new",
      comment: {
        id: "comment_1",
        body: "בדיקה"
      }
    });

    expect(response.write).toHaveBeenCalledWith("event: comment.new\n");
    expect(String((response.write as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])).toContain(
      '"comment":{"id":"comment_1","body":"בדיקה"}'
    );
  });

  it("enriches the trade push with the renderable row matched by tradeId", async () => {
    readMarketTradesMock.mockResolvedValueOnce({
      trades: [
        { tradeId: "trade_other", side: "sell", outcomeLabel: "לא" },
        { tradeId: "trade_1", side: "buy", outcomeLabel: "כן", shareAmount: "5", avgPrice: "0.62" }
      ]
    });
    const bus = createMarketStreamBus();
    const response = createResponse();
    bus.addConnection("next-prime-minister", response);

    broadcastMarketTradeEvent({
      dbPool: {} as never,
      requestLogger: { warn: vi.fn() } as unknown as Logger,
      marketStreamBus: bus,
      trade: { marketKey: "next-prime-minister", tradeId: "trade_1" }
    });

    await flushMicrotasks();

    const data = writtenData(response);
    expect(data.some((line) => line.startsWith("event: market.trade"))).toBe(true);
    const tradeData = data.find((line) => line.includes('"eventType":"trade"'));
    expect(tradeData).toBeTruthy();
    // the row for the just-made trade is embedded (matched by id, not just "latest")
    expect(tradeData).toContain('"row":{');
    expect(tradeData).toContain('"tradeId":"trade_1"');
    expect(tradeData).toContain('"outcomeLabel":"כן"');
  });

  it("still broadcasts the trade (row=null) when the row lookup fails", async () => {
    readMarketTradesMock.mockRejectedValueOnce(new Error("db down"));
    const bus = createMarketStreamBus();
    const response = createResponse();
    const warn = vi.fn();
    bus.addConnection("next-prime-minister", response);

    broadcastMarketTradeEvent({
      dbPool: {} as never,
      requestLogger: { warn } as unknown as Logger,
      marketStreamBus: bus,
      trade: { marketKey: "next-prime-minister", tradeId: "trade_2" }
    });

    await flushMicrotasks();

    const data = writtenData(response);
    const tradeData = data.find((line) => line.includes('"eventType":"trade"'));
    expect(tradeData).toBeTruthy();
    expect(tradeData).toContain('"row":null');
    expect(tradeData).toContain('"tradeId":"trade_2"');
    expect(warn).toHaveBeenCalled();
  });
});
