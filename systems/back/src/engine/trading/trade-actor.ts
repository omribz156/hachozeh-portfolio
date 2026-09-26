import type { RequestActor } from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { TradeServiceError } from "./trade-errors";

function readDemoActorId(env: AppEnv): string {
  if (!env.actorMode.demoEnabled) {
    throw new TradeServiceError(401, "unauthorized", "Demo actor mode is disabled.");
  }

  return env.actorMode.demoActorId;
}

export function resolveTradeActorId(
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId">
): string {
  return actor?.actorId ?? readDemoActorId(env);
}
