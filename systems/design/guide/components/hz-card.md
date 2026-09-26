# hz-card — Market Card Pattern

Updated: 2026-05-12
Status: current
Owner: frontend / discovery surface

Purpose:
- source of truth for the **new** market card used by trending and the upcoming sibling discovery surfaces (live, breaking, new)
- defines the shape rules, variants, and states
- captures the locked design decisions so they don't drift

This Doc Owns:
- the `hz-card` CSS pattern and its variant rules
- the "max 2 outcomes in the body" rule
- the chance ring + signal pill + bookmark rules

This Doc Does Not Own:
- where cards live on a page (that's the surface doc, e.g. `surfaces/discovery/trending-front-page.md`)
- the legacy `market-card.js` renderer still used by landing-guest / new-markets / breaking (see `components/market-card.md`)

## Files

| Concern | File |
| --- | --- |
| CSS | `systems/design/assets/css/patterns/market-card.css` |
| Layer | `@layer hz.patterns` |
| Lab (visual reference) | `systems/design/mockups/market-card-shape-lab.html` |
| Live use | `systems/design/pages/trending.html` (rendered by `assets/js/pages/trending-stage.js`) |

## Shape — The Constant

Every variant has the same four-part frame. **Only the body morphs.**

```
[ thumb · title · (optional chance ring) ]   ← head
[ body — varies by variant                ]   ← grows to fill min-height
[ meta strip + bookmark                   ]   ← foot
```

- Card has `min-height: 13.5rem` so all cards align in the stream grid.
- Body uses `flex: 1` + `justify-content: flex-end` so short bodies (binary) dock their action row to the bottom.
- **One bookmark per card.** Lives in the footer, never in the head.

## Variants

Variant is chosen by the renderer based on market shape. See `pickCardVariant()` in `trending-stage.js`.

### Binary
Single Yes/No outcome with a probability.
- Head: thumb + title + **chance ring** showing the leading side's %
- Body: `hz-yn` pair — `hz-yn__btn--yes` (mint) / `hz-yn__btn--no` (coral)
- Used for: `binary`, `metric-binary`, any 2-outcome market

### Live
Tied to a real-time price feed.
- Head: thumb + title + chance ring (tone `--down` flips the arc to coral when below 50%)
- Body: `hz-live-tape` (mini price + spark + delta) above an Up/Down `hz-yn` pair (`--up` / `--down`)
- Used for: `variant === "live"` or `liveMeta.isLive === true`

### Multi (top-2)
Ranked outcomes. Body shows **top 2 only** — the rest open on the market detail page.
- Head: thumb + title (no chance ring; no single leading %)
- Body: 2 `hz-out-row` rows, each `name · % · hz-yn-inline` with small Yes/No buttons
- Used for: `variant` in `["ranking", "default"]`, or any market with 3+ outcomes

### Match-up
Sports/event with two sides and an optional draw.
- Head: thumb + title + chance ring (tinted with the **leading side's tone** via `hz-chance-ring--info` or `--sell` etc., and ring label = leading team name)
- Body: `hz-yn` with **two team-name buttons** (no Yes/No) using tone modifiers (`tone-amber` / `tone-info` / `tone-sell`). When a draw outcome exists, the body becomes `hz-yn hz-yn--draw` with a 3-button pick row (`1fr 0.8fr 1fr`) where the middle button uses `hz-yn__btn--draw`.
- Used for: `variant === "sports"` or any market exposing `sportsMatch`

### Date ladder
Same market, multiple deadlines.
- Same as multi but each row's "name" is a date label.
- Currently only used inside the trending stream when a market exposes ladder-shaped outcomes; not yet emitted by the live data source.

## Chance Ring Rules

The ring sits in the head's optional third column. Use it when there is a **single % worth highlighting**: the leading Yes probability (binary), the leading direction (live), or the leading team (match-up). Don't use it on multi-outcome cards where there is no single hero %.

- Default arc: brand amber.
- `hz-chance-ring--info` — info-blue arc (use when the leading side carries blue identity).
- `hz-chance-ring--sell` / `hz-chance-ring--down` — coral arc (use for "going down" live or coral-identity teams).
- Label sits below the value — short word: `סיכוי`, `מעלה`, or a team name. Truncates with ellipsis at `max-width: 2.2rem`.

## Signal Pills

Live in the **footer meta strip**, replacing or augmenting the volume number.

| Class | Use |
| --- | --- |
| `hz-signal--new` | freshly listed |
| `hz-signal--hot` | breaking/trending |
| `hz-signal--live` | actively live (pulses) |
| `hz-signal--closing` | closes soon |

Driven by `getSignal(market)` in the renderer — derived from `market.liveMeta.isLive`, `signals.isBreaking`, `timeToCloseLabel`, etc.

## Tone Modifiers (for match-up buttons)

`hz-yn__btn` accepts a tone modifier to carry team/option identity without Yes/No semantics:

| Modifier | Use |
| --- | --- |
| `--amber` | brand-coded team |
| `--info` | blue-coded team |
| `--sell` | red/coral-coded team |
| `--neutral` | bordered neutral (rarely needed) |
| `--draw` | middle "תיקו" option |

Standard Yes/No semantics still use `--yes` / `--no` (mint/coral) and live cards use `--up` / `--down`.

## States

| State | Markup |
| --- | --- |
| Default | base `hz-card` |
| Hover | `:hover` lift + border step |
| User position held | `hz-position-badge` pill inside body (`+₪64 · 200 × כן`) |
| Resolved | `hz-card.is-resolved` + `hz-resolved-banner` (winner banded with payout) |
| Loading | structural skeleton built from `hz-skel` / `hz-skel--line` / `hz-skel--line-lg` |

## Hard Rules

These are the locked decisions. Don't drift.

1. **Body never exceeds 2 outcomes.** Multi-outcome markets show top 2; the rest live on the detail page.
2. **Same height across all cards in a row.** Use `min-height` on the card and `flex: 1` on the body; never set a fixed card height.
3. **One bookmark per card, in the footer.** Never duplicate in the head.
4. **The chance ring is for a single hero %.** If there isn't one, omit the ring.
5. **RTL discipline.** Logical properties (`inset-inline-end`, `padding-inline`) only.
6. **Tailwind doesn't enter `hz-card`.** All structure and color is `--hz-*` token-driven.

## Open Items

- Save/unsave wiring (currently the bookmark is presentational only).
- Real team-color injection for match-ups from `sportsMatch.homeTeam.badgeClass` rather than the heuristic tone pick.
- Thumb image fallback policy when the market has no `image.src` — currently uses a category emoji + tinted thumb background.
