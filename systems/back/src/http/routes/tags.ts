import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { readTagPage, readPublicTagList, readCategoryTags } from "../../markets/market-api/related-read-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import { setPublicCacheControl } from "../cache-control";

type TagRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

function readSlugParam(request: FastifyRequest): string {
  return String((request.params as { slug?: string }).slug ?? "").trim();
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

// Public, unauthenticated read powering the indexable `/t/<slug>` entity hubs. Returns the
// tag (slug/label/kind) + all its published markets as card-identical summaries. Unknown or
// hidden tags 404 — the frontend redirects those (and below-threshold ones) to the noindex
// `/search` fallback, so a thin tag never becomes a thin *indexable* page.
export function registerTagRoutes(app: FastifyInstance, context: TagRouteContext): void {
  app.get("/api/tags", async (_request, reply) => {
    try {
      const tags = await readPublicTagList(context.dbPool);
      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 300,
        cloudflareMaxAgeSeconds: 900,
        staleWhileRevalidateSeconds: 1800
      });
      return { tags };
    } catch (error) {
      context.logger.warn("fastify_app.tags.list_failed", {
        error: formatUnknownError(error)
      });
      // A tag-list failure should degrade the sitemap child, not 500 it.
      return { tags: [] };
    }
  });

  app.get("/api/tags/by-category/:categoryKey", async (request, reply) => {
    const categoryKey = String((request.params as { categoryKey?: string }).categoryKey ?? "").trim();
    try {
      const tags = categoryKey ? await readCategoryTags(context.dbPool, categoryKey) : [];
      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 300,
        cloudflareMaxAgeSeconds: 900,
        staleWhileRevalidateSeconds: 1800
      });
      return { tags };
    } catch (error) {
      context.logger.warn("fastify_app.tags.by_category_failed", {
        categoryKey,
        error: formatUnknownError(error)
      });
      return { tags: [] };
    }
  });

  app.get("/api/tags/:slug", async (request, reply) => {
    const slug = readSlugParam(request);

    if (!slug) {
      sendError(reply, 404, "tag_not_found", "Tag not found.", {
        slug,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }

    try {
      const result = await readTagPage(context.dbPool, slug);

      if (!result) {
        sendError(reply, 404, "tag_not_found", "Tag not found.", {
          slug,
          requestId: readReplyRequestId(reply, request)
        });
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 60,
        cloudflareMaxAgeSeconds: 300,
        staleWhileRevalidateSeconds: 600
      });
      return result;
    } catch (error) {
      context.logger.warn("fastify_app.tags.read_failed", {
        slug,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.", {
        slug,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }
  });
}
