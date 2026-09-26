# Discovery Surface Contracts

Updated: 2026-05-06
Status: current
Owner: frontend lane

Purpose:
- make the discovery design lane easier to enter
- keep feed doctrine, route composition, data seams, and card rules from blurring together
- preserve depth without making every session reread the whole pile

Authority:
- this folder is a surface room under `workspace/docs/design.md`
- it owns discovery/front-page/live-page route contracts
- it does not replace frontend base law or component implementation docs

## Read Paths

If working on:
- current `trending` / front-page stage:
  - `trending-front-page.md`
- shared discovery feel:
  - `feed-system.md`
- route composition:
  - `discovery-route-spec.md`
- the `breaking` sub-page:
  - `breaking-page.md`
- future `live` sub-page:
  - `live-page.md`
- systems/back/frontend discovery seam:
  - `discovery-feed-contract.md`
- card family logic:
  - `feed-card-taxonomy.md`
  - `discovery-card-role-spec.md`
  - `feed-card-composition.md`

## Sibling Family · live / breaking / new

`trending` is the discovery front door. Underneath it, three sibling sub-pages each answer a different job against the same backend feed seam:

| Sibling | Job | Status |
|---|---|---|
| `breaking` | what moved hardest in the last 24h | shipped — `breaking-page.md` |
| `live` | what's active right now (event rooms, recent participation) | designed, not shipped — `live-page.md` |
| `new` | what just opened on the platform | legacy page, awaits redesign |

### Family Conventions (pin these before adding a fourth sibling)

- **Chrome** — all three mount through site-shell (`data-site-shell data-page="<key>"`). No bespoke header, nav, or footer.
- **Categories** — chips are *derived from the feed*, not hardcoded. "הכל" is always the first chip; the rest are top-N by `category.key` count. Trending precedent: `trending-stage.js` chip block.
- **URL state** — the active chip persists in `?category=<key>` with `replaceState` (back button leaves the page, not the chip).
- **Row click** — every row routes to `market-detail.html?market=<id>`. No trade entry on these surfaces; all action lives in market-detail.
- **Empty / loading / error** — every page must own all three states; the design drop typically ships only the happy path.
- **Responsive** — single breakpoint at 1024px (matching the platform `discovery-responsive-contract`). Above: full opening with rails; below: condensed, rails collapse.
- **Category visual vocabulary** — shared seam S1 is open: today each sibling carries its own per-category map (emoji/tone, material-icon, glyph-gradient). Long-term these consolidate into `assets/js/data/category-presentation.js`. Don't ship a fourth per-page map before that lands.
- **Plasters** — any client-side fallback the page knows is fake (sample feeds, mock data, missing-field placeholders) is labeled in code, in the per-surface doc, and in `workspace/coordination/back.md` with an explicit deletion condition.

## Ownership Map

- `feed-system.md`
  - discovery family doctrine
  - route personalities in broad strokes
  - anti-generic guardrails

- `trending-front-page.md`
  - current active front-page handoff
  - what has been rejected
  - how to continue stage work without promoting too early

- `discovery-route-spec.md`
  - route-by-route composition
  - role mix
  - migration order

- `live-page.md`
  - deep design target for the future `live` route only
  - richer route proof than the shared route spec

- `discovery-feed-contract.md`
  - backend truth vs derived read-model vs presentation-hint boundary
  - discovery item shape
  - route-specific contract pressure

- `feed-card-taxonomy.md`
  - market type vs card role split
  - the small allowed card-role family

- `discovery-card-role-spec.md`
  - what each role is allowed to contain
  - what each role should prioritize

- `feed-card-composition.md`
  - size, hierarchy, density, and layout behavior by role

## Notes

- boundary guidance that used to live in `discovery-field-boundaries.md` now lives inside `discovery-feed-contract.md`
- use `feed-system.md` for family doctrine, not for exact card payload or CSS-shape arguments
- use `trending-front-page.md` + `../../components/hz-card.md` before touching `systems/design/pages/trending.html` (the legacy `systems/design/stage/trending.html` was retired 2026-05-13)
- use `live-page.md` only when the work is truly about the `live` route, not discovery in general
- use `breaking-page.md` only when the work is truly about the `breaking` route; family-level conventions live here in this README
