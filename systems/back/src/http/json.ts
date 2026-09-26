import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { writeServerSentEventFrame } from "./sse";

const DEFAULT_CORS_ALLOWED_HEADERS = "content-type,x-request-id";
const DEFAULT_CORS_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const DEFAULT_PRODUCTION_CORS_ALLOWED_ORIGINS = "https://hachozeh.com";
const DEFAULT_DEVELOPMENT_CORS_ALLOWED_ORIGINS =
  "https://dev.hachozeh.com,https://hachozeh.com,http://127.0.0.1:6969,http://localhost:6969,http://127.0.0.1:4321,http://localhost:4321,http://127.0.0.1:8080,http://localhost:8080";
const CORS_VARY_HEADERS = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

type CorsHeaderRequest = {
  headers: IncomingHttpHeaders;
};

const CORS_ALLOWED_REQUEST_HEADERS = new Set(
  DEFAULT_CORS_ALLOWED_HEADERS.split(",").map((header) => header.trim().toLowerCase())
);

function readAllowedOrigins(): Set<string> {
  const defaultOrigins =
    process.env.NODE_ENV === "production"
      ? DEFAULT_PRODUCTION_CORS_ALLOWED_ORIGINS
      : DEFAULT_DEVELOPMENT_CORS_ALLOWED_ORIGINS;
  const raw = process.env["CORS_ALLOWED_ORIGINS"] ?? defaultOrigins;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isCorsOriginAllowed(origin: string | null | undefined): boolean {
  const normalizedOrigin = origin?.trim();
  return Boolean(normalizedOrigin && readAllowedOrigins().has(normalizedOrigin));
}

function filterRequestedCorsHeaders(requestedHeaders: string | undefined): string {
  const headers = requestedHeaders
    ?.split(",")
    .map((header) => header.trim().toLowerCase())
    .filter((header) => CORS_ALLOWED_REQUEST_HEADERS.has(header));

  if (!headers?.length) {
    return DEFAULT_CORS_ALLOWED_HEADERS;
  }

  return [...new Set(headers)].join(",");
}

export function buildCorsHeaders(
  request?: CorsHeaderRequest,
  options?: {
    allowedMethods?: string;
  }
): Record<string, string> {
  const origin = request?.headers.origin?.toString().trim();
  const requestedHeaders = request?.headers["access-control-request-headers"]?.toString().trim();
  const headers: Record<string, string> = {};

  if (origin) {
    // Always set Vary so caches key CORS responses on the browser's request shape.
    headers["vary"] = CORS_VARY_HEADERS;

    if (isCorsOriginAllowed(origin)) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-credentials"] = "true";
    }
    // Origin present but not in allowlist: no ACAO or ACAC headers set.
  } else {
    // No Origin header — not a cross-origin request; set wildcard for non-credentialed tools.
    headers["access-control-allow-origin"] = "*";
  }

  headers["access-control-allow-headers"] = filterRequestedCorsHeaders(requestedHeaders);
  headers["access-control-allow-methods"] = options?.allowedMethods ?? DEFAULT_CORS_ALLOWED_METHODS;
  headers["access-control-max-age"] = "600";

  return headers;
}

function applyCorsHeaders(
  response: ServerResponse,
  request?: IncomingMessage,
  options?: {
    allowedMethods?: string;
  }
): void {
  const headers = buildCorsHeaders(request, options);

  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
}

export function beginServerSentEvents(
  response: ServerResponse,
  request: IncomingMessage
): void {
  response.statusCode = 200;
  applyCorsHeaders(response, request, {
    allowedMethods: "GET,OPTIONS"
  });
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("connection", "keep-alive");
  response.flushHeaders?.();
}

export function writeServerSentEvent(
  response: ServerResponse,
  event: string,
  payload: unknown
): void {
  writeServerSentEventFrame(response, event, payload);
}
