// Hachozeh Tailwind config (CLI build).
//
// Translated from the previous runtime CDN config at
// assets/js/tailwind-theme.js. Theme tokens are unchanged — same colors,
// fonts, radii — only the file format and toolchain differ.
//
// Scope:
// - content scans the HTML pages we actually ship plus the JS that builds
//   class strings (recipes.js + page components).
// - guide/, mockups/, test/, and history/* HTML are deliberately skipped:
//   guide docs aren't browser-served; mockups are scratch; history files
//   are frozen archived snapshots that should not influence current output.
//
// Plugins mirror what the CDN was loading (`?plugins=forms,container-queries`).
// container-queries has no detected usage today, but installing it preserves
// the option without a future audit later.

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./pages/**/*.html",
    "./stage/**/*.html",
    "./assets/js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--hz-market-blue-rgb) / <alpha-value>)",
        "background-dark": "var(--hz-bg)",
        "background-light": "#f6f6f8",
        "card-dark": "var(--hz-surface-2)",
        "modal-dark": "var(--hz-bg-raised)",
        "off-white": "var(--hz-text)",
        success: "rgb(var(--hz-action-buy-rgb) / <alpha-value>)",
        danger: "rgb(var(--hz-action-sell-rgb) / <alpha-value>)",
        "yellow-team": "rgb(var(--hz-warning-rgb) / <alpha-value>)",
        "red-team": "rgb(var(--hz-live-rgb) / <alpha-value>)",
        "neon-blue": "rgb(var(--hz-market-blue-rgb) / <alpha-value>)",
        "neon-orange": "rgb(var(--hz-warning-rgb) / <alpha-value>)",
        "neon-green": "rgb(var(--hz-action-buy-rgb) / <alpha-value>)",
        "navy-muted": "var(--hz-bg-muted)",
        "modal-bg": "var(--hz-bg-muted)",
        "error-red": "rgb(var(--hz-action-sell-rgb) / <alpha-value>)",
        "navy-modal": "var(--hz-bg-raised)",
        "navy-border": "var(--hz-border-soft)",
        "text-secondary": "var(--hz-text-muted)",
        "navy-deep": "var(--hz-bg)",
        "navy-card": "var(--hz-surface-2)"
      },
      fontFamily: {
        display: ["Arimo", "Noto Sans Hebrew", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px"
      }
    }
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries")
  ]
};
