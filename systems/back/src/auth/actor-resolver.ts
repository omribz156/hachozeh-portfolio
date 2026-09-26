import type { IncomingMessage } from "node:http";

import type { Queryable } from "../db/client/pool";
import type { AppEnv } from "../config/env";
import { buildClearedSessionCookie, readCookie } from "./session-cookie";
import { hashValue } from "./session/hashing";
import { shouldTouchSessionActivity, touchSessionActivity } from "./session/session-records";
import { recordActiveDay } from "../analytics/retention-events-service";

export type RequestActor = {
  actorId: string;
  mode: "demo" | "session";
  sessionId: string | null;
  role: "user" | "admin";
};

type ActiveSessionRow = {
  session_id: string;
  user_id: string;
  session_status: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_status: string;
  user_role: "user" | "admin";
};

export class ActorResolutionError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly setCookie: string | null;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: {
      setCookie?: string | null;
    }
  ) {
    super(message);
    this.name = "ActorResolutionError";
    this.statusCode = statusCode;
    this.code = code;
    this.setCookie = options?.setCookie ?? null;
  }
}

async function readActiveSessionByToken(
  db: Queryable,
  token: string
): Promise<ActiveSessionRow | null> {
  const result = await db.query<ActiveSessionRow>(
    `
      select
        s.id as session_id,
        s.user_id,
        s.status as session_status,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        u.status as user_status,
        u.role as user_role
      from sessions s
      join users u
        on u.id = s.user_id
      where s.token_hash = $1
      limit 1
    `,
    [hashValue(token)]
  );

  return result.rows[0] ?? null;
}

export async function resolveRequestActor(
  db: Queryable,
  env: AppEnv,
  request: IncomingMessage,
  options?: {
    allowDemo?: boolean;
    requiredRole?: "admin";
  }
): Promise<RequestActor> {
  const sessionToken = readCookie(request, env.auth.sessionCookieName);
  // DEMO_ACTOR_MODE_ENABLED is the master switch: a route-level allowDemo can
  // narrow it but never widen it. Without this AND, handlers that pass an
  // explicit allowDemo bypass the env kill switch entirely.
  const allowDemo = (options?.allowDemo ?? true) && env.actorMode.demoEnabled;

  if (!sessionToken) {
    if (!allowDemo) {
      throw new ActorResolutionError(401, "unauthorized", "Authentication is required.");
    }

    return {
      actorId: env.actorMode.demoActorId,
      mode: "demo",
      sessionId: null,
      role: "user"
    };
  }

  const session = await readActiveSessionByToken(db, sessionToken);
  const clearedSessionCookie = buildClearedSessionCookie(env);

  if (!session) {
    throw new ActorResolutionError(401, "unauthorized", "Session is invalid or expired.", {
      setCookie: clearedSessionCookie
    });
  }

  if (session.session_status !== "active" || session.expires_at.getTime() <= Date.now()) {
    throw new ActorResolutionError(401, "unauthorized", "Session is invalid or expired.", {
      setCookie: clearedSessionCookie
    });
  }

  if (session.user_status !== "active") {
    throw new ActorResolutionError(403, "unauthorized", "Session user is unavailable.", {
      setCookie: clearedSessionCookie
    });
  }

  if (options?.requiredRole === "admin" && session.user_role !== "admin") {
    throw new ActorResolutionError(403, "unauthorized", "Admin access is required.");
  }

  if (shouldTouchSessionActivity(session.last_seen_at)) {
    await touchSessionActivity(db, env, session.session_id, session.created_at);
  }

  // Retention active-day signal (D1/D7). Fire-and-forget + in-process daily dedup,
  // so this hot path (every authed API + SSR request) writes at most once per
  // user/day/process and never adds latency.
  recordActiveDay(db, session.user_id);

  return {
    actorId: session.user_id,
    mode: "session",
    sessionId: session.session_id,
    role: session.user_role
  };
}

export async function resolveRequiredAdminActor(
  db: Queryable,
  env: AppEnv,
  request: IncomingMessage
): Promise<RequestActor> {
  return resolveRequestActor(db, env, request, {
    allowDemo: false,
    requiredRole: "admin"
  });
}
