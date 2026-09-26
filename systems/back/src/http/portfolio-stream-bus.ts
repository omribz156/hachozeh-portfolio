import { normalizeLimit } from "./stream-utils";
import type { MarketStreamResponse } from "./market-stream-bus";
import { writeServerSentEventFrame } from "./sse";

type CloseConnection = () => void;

export type PortfolioStreamBusOptions = {
  maxConnectionsPerActor?: number;
  maxTotalConnections?: number;
};

export type PortfolioStreamBus = {
  canAcceptConnection(actorId: string): boolean;
  addConnection(actorId: string, response: MarketStreamResponse): CloseConnection;
  broadcastActor(actorId: string, event: string, payload: unknown): number;
  broadcastAll(event: string, payload: unknown): number;
  closeAll(): number;
  getStats(): {
    actors: number;
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

function countConnections(connectionsByActor: Map<string, Set<MarketStreamResponse>>): number {
  let connections = 0;

  for (const [actorId, actorConnections] of connectionsByActor.entries()) {
    for (const response of actorConnections) {
      if (response.writableEnded) {
        actorConnections.delete(response);
      }
    }

    if (actorConnections.size === 0) {
      connectionsByActor.delete(actorId);
      continue;
    }

    connections += actorConnections.size;
  }

  return connections;
}

export function createPortfolioStreamBus(
  options: PortfolioStreamBusOptions = {}
): PortfolioStreamBus {
  const connectionsByActor = new Map<string, Set<MarketStreamResponse>>();
  const maxConnectionsPerActor = normalizeLimit(options.maxConnectionsPerActor, 10);
  const maxTotalConnections = normalizeLimit(options.maxTotalConnections, 1000);

  function broadcastConnections(
    connections: Set<MarketStreamResponse> | undefined,
    event: string,
    payload: unknown
  ): number {
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

    return delivered;
  }

  return {
    canAcceptConnection(actorId) {
      const totalConnections = countConnections(connectionsByActor);
      const actorConnections = connectionsByActor.get(actorId)?.size ?? 0;

      return actorConnections < maxConnectionsPerActor && totalConnections < maxTotalConnections;
    },
    addConnection(actorId, response) {
      const connections = connectionsByActor.get(actorId) ?? new Set<MarketStreamResponse>();

      connections.add(response);
      connectionsByActor.set(actorId, connections);

      const close = () => {
        connections.delete(response);

        if (connections.size === 0) {
          connectionsByActor.delete(actorId);
        }
      };

      response.once("close", close);

      return close;
    },
    broadcastActor(actorId, event, payload) {
      const connections = connectionsByActor.get(actorId);
      const delivered = broadcastConnections(connections, event, payload);

      if (connections?.size === 0) {
        connectionsByActor.delete(actorId);
      }

      return delivered;
    },
    broadcastAll(event, payload) {
      let delivered = 0;

      for (const [actorId, connections] of connectionsByActor.entries()) {
        delivered += broadcastConnections(connections, event, payload);

        if (connections.size === 0) {
          connectionsByActor.delete(actorId);
        }
      }

      return delivered;
    },
    closeAll() {
      // Snapshot + clear BEFORE ending so the per-connection "close" handlers (which mutate
      // these maps) don't fight the iteration. Used on shutdown to drain SSE so the HTTP
      // server can actually close instead of hanging until the grace timeout.
      const responses: MarketStreamResponse[] = [];
      for (const connections of connectionsByActor.values()) {
        for (const response of connections) {
          responses.push(response);
        }
      }
      connectionsByActor.clear();

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
      const connections = countConnections(connectionsByActor);

      return {
        actors: connectionsByActor.size,
        connections,
        maxConnections: maxTotalConnections
      };
    }
  };
}
