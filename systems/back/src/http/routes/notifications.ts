import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError } from "./route-errors";
import {
  dismissAllNotifications,
  dismissNotification,
  markAllNotificationsRead,
  markAllNotificationsUnread,
  markNotificationRead,
  NotificationFeedServiceError,
  readNotificationFeed
} from "../../notifications/notification-feed-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { DEFAULT_NOTIFICATION_STREAM_BUS } from "../default-notification-stream-bus";
import { DEFAULT_STREAM_CONNECTION_LIMITER } from "../default-stream-connection-limiter";
import { beginServerSentEvents, writeServerSentEvent } from "../json";

type NotificationRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
};

function readNotificationIdParam(request: { params: unknown }): string {
  return String((request.params as { notificationId?: string }).notificationId ?? "").trim();
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  context: NotificationRouteContext
): void {
  app.get("/api/me/notifications", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readNotificationFeed(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.feed_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  // Real-time bell push. EventSource (cookie-auth) holds this open; the Postgres
  // LISTEN handler relays a 'notification.new' here whenever any process inserts a
  // row for this user, and the client refetches the feed/unread count.
  app.get("/api/me/notifications/stream", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const streamBus = DEFAULT_NOTIFICATION_STREAM_BUS;
      const limiter = DEFAULT_STREAM_CONNECTION_LIMITER;

      if (!streamBus.canAcceptConnection(actor.actorId)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open notification streams.");
        return undefined;
      }
      if (!limiter.canAcceptConnection(request.raw)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open streams from this client.");
        return undefined;
      }

      reply.hijack();
      beginServerSentEvents(reply.raw, request.raw);
      writeServerSentEvent(reply.raw, "notification.ready", {
        eventType: "notification.ready",
        at: new Date().toISOString()
      });

      const closeStream = streamBus.addConnection(actor.actorId, reply.raw);
      const closeClient = limiter.addConnection(request.raw);
      const heartbeat = setInterval(() => {
        writeServerSentEvent(reply.raw, "heartbeat", {
          eventType: "heartbeat",
          at: new Date().toISOString()
        });
      }, 15_000);

      request.raw.once("close", () => {
        clearInterval(heartbeat);
        closeStream();
        closeClient();
      });

      return undefined;
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.stream_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/notifications/:notificationId/read", async (request, reply) => {
    const notificationId = readNotificationIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await markNotificationRead(context.dbPool, actor.actorId, notificationId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof NotificationFeedServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.mark_read_failed", {
        notificationId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/notifications/:notificationId/dismiss", async (request, reply) => {
    const notificationId = readNotificationIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await dismissNotification(context.dbPool, actor.actorId, notificationId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof NotificationFeedServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.dismiss_failed", {
        notificationId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/notifications/read-all", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await markAllNotificationsRead(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.mark_all_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/notifications/dismiss-all", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await dismissAllNotifications(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.dismiss_all_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/notifications/unread-all", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await markAllNotificationsUnread(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.notifications.mark_all_unread_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
