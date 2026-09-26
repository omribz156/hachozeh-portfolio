import type { FastifyReply } from "fastify";

type PublicCacheOptions = {
  browserMaxAgeSeconds: number;
  cloudflareMaxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
};

function buildCacheControlDirectives(options: {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
}): string {
  const directives = [
    "public",
    `max-age=${options.maxAgeSeconds}`
  ];

  if (options.staleWhileRevalidateSeconds != null) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidateSeconds}`);
  }

  return directives.join(", ");
}

export function buildPublicCacheControl(options: PublicCacheOptions): string {
  return buildCacheControlDirectives({
    maxAgeSeconds: options.browserMaxAgeSeconds,
    staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds
  });
}

export function buildCloudflareCdnCacheControl(options: PublicCacheOptions): string | null {
  if (options.cloudflareMaxAgeSeconds == null) {
    return null;
  }

  return buildCacheControlDirectives({
    maxAgeSeconds: options.cloudflareMaxAgeSeconds,
    staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds
  });
}

export function setPublicCacheControl(
  reply: FastifyReply,
  options: PublicCacheOptions
): void {
  reply.header("cache-control", buildPublicCacheControl(options));

  const cloudflareCacheControl = buildCloudflareCdnCacheControl(options);
  if (cloudflareCacheControl) {
    reply.header("cloudflare-cdn-cache-control", cloudflareCacheControl);
  }
}

export function setNoStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}
