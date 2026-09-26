import { describe, expect, it } from "vitest";

import { createPortfolioStreamBus } from "./portfolio-stream-bus";
import type { MarketStreamResponse } from "./market-stream-bus";

class FakeStreamResponse implements MarketStreamResponse {
  chunks: string[] = [];
  writableEnded = false;
  private closeListener: (() => void) | null = null;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  once(event: "close", listener: () => void): unknown {
    if (event === "close") {
      this.closeListener = listener;
    }
    return this;
  }

  close(): void {
    this.writableEnded = true;
    this.closeListener?.();
  }

  end(): void {
    // Mirror a real ServerResponse.end() → the socket "close" fires, draining the bus.
    this.close();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("portfolio stream bus", () => {
  it("broadcasts private portfolio invalidations to the requested actor only", () => {
    const bus = createPortfolioStreamBus();
    const actorOne = new FakeStreamResponse();
    const actorTwo = new FakeStreamResponse();

    bus.addConnection("user_1", actorOne);
    bus.addConnection("user_2", actorTwo);

    const delivered = bus.broadcastActor("user_1", "portfolio.snapshot_invalidated", {
      eventId: "portfolio:trade:1",
      eventType: "portfolio.snapshot_invalidated",
      reason: "trade"
    });

    expect(delivered).toBe(1);
    expect(actorOne.text()).toContain("id: portfolio:trade:1");
    expect(actorOne.text()).toContain("event: portfolio.snapshot_invalidated");
    expect(actorOne.text()).toContain('"reason":"trade"');
    expect(actorTwo.text()).toBe("");
  });

  it("closeAll ends every open connection and empties the bus (graceful shutdown drain)", () => {
    const bus = createPortfolioStreamBus();
    const actorOne = new FakeStreamResponse();
    const actorTwo = new FakeStreamResponse();

    bus.addConnection("user_1", actorOne);
    bus.addConnection("user_2", actorTwo);
    expect(bus.getStats().connections).toBe(2);

    const closed = bus.closeAll();

    expect(closed).toBe(2);
    expect(actorOne.writableEnded).toBe(true);
    expect(actorTwo.writableEnded).toBe(true);
    expect(bus.getStats().connections).toBe(0);
    expect(bus.getStats().actors).toBe(0);
    // idempotent: a second pass ends nothing
    expect(bus.closeAll()).toBe(0);
  });

  it("can broadcast generic settlement invalidations to every connected actor", () => {
    const bus = createPortfolioStreamBus();
    const actorOne = new FakeStreamResponse();
    const actorTwo = new FakeStreamResponse();

    bus.addConnection("user_1", actorOne);
    bus.addConnection("user_2", actorTwo);

    const delivered = bus.broadcastAll("portfolio.snapshot_invalidated", {
      eventId: "portfolio:settlement:1",
      eventType: "portfolio.snapshot_invalidated",
      reason: "settlement"
    });

    expect(delivered).toBe(2);
    expect(actorOne.text()).toContain('"reason":"settlement"');
    expect(actorTwo.text()).toContain('"reason":"settlement"');
  });

  it("strips control characters from SSE framing fields", () => {
    const bus = createPortfolioStreamBus();
    const actorOne = new FakeStreamResponse();

    bus.addConnection("user_1", actorOne);
    bus.broadcastActor("user_1", "portfolio.snapshot_invalidated\nretry: 1", {
      eventId: "portfolio:trade:1\nretry: 1",
      eventType: "portfolio.snapshot_invalidated",
      reason: "trade"
    });

    expect(actorOne.text()).toContain("id: portfolio:trade:1retry: 1\n");
    expect(actorOne.text()).toContain("event: portfolio.snapshot_invalidatedretry: 1\n");
  });

  it("reports portfolio stream capacity by actor and frees capacity on close", () => {
    const bus = createPortfolioStreamBus({
      maxConnectionsPerActor: 1,
      maxTotalConnections: 10
    });
    const response = new FakeStreamResponse();

    expect(bus.canAcceptConnection("user_1")).toBe(true);

    bus.addConnection("user_1", response);

    expect(bus.canAcceptConnection("user_1")).toBe(false);
    expect(bus.canAcceptConnection("user_2")).toBe(true);

    response.close();

    expect(bus.canAcceptConnection("user_1")).toBe(true);
  });

  it("reports portfolio stream capacity across all actors", () => {
    const bus = createPortfolioStreamBus({
      maxConnectionsPerActor: 10,
      maxTotalConnections: 1
    });

    bus.addConnection("user_1", new FakeStreamResponse());

    expect(bus.canAcceptConnection("user_1")).toBe(false);
    expect(bus.canAcceptConnection("user_2")).toBe(false);
  });
});
