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
- [ ] Static build with no production API, credentials or database dependency.
- [ ] Curated public data and synthetic portfolio; reviewed media only.
- [ ] Functional browsing, filters, search, market detail and chart interactions.
- [ ] Explicit read-only/archive states instead of misleading live controls.
- [ ] Desktop/mobile click-and-scroll QA, usable loading and no overflow.
- [ ] Output privacy/security checks and repository CI.
- [ ] Cloudflare preview verification.
- [ ] Public domain cutover and redirect/share-preview verification.
- [ ] Original infrastructure retirement confirmed in the private ops record.
- [ ] Final commit/deployment receipts and documented limitations.

## Verification Record

Initial source revision: 3f199098652eaf4ca2bb4ee5c65743299b983ae9.
Migration branch: codex/static-showcase.

No migration build, preview deployment, domain cutover or cost reduction is
claimed yet. Update this section with actual tested revisions and results as
each gate passes. Private backup/restore and retirement details are recorded
separately by the maintainer; only sanitized completion status belongs here.
