import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

// Ported verbatim from systems/front/tailwind.config.js — same theme tokens
// (colors mapped to --hz-*, Arimo/Plex fonts, radii), same plugins.
// Only the `content` scan paths change to point at the Astro source tree.
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,vue,svelte}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--hz-market-blue-rgb) / <alpha-value>)',
        'background-dark': 'var(--hz-bg)',
        'background-light': '#f6f6f8',
        'card-dark': 'var(--hz-surface-2)',
        'modal-dark': 'var(--hz-bg-raised)',
        'off-white': 'var(--hz-text)',
        success: 'rgb(var(--hz-action-buy-rgb) / <alpha-value>)',
        danger: 'rgb(var(--hz-action-sell-rgb) / <alpha-value>)',
        'yellow-team': 'rgb(var(--hz-warning-rgb) / <alpha-value>)',
        'red-team': 'rgb(var(--hz-live-rgb) / <alpha-value>)',
        'neon-blue': 'rgb(var(--hz-market-blue-rgb) / <alpha-value>)',
        'neon-orange': 'rgb(var(--hz-warning-rgb) / <alpha-value>)',
        'neon-green': 'rgb(var(--hz-action-buy-rgb) / <alpha-value>)',
        'navy-muted': 'var(--hz-bg-muted)',
        'modal-bg': 'var(--hz-bg-muted)',
        'error-red': 'rgb(var(--hz-action-sell-rgb) / <alpha-value>)',
        'navy-modal': 'var(--hz-bg-raised)',
        'navy-border': 'var(--hz-border-soft)',
        'text-secondary': 'var(--hz-text-muted)',
        'navy-deep': 'var(--hz-bg)',
        'navy-card': 'var(--hz-surface-2)',
      },
      fontFamily: {
        // 'Arimo-fallback' is a local @font-face (global.css) tuned to match
        // Arimo's rendered width (size-adjust: 110%). It occupies the same box
        // as Arimo before the Google font loads, eliminating first-paint reflow.
        display: ['Arimo', 'Arimo-fallback', 'Noto Sans Hebrew', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        full: '9999px',
      },
    },
  },
  plugins: [forms, containerQueries],
};
