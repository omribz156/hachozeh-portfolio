import { describe, expect, it } from "vitest";

import { createDiscoveryStreamLimiter } from "./discovery-stream-limiter";

describe("discovery stream limiter", () => {
  it("reports discovery stream capacity by feed and frees capacity on close", () => {
    const limiter = createDiscoveryStreamLimiter({
      maxConnectionsPerFeed: 1,
      maxTotalConnections: 10
    });

    expect(limiter.canAcceptConnection("breaking:all")).toBe(true);

    const close = limiter.addConnection("breaking:all");

    expect(limiter.canAcceptConnection("breaking:all")).toBe(false);
    expect(limiter.canAcceptConnection("trending:all")).toBe(true);

    close();

    expect(limiter.canAcceptConnection("breaking:all")).toBe(true);
    expect(limiter.getStats()).toEqual({
      feeds: 0,
      connections: 0
    });
  });

  it("reports discovery stream capacity across all feeds", () => {
    const limiter = createDiscoveryStreamLimiter({
      maxConnectionsPerFeed: 10,
      maxTotalConnections: 1
    });

    limiter.addConnection("breaking:all");

    expect(limiter.canAcceptConnection("breaking:all")).toBe(false);
    expect(limiter.canAcceptConnection("trending:all")).toBe(false);
  });
});
