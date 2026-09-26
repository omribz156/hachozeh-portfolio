# Seer

Updated:
- 2026-05-27

Status: current
Owner: lifecycle / seer lane

Naming note:
- this runtime is `Seer`
- current runtime path is `systems/seer/`
- product Discovery remains the frontend browse/feed surface
- read `workspace/tasks/reference/seer-rename-preflight.md` before renaming paths or symbols

Purpose:
- first runtime home for the agent subsystem
- keep the CLI-first market-sensing loop visible as its own project slice
- make later extraction into a separate service cheaper if it grows fangs

Current stance:
- CLI-first
- review-first
- live/planned source intake
- review queue before creation
- creation drafts before backend materialization
- no auto-publish

Owns:
- source intake runtime
- signal clustering/proposal/review runtime
- creation-draft generation
- operator gateway flow

Does not own:
- publish authority
- trusted market mutation
- Oracle evidence/review truth

Read with:
- `workspace/docs/agents/seer/README.md`
- `workspace/docs/agents/seer/market-factory-doctrine-v1.md`
- `workspace/docs/agents/seer/contract-shape-v1.md`
- `workspace/docs/agents/seer/production-readiness-v1.md`
- `workspace/docs/agents/seer/state-hygiene.md`
- `workspace/docs/agents/shared-source-model-v1.md`
- `systems/back/docs/current-status.md`
- `systems/seer/HOW-TO-HELP.md`
- `workspace/tasks/reference/seer-rename-preflight.md`

Use this doc for:
- runtime identity
- command entry
- current active agent runtime truth

Operator help:
- gateway script: `./systems/seer/seer-gateway.sh`
- Windows one-click gateway: `systems/seer/seer-gateway.cmd`
- helper manual: `systems/seer/HOW-TO-HELP.md`
- backend materializer: `npm --prefix systems/back run seer-create -- --help`
- compact agent publisher: `npm --prefix systems/back run market:agent -- --help`

Run from the repo root with backend tooling for now:

```bash
./systems/seer/seer-gateway.sh
npm --prefix systems/back run seer -- --help
npm --prefix systems/back run seer -- source-add --label "Bank of Israel RSS" --url "https://www.boi.org.il/" --class authority --stages grounding\|review --categories economy --jobs ground-confidence\|anchor-resolution --authority official --lifecycle rate_direction/cut_hold_hike/manual_resolution_required
npm --prefix systems/back run seer -- operator-lead-add --raw-prompt "Use this close-EOL market as a shape reference." --lead-url "https://polymarket.com/event/example" --lead-source-type external_market --lead-role shape_reference --expected-lane live
npm --prefix systems/back run seer -- operator-leads
npm --prefix systems/back run seer -- import-signals --file ./my-signals.jsonl
npm --prefix systems/back run seer -- sources --json
npm --prefix systems/back run seer -- market-families --json
npm --prefix systems/back run seer -- family-readiness --json
npm --prefix systems/back run seer -- intake-log --json
npm --prefix systems/back run seer -- heartbeat --json
npm --prefix systems/back run seer -- heartbeat --bridge-only true --json
npm --prefix systems/back run seer -- platform-shapes --json
npm --prefix systems/back run seer -- platform-shapes --as-signals --json
npm --prefix systems/back run seer -- scan --json
npm --prefix systems/back run seer -- review-queue --json
npm --prefix systems/back run seer -- queue-latest --json
npm --prefix systems/back run seer -- review-feedback --review-item rh_boi_mar_2026_direction --candidate-market cm_boi_mar_2026_direction --action approve --reason-category good-as-is --reason-summary "clean first pass"
npm --prefix systems/back run seer -- planned-registry
npm --prefix systems/back run seer -- family-requests --json
npm --prefix systems/back run seer -- family-requests-latest --json
npm --prefix systems/back run seer -- create-drafts --json
npm --prefix systems/back run seer -- draft-readiness --json
npm --prefix systems/back run seer-create -- list --json
npm --prefix systems/back run seer-create -- materialize --all --json
npm --prefix systems/back run seer-create -- publish --draft <creation-draft-id>
npm --prefix systems/back run market:agent -- drafts
npm --prefix systems/back run market:agent -- ship --draft <creation-draft-id> --market-environment prod
npm --prefix systems/back run market:agent -- ship --draft <creation-draft-id> --market-environment prod --execute --json
workspace/scripts/render-market-agent-job.sh --draft <creation-draft-id>
workspace/scripts/render-market-agent-job.sh --draft <creation-draft-id> --execute-render-job
```

Current commands:
- `import-signals`
- `intake-log`
- `heartbeat`
  - `--bridge-only true` keeps the source-fetch/import pass but skips review-queue and creation-draft rebuilds for lightweight runtime checks
- `platform-shapes`
  - pulls external Poly/Kalshi examples as reference-only contract craft samples
  - examples are tagged by `contractPattern` and `familyHint`
  - combo/noise examples are filtered out of the default craft sample
- `operator-lead-add`
  - stores a human/operator lead receipt
  - intended for close-EOL external-market leads, news tips, official-source leads, or manual notes
  - lead source stays separate from resolution source
- `operator-leads`
  - lists stored lead receipts
- `source-add`
- `sources`
- `market-families`
  - lists the seeded market-family registry used before creation drafts
  - use this before adding one-off source logic
- `family-readiness`
  - operator view for family + source + adapter + lifecycle readiness
  - best current command for choosing source-backed next slices
- `scan`
  - kept as an operator inspection command for reading the raw candidate signal set before clustering
- `cluster`
  - kept as an operator inspection command for checking grouping/lineage before proposal shaping
- `propose`
  - kept as an operator inspection command for seeing proposal readiness before review-queue writes
- `review-queue`
- `queue-latest`
- `queue-history`
- `planned-registry`
- `planned-registry-history`
- `family-requests`
  - persists Seer -> Oracle source-family adapter requests
  - use `--include-manual true` when manual-resolution families should be listed as upgrade candidates too
- `family-requests-latest`
- `review-feedback`
- `feedback-log`
- `create-drafts`
- `draft-readiness`
- `drafts-latest`
- `drafts-history`

Operator inspection stance:
- keep `scan`, `cluster`, and `propose`
- they are not retired legacy commands
- use them when an operator wants to inspect raw signals, grouping, or proposal readiness before the normal `heartbeat` / `review-queue` path writes durable queue state
- do not use them as a replacement for `review-queue`, `create-drafts`, or backend materialization

## Runtime Notes

Important:
- this subsystem proposes
- it does not publish
- it does not mutate trusted market truth
- it now can emit backend-ready `market_creation_draft` objects after review, but still does not auto-publish
- gateway can now submit `review-feedback` interactively by queue number, not only display queue items
- gateway now also has a creation-draft step:
  - build post-review creation drafts
  - optionally materialize them into backend draft markets
  - explicitly publish chosen materialized drafts into open markets
  - if creation drafts are `0`, gateway now shows the readiness blocker stack instead of a blank shrug
- gateway output now has a first real TUI-style polish pass:
  - queue cards
  - action badges
  - wrapped text
  - numbered review menus
- imported manual signals now feed the real `scan` and `cluster` pipeline
- Google Trends note import now keeps article titles too, not only source URLs
- imported signals can also reach `propose` and `review-queue` when they include enough market-shape fields:
  - `question`
  - `marketForm`
  - `proposedOutcomes`
- `propose` now emits runtime market-worthiness assessment too:
  - dimension labels
  - review-readiness summary
  - explicit failure reasons when a candidate is still rough
- `review-queue` now carries the worthiness summary forward into handoff instead of only a plain yes/no vibe
- `review-queue` now parks contract-incomplete candidates before active review:
  - missing source URL
  - missing rule/source anchor
  - missing timeline / close shape
  - open fetch needs
- candidate/review cards and post-review creation drafts now carry `market_contract_v1`:
  - measurement
  - resolution source URL
  - resolution rule
  - timeline / parsed close
  - outcome map
  - delay / ambiguity / revision policy
  - review blockers
- review/readiness/draft summaries now surface contract source, parsed close time, and contract blockers first, so operators can separate contract-ready planned markets from noisy live/radar cards quickly
- golden market contract evals now cover:
  - BOI planned decision
  - Hormuz date-bucket data market
  - Winner League fixture
  - Knesset deadline
  - noisy shock-discovery card parked by contract blockers
- candidate/review cards now also carry a per-card source-role plan:
  - `wake`
  - `ground`
  - `resolve`
  - optional `integrity`
  - this turns the 4-source doctrine into an actual per-market fetch/verification plan
- reviewed feedback now spawns recorded `rework` attempts:
  - auto-revised candidates can come back to `active`
  - no-safe-fix candidates stay in `rework` with explicit reshape targets
  - clean `approve` feedback should not emit replay paperwork into `rework-log`
- `rework-log` now shows that replay memory directly
- `heartbeat` now fetches fresh Google Trending IL items from `https://trends.google.com/trending/rss?geo=IL`
- `platform-shapes` now fetches live reference markets from:
  - Polymarket `gamma-api`
  - Kalshi public `trade-api`
  - this is a separate shape/data lane, not a truth or heartbeat lane
  - the purpose is operator/model perception of how mature markets package title, rule, source, timeline, and edge cases
  - it now classifies reference examples into standard contract / recurring template / multi-market event / combo-noise patterns
  - Kalshi combo/MVE soup is useful as a warning label, not as the default creation target
  - `--as-signals` exists for research/debug import only; not default Seer intake
- `heartbeat` is now intentionally narrowed to the current live pillars:
  - Google Trending IL as the local wake layer for politics / sports / economics attention
  - IBBA official feed for forward-looking schedule / return-to-play / tournament notices
  - Winner League schedule/game data for near-window local fixtures
  - BOI planned-event intake now uses the official rate-announcement dates page and takes the next upcoming decision window
  - resolved BOI decision releases are suppressed from heartbeat fallback parsing
- non-live source fetchers may exist in code or roadmap docs, but they are not heartbeat-live until they are registered in `systems/seer/src/heartbeat.ts`
- paused / roadmap heartbeat sources for now:
  - Home Front
  - IAA
  - Fed
  - ECB
  - USGS
  - GDACS
- roadmap source packs from `workspace/docs/agents/seer/fetch-roadmap-v1.md` are now seeded into `sources` with `planned-fetch` flags
- shared source/fetch semantics now live in `workspace/docs/agents/shared-source-model-v1.md` for Seer + Oracle
- Mac scheduler helper now exists at `systems/seer/install-heartbeat-launchd.sh`
- repo-owned heartbeat runner now exists at `systems/seer/seer-heartbeat.sh`
- launchd stdout/stderr now write under `workspace/runtime/seer-heartbeats/`, not `systems/seer/state/`
- Seer append-only state logs rotate at 10 MB by default; override with `SEER_STATE_MAX_HISTORY_BYTES`
- Seer heartbeat launchd logs rotate at 10 MB by default; override with `SEER_HEARTBEAT_MAX_LOG_BYTES`
- current Mac heartbeat schedule is fixed local time:
  - `00:00`
  - `06:00`
  - `12:00`
  - `18:00`
- live fetch truth:
  - Google Trending IL is live
  - IBBA is now live with conservative planned-event filtering
    - keeps official resumption / draw / schedule-style notices
    - rejects recap / player-feature / score-summary soup
    - live IBBA signals now carry `grounding: ibba-update-kind=...`
  - Winner League is live for local fixture warming
  - BOI is only allowed through heartbeat when it looks like a forward-looking planned-event notice, not a resolved decision release
  - stale hardcoded BOI March seed signals are gone; BOI should now come from live planned-event timing truth
  - BOI planned-event shaping now uses a recurring template seam:
    - current template: `boi-rate-decision-v1`
    - same card mechanics, fresh date + source refs
    - month-forward headline plus explicit bps buckets
    - close shape now carries the official `16:00` publication time when BOI provides it
    - recurring warm-up policy now keeps the next `3` official BOI windows alive
    - template id now survives into candidate/review objects
  - Fed / ECB central-bank decision templates are now runtime-ready too:
    - `fed-rate-decision-v1`
    - `ecb-rate-decision-v1`
    - not live planned schedulers yet; ready once we ingest explicit future decision dates
  - Fed / ECB / USGS / GDACS fetch helpers exist, but they are paused from the heartbeat runner until explicit source policy says otherwise
  - gov.il stays planned for now because machine fetch is Cloudflare-blocked
  - IDF / MDA / IMF are still blocked or not worth fake-live treatment from this runtime
- Seer scan/gateway now surface `planned-event` vs `shock-discovery` explicitly instead of hiding lane choice inside tags/notes
- local Israeli sports source pack now exists in the registry as planned fetch/wake candidates:
  - official: IFA, IBBA, Winner League, ITA
  - wake-only: Sport5, ONE
  - runtime note: IFA currently looks Cloudflare-blocked from this machine path; IBBA looks like the best first local official fetch target
  - the rest of the roadmap pack is visible in registry, but not fetched yet
- sports enrichment now uses Google Trends coverage evidence for better grounding:
  - note titles + URLs can help infer fixture context
  - recent sports-ish Google Trends signals can also do a tiny linked-page follow-up fetch during normalization
  - follow-up page reads are byte-bounded and manual-signal normalization is sequential, so scan/propose do not fork-bomb external coverage pages
  - that v1 follow-up can close `exact-event-date` / `competition-name` when page metadata is kind
  - settlement-rule gaps still stay explicit in `fetch`
  - dated matchups now carry dated questions
  - rematches can split by date instead of merging forever
  - past inferred fixtures should not draft into market proposals
  - merged duplicate variants now prefer the strongest grounded sibling instead of carrying every weaker sibling fetch note
  - active review queue now ranks sports drafts by grounding quality before auto-draft capping:
  - explicit event date beats observed-window date
  - competition-grounded matchups beat bare fixture buzz
  - weaker provisional sports drafts sink first when the queue gets crowded
  - official planned-event cards with zero fetch debt now outrank shock-discovery sports cards that still carry fetch debt
  - active queue now also treats lane shape explicitly:
    - planned-event is the wide recurring/base lane
    - shock-discovery is the tight fast-break lane, capped to a small number of active items
    - recurring planned-event candidates now have a separate active cap from found/shock markets
    - recurring planned-event families still have a live sibling cap, so one hot series does not eat the whole review surface
  - Winner League planned-event warm-up now keeps the nearest short official fixture window alive instead of a one-round stub
  - stale dated events now drop out of queue sections entirely once their inferred event/deadline has passed
  - they should not be rehomed into `reviewed` just for archive vibes
  - grounded sports drafts now also carry recurring family ids:
    - `sports-match-winner-v1`
    - `sports-regulation-3way-v1`
  - sports family guardrail is now family-based, not sport-by-sport hardcode:
    - `sports-match-winner-v1`
      - no draw bucket
      - use for basketball, tennis, cricket, MMA/boxing, esports, and similar winner-only matchups
    - `sports-regulation-3way-v1`
      - `Team A / Draw / Team B`
      - use only when settlement is explicit regulation-time football/soccer style
    - if the sport/settlement family is unclear, keep it in `follow-up-needed`
- review items now carry the missing creation fields too:
  - category
  - close shape
  - resolution anchor
  - sensitivity level
- new continuation seam now exists after review:
  - `create-drafts` reads reviewed feedback + queue history
  - `draft-readiness` explains why reviewed items did or did not cross that gate
  - only local-priority categories can cross:
    - `economy`
    - `sports`
    - `politics`
  - draft gate is strict:
    - latest review action must be `approve` / `approve-with-edits`
    - `fetchNeeds` must be empty
    - close shape must parse into a real `closeAt`
    - ground + resolve source roles must exist
  - output is persisted as backend-ready `market_creation_draft` snapshots:
    - latest: `systems/seer/state/market-creation-drafts-latest.json`
    - history: `systems/seer/state/market-creation-drafts-history.jsonl`
  - this is the first real bridge past scan/review, but still one step before admin market creation / publish
- backend materialization seam now exists too:
  - `npm --prefix systems/back run seer-create -- list`
  - `npm --prefix systems/back run seer-create -- materialize --draft <creation-draft-id>`
  - `npm --prefix systems/back run seer-create -- materialize --all`
  - `npm --prefix systems/back run seer-create -- publish --draft <creation-draft-id>`
  - compact agent wrapper:
    - `npm --prefix systems/back run market:agent -- drafts`
    - `npm --prefix systems/back run market:agent -- ship --draft <creation-draft-id> --market-environment prod`
    - add `--execute` only after reading the dry-run plan
    - for Render production, prefer `workspace/scripts/render-market-agent-job.sh --draft <creation-draft-id> --execute-render-job`; it runs the mutation as a backend one-off job with internal DB access
  - each `market_creation_draft` now carries two separate knobs:
    - `liquidityB` for market shape
    - `seedAmount` for publish funding
    - explicit `familyKey` for backend family/date rails:
      - recurring BOI/Fed/ECB series keep their stable series key
      - matchup families prefer lineage-derived keys instead of generic sports template ids
      - non-ascii lineage families are normalized into deterministic backend-safe ids
  - publish now defaults to draft `seedAmount`, not draft `liquidityB`
  - Seer computes `liquidityB` by recurring family / outcome width instead of one hardcoded blob for every market
  - BOI / central-bank recurring drafts now emit explicit bucket outcome ids instead of backend auto-slug fallback goblins
  - materialization writes backend draft markets through `createMarketDraft`
  - if an older Seer market for the same candidate was already closed/resolved, rerun materialization now mints the next versioned market id (`...-v2`, `...-v3`, ...)
  - run history is stored at:
    - `systems/seer/state/market-creation-materializations-latest.json`
    - `systems/seer/state/market-creation-materializations-history.jsonl`
  - still no auto-publish; created markets remain backend `draft` status

## Current Persistence

Current persistence:
- append-only manual source log at `systems/seer/state/source-registry.jsonl`
- append-only manual signal log at `systems/seer/state/manual-signals.jsonl`
- append-only operator lead log at `systems/seer/state/operator-leads.jsonl`
- latest operator lead index at `systems/seer/state/operator-leads-latest.json`
- append-only review feedback log at `systems/seer/state/review-feedback.jsonl`
- append-only rework attempt log at `systems/seer/state/rework-attempts.jsonl`
- append-only queue history at `systems/seer/state/review-queue-history.jsonl`
- latest queue snapshot at `systems/seer/state/review-queue-latest.json`
- planned registry history at `systems/seer/state/planned-registry-history.jsonl`
- latest planned registry at `systems/seer/state/planned-registry-latest.json`
- source-family request history at `systems/seer/state/source-family-requests-history.jsonl`
- latest source-family request snapshot at `systems/seer/state/source-family-requests-latest.json`
- latest platform shape reference snapshot at `systems/seer/state/platform-shapes-latest.json`
- market creation draft history at `systems/seer/state/market-creation-drafts-history.jsonl`
- latest market creation drafts at `systems/seer/state/market-creation-drafts-latest.json`
- backend materialization history at `systems/seer/state/market-creation-materializations-history.jsonl`
- latest backend materialization run at `systems/seer/state/market-creation-materializations-latest.json`
- market publication history at `systems/seer/state/market-publications-history.jsonl`
- latest market publication run at `systems/seer/state/market-publications-latest.json`

State hygiene:
- `systems/seer/state/` is ignored runtime state, not repo truth
- exclude it from code/doc audits:
  - `rg "pattern" systems/seer workspace/docs/agents/seer --glob '!systems/seer/state/**'`
- see `workspace/docs/agents/seer/state-hygiene.md`
- latest heartbeat result at `systems/seer/state/heartbeat-latest.json`
- append-only automation audit log at `systems/seer/heartbeat-audit-tuning-log.md`

## Automation Guardrail

- heartbeat-audit automation should write to `systems/seer/heartbeat-audit-tuning-log.md` only
- no unsupervised code/doc/state edits from that automation lane
