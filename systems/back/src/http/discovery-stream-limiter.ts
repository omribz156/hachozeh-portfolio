import { normalizeLimit } from "./stream-utils";

type CloseConnection = () => void;

export type DiscoveryStreamLimiterOptions = {
  maxConnectionsPerFeed?: number;
  maxTotalConnections?: number;
};

export type DiscoveryStreamLimiter = {
  canAcceptConnection(feedKey: string): boolean;
  addConnection(feedKey: string): CloseConnection;
  getStats(): {
    feeds: number;
    connections: number;
  };
};

export function createDiscoveryStreamLimiter(
  options: DiscoveryStreamLimiterOptions = {}
): DiscoveryStreamLimiter {
  const connectionsByFeed = new Map<string, number>();
  const maxConnectionsPerFeed = normalizeLimit(options.maxConnectionsPerFeed, 100);
  const maxTotalConnections = normalizeLimit(options.maxTotalConnections, 1000);

  function countConnections(): number {
    let connections = 0;

    for (const feedConnections of connectionsByFeed.values()) {
      connections += feedConnections;
    }

    return connections;
  }

  return {
    canAcceptConnection(feedKey) {
      const feedConnections = connectionsByFeed.get(feedKey) ?? 0;

      return feedConnections < maxConnectionsPerFeed && countConnections() < maxTotalConnections;
    },
    addConnection(feedKey) {
      connectionsByFeed.set(feedKey, (connectionsByFeed.get(feedKey) ?? 0) + 1);

      let closed = false;

      return () => {
        if (closed) {
          return;
        }

        closed = true;

        const remainingConnections = (connectionsByFeed.get(feedKey) ?? 1) - 1;

        if (remainingConnections <= 0) {
          connectionsByFeed.delete(feedKey);
          return;
        }

        connectionsByFeed.set(feedKey, remainingConnections);
      };
    },
    getStats() {
      return {
        feeds: connectionsByFeed.size,
        connections: countConnections()
      };
    }
  };
}
