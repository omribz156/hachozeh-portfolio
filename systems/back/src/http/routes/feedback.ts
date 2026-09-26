import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  FeedbackServiceError,
  readFeedbackImageFile,
  submitFeedback
} from "../../feedback/feedback-service";
import { formatUnknownError, type Logger } from "../../shared/logger";

type FeedbackRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
};

function readRequiredBody(request: FastifyRequest): unknown {
  if (typeof request.body === "undefined" || request.body === null) {
    throw new Error("JSON body is required");
  }

  return request.body;
}

export function registerFeedbackRoutes(
  app: FastifyInstance,
  context: FeedbackRouteContext
): void {
  app.get("/api/uploads/feedback/:fileName", async (request, reply) => {
    try {
      await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false,
        requiredRole: "admin"
      });
      const { fileName } = request.params as { fileName?: string };
      const file = await readFeedbackImageFile(fileName ?? "");
      if (!file) {
        sendError(reply, 404, "not_found", "Feedback image was not found.");
        return undefined;
      }

      reply.header("cache-control", "private, no-store");
      reply.type(file.contentType);
      return reply.send(file.buffer);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.feedback.image_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/feedback", { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const payload = await submitFeedback(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
      reply.code(201);
      return payload;
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof FeedbackServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.feedback.submit_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.options("/api/feedback", async (_request, reply) => {
    reply.code(204).send();
  });
}
