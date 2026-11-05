import { defineConfig } from 'astro/config';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import preact from '@astrojs/preact';

// Separate static entry point; the original SSR platform remains restorable.
export default defineConfig({
  site: 'https://hachozeh.com',
  srcDir: './showcase/src',
  publicDir: './showcase/public',
  outDir: './showcase-dist',
  output: 'static',
  integrations: [preact()],
  trailingSlash: 'always',
  vite: { css: { postcss: { plugins: [tailwindcss({ config: './tailwind.config.mjs' }), autoprefixer()] } } },
});
