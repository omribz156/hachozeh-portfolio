import type { IncomingMessage } from "node:http";

import { normalizeLimit } from "./stream-utils";

import { resolveClientIp } from "./client-ip";

type CloseConnection = () => void;

export type StreamConnectionLimiterOptions = {
  maxConnectionsPerIp?: number;
  maxTotalConnections?: number;
};

export type StreamConnectionLimiter = {
  canAcceptConnection(request: IncomingMessage): boolean;
  addConnection(request: IncomingMessage): CloseConnection;
  getStats(): {
    clients: number;
    connections: number;
  };
};

export function createStreamConnectionLimiter(
  options: StreamConnectionLimiterOptions = {}
): StreamConnectionLimiter {
  const connectionsByIp = new Map<string, number>();
  const maxConnectionsPerIp = normalizeLimit(options.maxConnectionsPerIp, 20);
  const maxTotalConnections = normalizeLimit(options.maxTotalConnections, 2_000);

  function countConnections(): number {
    let connections = 0;

    for (const clientConnections of connectionsByIp.values()) {
      connections += clientConnections;
    }

    return connections;
  }

  return {
    canAcceptConnection(request) {
      const clientIp = resolveClientIp(request);
      const clientConnections = connectionsByIp.get(clientIp) ?? 0;

      return clientConnections < maxConnectionsPerIp && countConnections() < maxTotalConnections;
    },
    addConnection(request) {
      const clientIp = resolveClientIp(request);
      connectionsByIp.set(clientIp, (connectionsByIp.get(clientIp) ?? 0) + 1);

      let closed = false;

      return () => {
        if (closed) {
          return;
        }

        closed = true;

        const remainingConnections = (connectionsByIp.get(clientIp) ?? 1) - 1;

        if (remainingConnections <= 0) {
          connectionsByIp.delete(clientIp);
          return;
        }

        connectionsByIp.set(clientIp, remainingConnections);
      };
    },
    getStats() {
      return {
        clients: connectionsByIp.size,
        connections: countConnections()
      };
    }
  };
}
