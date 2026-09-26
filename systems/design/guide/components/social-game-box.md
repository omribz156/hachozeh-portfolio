# social-game-box — Community Side Panel

Updated: 2026-05-12
Owner: frontend / discovery surface

Status:
- **structure locked**, **data is mock**
- in use on `pages/trending.html` (right column of the hero zone)
- the renderer is a real component; the API/backend seams that will replace
  the mock data are documented below and do not exist yet

Purpose:
- document the community side panel beside the trending hero
- keep its mock-data boundary visible until backend seams exist

## Panel Shape

The community side panel that sits next to the trending hero. Three sections,
two auth-state variants:

```
[ הקהילה ]
├── לוח מובילים · השבוע    (always)
├── רצפים חמים             (always)
└── auth-state controlled:
    · user  → אתה מול הקהל   (You vs Crowd)
    · guest → חוכמת ההמונים   (Wisdom of Crowds)
```

Both variants share the leaderboard and the streaks. Only the third section
differs — implementing it as two components would duplicate ~80% and drift.

## This Doc Owns

- the `social-game-box` component contract
- the data shape it consumes (the seam for real APIs later)
- the auth-state toggle mechanism

## This Doc Does Not Own

- visual styling (lives in `assets/css/patterns/social-game-box.css`)
- where the panel appears on a page (the surface doc owns placement —
  currently `surfaces/discovery/trending-front-page.md`)
- the actual community/leaderboard backend (does not exist yet)

## Files

| Concern | File |
| --- | --- |
| Renderer | `systems/design/assets/js/components/social-game-box.js` |
| CSS pattern | `systems/design/assets/css/patterns/social-game-box.css` |
| Layer | `@layer hz.patterns` |
| Live use | `systems/design/pages/trending.html` (slot: `<aside data-social-game></aside>`) |

## How It Mounts

1. Page provides one or more `[data-social-game]` elements.
2. `social-game-box.js` auto-mounts on `DOMContentLoaded`, looking up every
   `[data-social-game]` and rendering its inner markup.
3. After rendering, it reads `window.NaviAuthSession.getState()` and sets
   `data-auth-state="user"` or `"guest"` on the root. CSS in
   `patterns/social-game-box.css` hides the wrong third section.
4. It listens once for `navi:auth-state` and re-applies the
   `data-auth-state` on every still-mounted instance.

No HTML markup other than the slot is required. The component owns the entire
interior.

## Data Contract

`window.NaviSocialGameBox.MOCK_DATA` is the canonical shape. **Field names
define the seam — do not rename without also updating this doc.**

```js
{
  leaders: [                  // ordered top-N
    {
      rank: 1,                // integer; 1/2/3 get gold/silver/bronze tints
      name: "תומר אורבך",
      stat: "+₪3,420",        // string, includes sign and currency
      tone: "up"              // "up" | "down" — tints the stat color
    },
    // …
  ],
  streaks: [                  // ordered hot streaks
    {
      initials: "דר",         // 1-2 letters for the avatar
      name: "דניאל רוזן",
      count: 7                // integer — current streak length
    },
    // …
  ],
  yvc: {                      // shown when data-auth-state="user"
    accuracy: "68%",          // user's prediction accuracy (string with %)
    marketAvg: "58%",         // platform average (string with %)
    rank: "#127"              // user's place on the yearly board
  },
  wisdom: {                   // shown when data-auth-state="guest"
    gauge: 73,                // integer percent (0–100)
    label: "דיוק כללי השנה",
    meta: "ניתוח של 1,284 שווקים…\n…ב־73% מהמקרים."
                              // \n becomes <br>
  }
}
```

Any field missing → renders an em-dash or hides gracefully. The component
never throws on partial data.

## Public API

```js
window.NaviSocialGameBox = {
  mount(root = document, data = MOCK_DATA),
  render(container, data),
  setData(data),               // re-renders every mounted box
  MOCK_DATA,                   // exported so callers can extend it
};
```

Typical wiring once the backend exists:

```js
const data = await window.NaviCommunityFeed.read(); // hypothetical
window.NaviSocialGameBox.setData(data);
```

If a page wants to mount manually (e.g. inserted into a modal after page
load), call `window.NaviSocialGameBox.mount(scopeRoot)`.

## Auth-State Behavior

The component **always** sets `data-auth-state` after render, defaulting to
`"guest"` if `NaviAuthSession` is unavailable. CSS toggling is purely visibility
based — both DOM sections render; one is hidden by `display: none`. This keeps
the layout stable as auth state flips and avoids reflow.

## Future Seams (when APIs land)

These are the obvious places real data will hook in. Capture them here so
nothing drifts when wiring time comes:

1. **Leaderboard feed** — likely `GET /api/community/leaderboard?period=week`
   returning the `leaders` array shape above. Periods will probably be
   `week | month | year`; the section title currently hardcodes "השבוע".
2. **Streaks feed** — likely `GET /api/community/streaks?limit=N` returning
   the `streaks` array shape above.
3. **You-vs-Crowd** — per-user; will need a session-authenticated call. Field
   shape stays the same; the component does not need to change.
4. **Wisdom-of-Crowds** — a single platform metric. Can be cached aggressively;
   the seam expects `{ gauge, label, meta }`.

When the backend lands, the recommended pattern is a sibling file
`assets/js/data/community-data-source.js` exposing a `read()` that returns
the same shape as `MOCK_DATA`. The page then calls
`NaviSocialGameBox.setData(...)` once after fetch.

## Hard Rules

1. **Mock data lives in the component.** When data is hardcoded, hardcode
   it inside the renderer, not inside the page HTML. The page slot stays
   empty until JS fills it.
2. **The data shape is the contract.** Anyone introducing a real API consumes
   the shape above. Renaming a field is a breaking change.
3. **No backend leakage into the component.** The component does not know
   about URLs, auth tokens, or response decoding. A separate data source
   owns that.
4. **Auth-state is visibility, not branching.** Both YvC and Wisdom sections
   render in the DOM; CSS picks one. Do not conditionally skip the render.
5. **Don't expand the panel without product clarity.** New sections should
   join `surfaces/discovery/trending-front-page.md` first.

## Smoke Standard

After changes to the renderer or its data shape:

1. Load `pages/trending.html`. The right column shows leaderboard + streaks +
   one of the two third sections.
2. In devtools: `NaviAuthSession.getState()` and flip `authenticated`. The
   third section should swap between Yvc and Wisdom on the next
   `navi:auth-state` dispatch.
3. `NaviSocialGameBox.setData({ leaders: [], streaks: [], yvc: {}, wisdom: {} })`
   should render gracefully (empty leader list, empty streak list, em-dashes
   in yvc, `0%` gauge).
