# CSS Base Contract

Updated: 2026-05-30
Status: current
Owner: frontend lane

Purpose:
- define the frontend CSS base law for Hachozeh
- keep `--hz-*` as the platform taste layer
- prevent Tailwind/form-reset and page-local CSS drift

It translates `workspace/docs/design.md` into runtime CSS rules. It does not
replace the platform design constitution.

## Source Of Truth

Active frontend CSS uses one vocabulary: `--hz-*`.

Use it for:
- color
- typography
- radius
- spacing
- shadows
- motion
- shared atmosphere

Do not add new product palettes under page-specific names like `--front-*`,
`--stage-*`, or `--pf-*` unless they only alias an existing `--hz-*` token for
transition.

Plain English: `--hz-*` is the platform taste layer. Everything else is a local
adapter, not a second design system.

## Runtime Spine

`systems/design/assets/css/base.css` is only the import spine.

It declares the cascade layer order for the platform floor, then imports the base layers:

```css
@layer hz.tailwind, hz.tokens, hz.reset, hz.primitives, hz.compat;

@import url("./base/tokens.css")     layer(hz.tokens);
@import url("./base/reset.css")      layer(hz.reset);
@import url("./base/primitives.css") layer(hz.primitives);
@import url("./base/compat.css")     layer(hz.compat);
```

`hz.tailwind` is declared first (lowest priority) — Tailwind's compiled output lives there, below the platform floor. The hz.tailwind layer is added to the order by `assets/css/tailwind.css`, which is loaded from each page `<link>` before `base.css`. See `Tailwind Boundary` below.

Do not turn `base.css` back into a mixed CSS salad. New patterns and page CSS live in `patterns/` and `pages/` and load via per-page `<link>` tags.

### Why patterns/ + pages/ stay UNLAYERED (current)

CSS cascade rules say un-layered styles always win over layered ones, regardless of selector specificity. patterns/ and pages/ stay un-layered so their class selectors beat lower-priority rules by normal specificity — they sit above the entire `hz.tailwind` → `hz.compat` layer stack.

Promoting patterns + pages into `@layer hz.patterns` / `@layer hz.pages` is a separate future task (Option C in `workspace/docs/engineering-decisions.md` 2026-05-30 Tailwind migration entry). It would close the cascade story end-to-end, but it requires auditing every pattern/page CSS file for source-order wins and `!important` uses, so it lives outside the migration that introduced the build step.

### Form-element specificity (forms plugin gotcha)

Pages load Tailwind with `?plugins=forms,container-queries`. The forms plugin resets every text input, select, textarea, and a few button states using bare attribute selectors — e.g. `[type='text']`, `[type='email']`, `[type='search']`. These are specificity (0,0,1,0), same as a single class. Because the forms plugin styles inject after our `<link>` stylesheets, **a plain `.hz-foo-input` class will lose the cascade tie** and the input renders with a white background, gray border, and the plugin's own padding.

Rule for patterns/pages styling form elements:

- Use `element.class` selectors (e.g. `input.hz-shell__search-input`, `select.hz-form-select`) to beat the plugin's attribute selector specificity.
- Add `appearance: none` to neutralize residual native control styling.
- Set `box-shadow: none` if the input has a focus ring or filled look — the plugin sometimes adds its own.
- Don't lean on `!important` for this. Specificity is enough.

This applies to anything that catches a forms-plugin reset: text/email/search/url/tel/password/number inputs, selects, textareas. Buttons styled by classes are usually fine, but if a button starts rendering with a transparent background and inherited border, suspect preflight (already handled) and check the rendered cascade.

## Directory Roles

```
assets/css/
├── base.css        ← spine: declares layer order, imports base/ + Google font CSS
├── base/           ← platform floor (tokens, reset, primitives, compat)
├── patterns/       ← reusable component CSS, un-layered (sits above the layered stack)
├── pages/          ← page-specific layout, un-layered
├── stage/          ← legacy stage proofs (do not extend; migrate to patterns/ + pages/)
└── tailwind.css    ← compiled Tailwind output (built by the Tailwind CLI; @layer hz.tailwind)
```

Authority flows down: patterns may use tokens; pages may use patterns + tokens; nothing climbs back up. Stage is being retired surface by surface.

## File Roles

### `tokens.css`

Owns platform constants:
- Arimo UI typography
- IBM Plex Mono for dense numeric/debug-like microcopy
- viewport-coupled root font-size `clamp(13px, calc(0.4vw + 11.5px), 17px)` so every rem scales with the page
- **warm-neutral dark atmosphere** (`#13141a` page bg, warm-tinted hairlines)
- **brand: amber** `#e8b257` — the platform signature color
- **info: blue** `#7aaee6` — secondary chart accent (was the old `--hz-market-blue`, kept as alias for back-compat; retire in a later sweep)
- **action: mint buy / coral sell** — kept distinct from brand so trade colors don't compete
- **state accents** — vermillion closing, orange hot, red live, cyan new, mint leading
- shared radii, spacing, shadows, and motion

If a page needs a new reusable visual decision, add it here only after it is
really platform-wide.

### `reset.css`

Owns boring-but-important browser physics:
- **`* { box-sizing: border-box }`** — universal, applied here so pages don't depend on Tailwind's preflight
- body font/background/text defaults
- input/button inheritance
- link reset
- number input spinner reset
- selection color (amber-tinted)
- reduced-motion behavior

No product surface styling belongs here.

### `primitives.css`

Owns tiny shared primitives that are not full components:
- Material Symbols settings
- scrollbar helpers
- LTR chart container helper
- overlay shell primitives
- `hz-panel`
- `hz-chip`
- `hz-sparkline`
- `hz-live-bubble`

Primitives must stay small. If a class starts describing a real product object,
move it to a component or page CSS file.

### `compat.css`

Temporary compatibility only.

Allowed:
- short-lived aliases needed to keep an active page rendering while it migrates

Not allowed:
- new design patterns
- stale prototype classes
- old color systems
- page-specific layout

Every addition here should feel a little embarrassing. That is the point. This
file is a quarantine, not a home.

## Tailwind Boundary

Tailwind remains as layout glue and transition support.

Allowed:
- spacing and layout utilities
- responsive wrappers
- simple typography utilities
- arbitrary values that consume `--hz-*`

Not allowed:
- Tailwind inventing a second palette
- Tailwind-only product identity
- adding new brand colors directly in templates

### Build pipeline

Tailwind is compiled at build time via the Tailwind CLI, not loaded from a CDN at runtime.

- Config: `systems/design/tailwind.config.js` (theme tokens, content paths, plugins).
- Input: `systems/design/tailwind-input.css` (wraps `@tailwind base/components/utilities` inside `@layer hz.tailwind`).
- Output: `systems/design/assets/css/tailwind.css` (tracked in git so static serving works without a build step).
- Run during development: `npm --prefix systems/design run watch:css` (rebuilds ~50ms per change).
- Run for production build: `npm --prefix systems/design run build:css` (minified, ~47 KB → ~9 KB gzipped).

Theme tokens (legacy aliases like `primary`, `success`, `danger`, `card-dark` that map to `--hz-*` tokens) live in `tailwind.config.js` under `theme.extend.colors`. The legacy runtime `assets/js/tailwind-theme.js` was deleted with the CDN migration on 2026-05-30; theme changes go in the config file now.

When adding a new utility class to product CSS or JS, the Tailwind CLI scans HTML and JS source statically — full literal class names work automatically; dynamic class assembly (e.g. `` `bg-${tone}-500` ``) needs the classes added to `safelist` in `tailwind.config.js`. No dynamic assembly exists in the current code (recipes.js uses full literals; trade-ticket tone classes are literal assignments).

## Active Migration Rule

When touching active runtime pages or stage pages:

1. Use `--hz-*` tokens for new CSS.
2. Prefer named CSS classes for product objects, using the **`hz-` prefix** and BEM-ish shape (`hz-block`, `hz-block__element`, `hz-block--modifier`).
3. Place reusable component CSS in `assets/css/patterns/<name>.css`. Keep it **unlayered** (see "Why patterns/ + pages/ stay UNLAYERED" above).
4. Place page composition CSS in `assets/css/pages/<page>.css`. Same rule — unlayered.
5. Keep Tailwind for glue, not taste.
6. Do not add old helpers like `glow-border`, `hero-gradient`, `nav-active`,
   `sparkline`, `chart-grid`, or `timeline-line`.
7. If an old helper is still needed, either migrate the caller or add a short
   temporary alias in `compat.css` with a cleanup note.

## What This Refactor Did Not Promise

This pass does not mean every legacy page CSS file is perfect.

It means:
- the global base no longer owns stale prototype taste
- active pages have a shared token source
- old global helper names should stop spreading
- future extraction can happen without reopening the base CSS junk drawer

## Smoke Standard

After changing the base layer, check:
- `systems/design/pages/trending.html` (the new locked surface — uses patterns + `hz.patterns` + `hz.pages` layers)
- `systems/design/pages/market-detail.html`
- `systems/design/pages/portfolio.html`
- `systems/design/stage/live.html`

`systems/design/stage/trending.html` is retired — the trending shape now lives at `pages/trending.html` (see `surfaces/discovery/trending-front-page.md`).
`systems/design/stage/portfolio.html` is retired (2026-05-19) — the portfolio shape now lives at `pages/portfolio.html` (see `surfaces/portfolio/README.md`). Pre-promotion snapshot at `guide/history/2026-05-portfolio-pre-v1-proof/`.
`systems/design/stage/market-detail.html` is retired (2026-05-20) — the market-detail shape lives at `pages/market-detail.html` (see `components/market-detail.md`). Pre-promotion snapshot at `guide/history/2026-04-market-detail-pre-v1-proof/`.

Backend may be down. The frontend shell must still render without exploding.
