import type { FastifyReply } from "fastify";

import type { ActorResolutionError } from "../../auth/actor-resolver";

/**
 * Shared HTTP error responders for route handlers.
 *
 * These were previously copy-pasted verbatim into ~19 route files. `sendError`
 * is the superset signature: the optional `metadata` is spread into the
 * response envelope, and with `metadata` undefined the output is byte-identical
 * to the no-metadata copies (`{ error: { code, message } }`).
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  reply.code(statusCode).send({
    error: {
      code,
      message
    },
    ...metadata
  });
}

export function sendActorResolutionError(reply: FastifyReply, error: ActorResolutionError): void {
  if (error.setCookie) {
    reply.header("set-cookie", error.setCookie);
  }
  sendError(reply, error.statusCode, error.code, error.message);
}

export function sendInvalidJsonError(reply: FastifyReply, message: string): void {
  sendError(reply, 400, "invalid_request", message);
}
