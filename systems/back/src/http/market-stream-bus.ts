import { normalizeLimit } from "./stream-utils";
import { writeServerSentEventFrame } from "./sse";

export type MarketStreamResponse = {
  write(chunk: string): boolean;
  readonly writableEnded: boolean;
  once(event: "close", listener: () => void): unknown;
  end(): void;
};

type CloseConnection = () => void;

export type MarketStreamBusOptions = {
  maxConnectionsPerMarket?: number;
  maxTotalConnections?: number;
};

export type MarketStreamBus = {
  canAcceptConnection(marketKey: string): boolean;
  addConnection(marketKey: string, response: MarketStreamResponse): CloseConnection;
  broadcast(marketKey: string, event: string, payload: unknown): number;
  closeAll(): number;
  getStats(): {
    markets: number;
    connections: number;
    maxConnections: number;
  };
};

function writeServerSentEvent(
  response: MarketStreamResponse,
  event: string,
  payload: unknown
): void {
  writeServerSentEventFrame(response, event, payload);
}

function countConnections(connectionsByMarket: Map<string, Set<MarketStreamResponse>>): number {
  let connections = 0;

  for (const [marketKey, marketConnections] of connectionsByMarket.entries()) {
    for (const response of marketConnections) {
      if (response.writableEnded) {
        marketConnections.delete(response);
      }
    }

    if (marketConnections.size === 0) {
      connectionsByMarket.delete(marketKey);
      continue;
    }

    connections += marketConnections.size;
  }

  return connections;
}

export function createMarketStreamBus(options: MarketStreamBusOptions = {}): MarketStreamBus {
  const connectionsByMarket = new Map<string, Set<MarketStreamResponse>>();
  const maxConnectionsPerMarket = normalizeLimit(options.maxConnectionsPerMarket, 50);
  const maxTotalConnections = normalizeLimit(options.maxTotalConnections, 1000);

  return {
    canAcceptConnection(marketKey) {
      const totalConnections = countConnections(connectionsByMarket);
      const marketConnections = connectionsByMarket.get(marketKey)?.size ?? 0;

      return marketConnections < maxConnectionsPerMarket && totalConnections < maxTotalConnections;
    },
    addConnection(marketKey, response) {
      const connections = connectionsByMarket.get(marketKey) ?? new Set<MarketStreamResponse>();

      connections.add(response);
      connectionsByMarket.set(marketKey, connections);

      const close = () => {
        connections.delete(response);

        if (connections.size === 0) {
          connectionsByMarket.delete(marketKey);
        }
      };

      response.once("close", close);

      return close;
    },
    broadcast(marketKey, event, payload) {
      const connections = connectionsByMarket.get(marketKey);

      if (!connections) {
        return 0;
      }

      let delivered = 0;

      for (const response of connections) {
        if (response.writableEnded) {
          connections.delete(response);
          continue;
        }

        writeServerSentEvent(response, event, payload);
        delivered += 1;
      }

      if (connections.size === 0) {
        connectionsByMarket.delete(marketKey);
      }

      return delivered;
    },
    closeAll() {
      // Snapshot + clear BEFORE ending so the per-connection "close" handlers (which mutate
      // these maps) don't fight the iteration. Used on shutdown to drain SSE so the HTTP
      // server can actually close instead of hanging until the grace timeout.
      const responses: MarketStreamResponse[] = [];
      for (const connections of connectionsByMarket.values()) {
        for (const response of connections) {
          responses.push(response);
        }
      }
      connectionsByMarket.clear();

      let closed = 0;
      for (const response of responses) {
        if (!response.writableEnded) {
          response.end();
          closed += 1;
        }
      }
      return closed;
    },
    getStats() {
      const connections = countConnections(connectionsByMarket);

      return {
        markets: connectionsByMarket.size,
        connections,
        maxConnections: maxTotalConnections
      };
    }
  };
}
