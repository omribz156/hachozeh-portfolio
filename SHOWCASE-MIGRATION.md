# Static Showcase Migration

Started: 2026-11-05
Status: in progress. The live domain has NOT switched to the static showcase yet.

## Purpose

Preserve Hachozeh as a browsable portfolio project without operating a live
prediction-market service. Keep the established Hebrew/RTL design, mobile
navigation, representative market pages and charts, and a synthetic portfolio.

The planned Cloudflare deployment will serve static HTML/assets with selected
browser-local interactions. Login, email codes, real account balances, trading,
live feeds and automated settlement will not run on the showcase. Historical
values will be labelled as a dated snapshot; demo values will be labelled as such.

The original platform source and local evaluation instructions remain available.
The public repository remains a reviewed source snapshot, not a copy of private
production history. Existing media substitutions and third-party notices remain
in force. Production credentials, backups, personal data and operational records
must never be included in this repository or deployment.

## Checklist

- [x] Migration scope and public/private documentation boundary recorded.
- [x] Static build with no production API, credentials or database dependency.
- [x] Curated public data and synthetic portfolio; reviewed media only.
- [x] Local functional browsing, filters, search, market detail and charts.
- [x] Explicit read-only/archive states instead of misleading live controls.
- [x] Local desktop/mobile click-and-scroll QA and narrow-screen overflow checks.
- [x] Output privacy/security checks and repository CI.
- [ ] Cloudflare preview verification.
- [ ] Public domain cutover and redirect/share-preview verification.
- [ ] Original infrastructure retirement confirmed in the private ops record.
- [ ] Final commit/deployment receipts and documented limitations.

## Verification Record

Initial source revision: 3f199098652eaf4ca2bb4ee5c65743299b983ae9.
Migration branch: codex/static-showcase.

2026-11-05 local candidate:

- Separate static Astro entrypoint: `systems/web/astro.showcase.config.mjs`.
  Original SSR application remains available, not converted in place.
- Allowlisted public snapshot: 17 cards, 22 markets, five event routes; no user
  records, sessions, private trades, emails or production credentials. Portfolio
  positions/history are synthetic. Images use the reviewed project-owned buckets.
- 38 generated pages; 1,234 local link/asset references validated at build time.
- CSP blocks all backend connections (`connect-src 'none'`); inline scripts use
  hashes. No live authentication, orders, polling or analytics in this build.
- Click/scroll QA at 1440px, 390px and 320px: sticky header, filters, search,
  sorting, event-to-market navigation, trust accordion, portfolio search/range.
  No JavaScript/resource errors or API/non-GET requests in those flows.
  All generated index routes checked at 320px, plus an intentional 404.
- Timing receipts are local-only, not evidence of internet performance. Browser
  verification against the deployed preview is still required.
- Fresh production backup restored privately in isolation; no blocker-level
  integrity findings. Historical lifecycle warnings remain archived, not settled.
- Secret scan of showcase source passed with exact, path-scoped false-positive
  exceptions for four public market slugs; the generated artifact also passes.
- Clean install, full npm audit (zero advisories), dependency compatibility tests,
  original SSR build and static check/build pass. Grouped chart identities are
  distinct; series selection, range switching and settings are exercised by QA.
  Final staged review and hosted CI passed for the candidate below.

Candidate: `d4920fc01e743eeb5977b791e01858326d3026b8`.
Hosted verification: [platform tests/security](https://github.com/omribz156/hachozeh-portfolio/actions/runs/41996141186),
[static showcase QA](https://github.com/omribz156/hachozeh-portfolio/actions/runs/41996141198).
Includes 256 backend test files / 1,756 tests passing; original web check/build,
security gates, and static responsive/browser checks passing. The first CI run
caught a missing optional YAML lockfile entry; restored and verified on Node 22.

The clean candidate artifact contains `/showcase-release.json` with its revision,
snapshot date and build date. Cloudflare project `hachozeh-showcase` was created;
artifact upload is pending browser permission/manual upload. No preview URL is
claimed functional yet.

Follow-up compatibility check: legacy discovery URLs (`/new-markets`,
`/breaking-markets`, `/closing-markets`, `/markets`, `/trending`) and old Q&A
links redirect to the matching archive surfaces. Fourteen literal redirect rules
and their destinations pass local QA. These rules still need verification on
Cloudflare after upload; local emulation is not edge-provider proof.

No preview deployment, domain cutover, infrastructure retirement or cost reduction
is claimed yet. Private backup details remain outside this repository.

## Reproduce

```sh
npm ci --ignore-scripts
npm run showcase:check --workspace @navi/web
npm run showcase:build --workspace @navi/web
npx playwright install chromium
npm run showcase:qa --workspace @navi/web
```

Deploy only `systems/web/showcase-dist`, never the repository root or SSR output.
The QA runner serves an ephemeral loopback-only site and stops it on completion.
Capture is explicit (`showcase:capture`), not part of the offline build; review
every refreshed snapshot before publishing. Do not add private database exports.
