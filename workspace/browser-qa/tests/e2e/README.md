# Platform E2E + Regression Suite

One spec per page. Each proves the page **works** (loads + real flow) and **hasn't
regressed** (saved baseline of structure + a masked screenshot). If a page loses a
section in a refactor/migration, its spec fails. Plan + status:
`workspace/tasks/queued/platform-e2e-test-suite.md`.

## Run
```bash
cd workspace/browser-qa
npx playwright test tests/e2e/portfolio.spec.mjs        # one page (while iterating on it)
npm run e2e:portfolio                                   # same, via script
npm run test:all                                        # whole gate (production / CI)
npx playwright test tests/e2e/portfolio.spec.mjs -u     # re-baseline ONE page after an intended change
```

## Env (must be up)
- Drive the **Caddy gateway `:6969`** (`ASTRO_BASE_URL`) — same-origin `/api`, no CORS.
  Backend `:3001` (`BACKEND_BASE_URL`).
- `AUTH_DEV_OTP_EXPOSED=true` — dev OTP `devCode` from `/api/auth/start`.
- Authed specs reuse a cached session (`OMRIB_STATE` in tmp) to dodge the auth/start
  rate limit. If auth fails with a stale cookie, delete that tmp file and re-run.

**Authed spec auth pattern (Playwright 1.60 — do exactly this):**
```js
import { OMRIB_STATE, ensureOmribStorageState } from './fixtures/contexts.mjs';
await ensureOmribStorageState();          // top-level await — mints/caches the session file
test.use({ storageState: OMRIB_STATE });  // NOT beforeAll: 1.60 resolves this before any fixture
```
`portfolio.spec.mjs` is the reference. Do NOT use `beforeAll(ensureOmrib)` + `test.use` —
in 1.60 `test.use({ storageState })` resolves the file before `beforeAll`'s fixtures build,
so the file must already exist at import time.

## Per-page template (every spec follows this)
1. **Load** — `goto` via `astroBase`, assert SSR 200 + main visible.
2. **Flow** — drive the page's real action (trade, edit+save, post, range switch,
   overlay open/dismiss); assert the result functionally. Do this BEFORE the pixel
   snapshot only if it doesn't mutate visible state — otherwise snapshot the stable
   load state first, then run the mutating flow.
3. **Structure regression** — pick by page type:
   - **Content pages** (help, legal, static copy): `toMatchAriaSnapshot` — text IS the
     content, so the aria tree is a stable, meaningful baseline.
   - **Data pages** (portfolio, market detail, profile, feeds): explicit landmark
     assertions — assert the key sections/controls exist by `data-*`/role (chart,
     ranges, tables + their headers, ticket). Do NOT full-aria-snapshot these: live
     numbers in accessible names drift every run.
4. **Pixel regression** — `snap(page, '<page>.png', { mask })` (helper stabilizes +
   shoots full page). Mask live regions: `chromeMasks(page)` (wallet) + the chart +
   any live numbers/relative timestamps.
5. **Hygiene** — `installConsoleGate(page)` at top, `gate.assertClean()` at end. No
   horizontal overflow @390 and @360.

## Fixtures
- `fixtures/contexts.mjs` — `ensureOmrib(browser)` + `OMRIB_STATE` (authed), `astroBase`,
  `backendBase`. Guest = default context.
- `fixtures/console-gate.mjs` — `installConsoleGate(page, {allow})`.
- `fixtures/screenshot.mjs` — `snap`, `stabilize`, `chromeMasks`.
- Account: `omrib@navi.local` (handle `mrbz`), data-rich. Position seeding helpers in
  `../auth-helpers.mjs` (`createPosition`, `createPositionInOpenSeededMarket`).

## Front-only surfaces
`/community` (+ thread) and achievements badges have no backend — assert render +
in-memory interaction, NOT persistence. Marked front-only in those specs.
