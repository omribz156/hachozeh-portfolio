import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import sentry from '@sentry/astro';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || '';

// Phase 1 foundation — SSR.
// output: 'server' = every route renders per request (the model the whole
// migration depends on). Routes that are genuinely frozen (resolved markets,
// static pages) opt back into static later with `export const prerender = true`.
// The Node adapter in 'standalone' mode produces a self-contained Node server
// that Caddy proxies to (Phase 1.5).
//
// PostCSS (Tailwind) is wired explicitly here rather than via a postcss.config
// file — Astro 6 did not auto-detect postcss.config.mjs, leaving @tailwind
// directives uncompiled. Inlining removes the ambiguity.
export default defineConfig({
  output: 'server',
  outDir: process.env.NAVI_ASTRO_OUT_DIR || './dist',
  adapter: node({ mode: 'standalone' }),
  // Preact islands (audit F-06): ~4KB runtime, Astro-native hydration. First
  // consumer is the portfolio depth section (PortfolioDepth.jsx).
  integrations: [
    preact(),
    sentry({
      enabled: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: sentryAuthToken || undefined,
      telemetry: false,
      sourcemaps: {
        disable: sentryAuthToken ? false : true,
      },
      unstable_sentryVitePluginOptions: {
        release: {
          create: Boolean(sentryAuthToken),
          finalize: Boolean(sentryAuthToken),
        },
      },
    }),
  ],
  // Prefetch on hover so soft-nav transitions feel instant. prefetchAll=false
  // (opt-in via data-astro-prefetch) keeps it targeted — nav links get it,
  // every market card link does not (too many).
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  // Dev server runs on :6969; the prod standalone build listens on PORT env
  // (4321, set by the `start` script + Caddy proxy). They no longer collide.
  server: { host: '127.0.0.1', port: 6969 },
  vite: {
    // Dev-only: proxy /api + /health to the backend so browser islands
    // (live-count, etc.) work at localhost:6969 without Caddy in front.
    // The standalone build ignores this — Caddy handles /api in prod.
    server: {
      // Dev bridge: the Cloudflare Access tunnel reaches astro dev as
      // dev.hachozeh.com. Vite blocks unknown Host headers by default — allow
      // the dev domain (and any *.hachozeh.com subdomain).
      allowedHosts: [],
      proxy: {
        '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
        '/health': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss({ config: './tailwind.config.mjs' }), autoprefixer()],
      },
    },
  },
});
