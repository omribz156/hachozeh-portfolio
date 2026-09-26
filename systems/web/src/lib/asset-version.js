// Single source of truth for cache-busting vanilla-JS island scripts.
// Evaluated once per server start (module scope in SSR Node.js), so every
// rebuild produces a fresh timestamp without any build-time preprocessing.
// Usage in Astro frontmatter: import { ASSET_VERSION } from '../lib/asset-version.js';
//   then: <script is:inline src={`/scripts/foo.js?v=${ASSET_VERSION}`}></script>
export const ASSET_VERSION = String(Date.now());
