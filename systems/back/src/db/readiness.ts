import { Socket } from "node:net";

import type { AppEnv } from "../config/env";

export type DbReadiness = {
  ok: boolean;
  latencyMs: number;
  target: string;
  error?: string;
};

export async function checkDatabaseReadiness(
  config: AppEnv["db"]
): Promise<DbReadiness> {
  const startedAt = Date.now();
  const target = `${config.host}:${config.port}`;

  return new Promise<DbReadiness>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: DbReadiness) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(config.connectTimeoutMs);

    socket.once("connect", () => {
      finish({
        ok: true,
        latencyMs: Date.now() - startedAt,
        target
      });
    });

    socket.once("timeout", () => {
      finish({
        ok: false,
        latencyMs: Date.now() - startedAt,
        target,
        error: "timeout"
      });
    });

    socket.once("error", (error) => {
      finish({
        ok: false,
        latencyMs: Date.now() - startedAt,
        target,
        error: error.message
      });
    });

    socket.connect(config.port, config.host);
  });
}
