import type { AppEnv } from "../../config/env";
import type { RequestActor } from "../../auth/actor-resolver";

export type PortfolioActorMode = "demo" | "session";

function readDemoActorId(env: AppEnv): string {
  if (!env.actorMode.demoEnabled) {
    throw new Error("Demo actor mode is disabled.");
  }

  return env.actorMode.demoActorId;
}

export function resolvePortfolioActor(
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): { actorId: string; mode: PortfolioActorMode } {
  if (actor) {
    return {
      actorId: actor.actorId,
      mode: actor.mode
    };
  }

  return {
    actorId: readDemoActorId(env),
    mode: "demo"
  };
}
