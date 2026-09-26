import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { createStreamConnectionLimiter } from "./stream-connection-limiter";

function makeRequest(ip: string): IncomingMessage {
  return {
    socket: { remoteAddress: ip },
    headers: {}
  } as unknown as IncomingMessage;
}

describe("stream connection limiter", () => {
  it("limits open streams per client IP and releases on close", () => {
    const limiter = createStreamConnectionLimiter({
      maxConnectionsPerIp: 1,
      maxTotalConnections: 10
    });
    const request = makeRequest("203.0.113.10");

    expect(limiter.canAcceptConnection(request)).toBe(true);
    const close = limiter.addConnection(request);

    expect(limiter.canAcceptConnection(makeRequest("203.0.113.10"))).toBe(false);
    expect(limiter.canAcceptConnection(makeRequest("203.0.113.11"))).toBe(true);
    expect(limiter.getStats()).toEqual({
      clients: 1,
      connections: 1
    });

    close();

    expect(limiter.canAcceptConnection(request)).toBe(true);
    expect(limiter.getStats()).toEqual({
      clients: 0,
      connections: 0
    });
  });

  it("limits total open streams across clients", () => {
    const limiter = createStreamConnectionLimiter({
      maxConnectionsPerIp: 10,
      maxTotalConnections: 1
    });

    limiter.addConnection(makeRequest("203.0.113.20"));

    expect(limiter.canAcceptConnection(makeRequest("203.0.113.21"))).toBe(false);
  });
});
