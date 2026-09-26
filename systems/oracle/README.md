# Oracle

Updated:
- 2026-05-27

Status: current
Owner: lifecycle / oracle lane

Purpose:
- identify the Oracle runtime subsystem
- give quick ownership boundaries and read paths
- keep evidence/review authority separate from trusted mutation authority

Oracle is a real subsystem.

Owns:
- evidence intake
- review queue
- lifecycle-run and lifecycle-heartbeat operator loops

Does not own:
- trusted mutation authority
- settlement
- generic HTTP hosting

Read with:
- `workspace/docs/agents/oracle/README.md`
- `workspace/docs/agents/oracle/lifecycle-adapters.md`
- `workspace/docs/agents/oracle/lifecycle-worker-production-runbook.md`
- `workspace/docs/agents/shared-source-model-v1.md`
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/current-status.md`

Use this doc for:
- subsystem identity
- runtime placement
- quick read path into Oracle doctrine and backend seams

## Fast Start

Start here for lifecycle runtime work:
- canonical command map: `workspace/docs/agents/lifecycle-command-map.md`
- lifecycle command index: `workspace/scripts/lifecycle-ops.sh --help`
- worker health: `npm --silent --prefix systems/back run oracle:lifecycle-worker:status -- --json`
- current pipeline dry run: `npm --prefix systems/back run oracle -- lifecycle-run --dry-run true --limit 100 --json`
- source-family agreement: `npm --prefix systems/back run oracle -- family-route-audit --json`
- review inbox: `npm --prefix systems/back run oracle -- resolve-inbox --json`
- open-market doctor: `workspace/scripts/lifecycle-ops.sh open-doctor --market <market-id>`
- production close-condition cases:
  - inspect only: `workspace/scripts/lifecycle-ops.sh close-inspect --expect-count <n>`
  - approve after operator/user approval: `workspace/scripts/lifecycle-ops.sh close-approve --expect-count <n>`
- production resolution cases:
  - inspect only: `workspace/scripts/lifecycle-ops.sh resolution-inspect --expect-count <n>`
  - approve after operator/user approval: `workspace/scripts/lifecycle-ops.sh resolution-approve --expect-count <n>`
- independent event partial-resolution proof: `workspace/scripts/lifecycle-ops.sh event-partial-smoke`
- source/family truth: `workspace/docs/agents/lifecycle-readiness-map.md`

Thin admin read surfaces mirror operator status without mutating state:
- `GET /admin/oracle/lifecycle-worker/status`
- `GET /admin/oracle/family-route-audit?sourceId=<source-id>`
- `GET /admin/oracle/capability-check?sourceId=<source-id>&measurementKind=<kind>&resultShape=<shape>`

Current packaging:
- runtime code lives under `systems/oracle/src/`
- operator front door is `systems/oracle/oracle-gateway.sh`
- durable production worker wrapper is `systems/oracle/oracle-lifecycle-worker.sh`
- backend still provides the shared Node toolchain and HTTP surface from `systems/back/`
- Oracle lifecycle operation should start from `lifecycle-run` / `lifecycle-heartbeat`.
- retired shared-source compatibility commands (`source-plan`, `source-poll`, `heartbeat`, `cycle`, `source-sweep`) were removed; use lifecycle-run, family-route-audit, resolve-inbox, review-queue, and case-detail instead.

Current trusted-action handoffs:
- `approve-close-condition-case` hands a human-approved Oracle close-condition case to Horizon with `oracle_confirmed_event_completion`
- `approve-resolution-case` hands a human-approved Oracle resolution case to trusted resolve
- `operator-resolve` is the cleanup/manual intake front door:
  - creates a normal Oracle `resolution_check` case first
  - modes: `test`, `official`, `manual`
  - `test` mode is only allowed for synthetic/test/stress/gauntlet markets
  - approval is explicit with `--approve true`; otherwise it returns an approval command
  - still settles only through `approve-resolution-case` / trusted resolve, not beside Oracle
- `operator-observed-event` is the admin/operator observation front door:
  - writes a deduped `lifecycle_events` row with `event_type=operator_observed_outcome`
  - marks the event as `operator_observed` context only
  - does not create an Oracle case, approve, resolve, or settle
  - use it when an event appears over before official source publication, then let official/fallback Oracle flow reconcile later
- `void-market` is the operator escape hatch for invalid markets:
  - moves an un-resolved market to `status=voided`
  - writes `market_voided` audit and lifecycle receipts
  - removes the market from closed-unresolved Oracle pressure without pretending a winner exists
  - use it for bad wording/source/timing contracts that must be superseded, not for normal resolution
- `official-final-intake` scans closed unresolved markets through lifecycle source adapters, maps normalized official truth to an existing outcome, and creates a human-gated resolution case
- official final intake maps adapter `evidenceKey` through `market_contract.outcomeMap[]` first; source-family label/position matching is legacy fallback only
- lifecycle source adapters are source-family interpreters, not market-specific patches:
  - primary routing uses Seer `market_contract.resolutionSource.sourceIds + measurementKind + resultShape + oracleCapability`
  - URL matching remains a fallback/fetch target, not the source-family taxonomy
  - `family-route-audit` compares Seer registry capabilities against Oracle adapters and catches route drift before publish
  - `oracleCapability=blocked` is an explicit lifecycle blocker
  - `oracleCapability=manual_resolution_required` is parked while the market is open/future without dirtying worker warnings, then becomes a blocker after close until explicit manual Oracle handling exists
  - NBA official game page: close-condition + final-result support
  - Niké Liga official match page: close-condition + final-result support
  - Bank of Israel official rate decision: final-result support through `market_contract.outcomeMap[].evidenceKey`, including binary unchanged-rate yes/no contracts
  - TradingView live FX snapshots: final-result support through `src_tradingview_fx`; contracts must include a TradingView symbol trust URL plus timestamped `machineResolutionEndpoint`. TradingView scanner output may be used only behind a Hachozeh snapshot wrapper that records observed time/raw/hash; it is not an official backend quote API contract.
  - IMS daily observations: final-result support for weather threshold markets through `src_ims_daily_observations`; live fetch requires `IMS_API_TOKEN`
  - Eurovision official scoreboard: final-result support for binary winner/rank/jury/televote/last-place markets through `src_eurovision_official`
  - Winner League basketball: close-condition + final-result support through `src_winner_league_basketball`
  - unsupported official sources are explicit lifecycle blockers, not clean no-ops
  - adapter extension guide: `workspace/docs/agents/oracle/lifecycle-adapters.md`
- review actions are idempotent at the Oracle review layer:
  - completed retries replay the existing review result
  - attempted retries return `oracle_review_action_in_progress`
  - failed retries return `oracle_review_action_failed`; retry with a new key
- `lifecycle-heartbeat`, `alerts`, and `official-final-intake` still do not auto-approve or auto-resolve.
- optional operator reminders may send one mobile nudge per newly-actionable closed market:
  - enable with `ORACLE_OPERATOR_REMINDERS_ENABLED=1`
  - Telegram delivery uses `ORACLE_TELEGRAM_BOT_TOKEN` + `ORACLE_TELEGRAM_CHAT_ID` from private env
  - local proof can use `ORACLE_OPERATOR_REMINDER_CHANNEL=stdout`
  - Telegram has only two user-facing lifecycle message types: `market closed` and `market case ready`
  - `market closed` is held for `ORACLE_OPERATOR_CLOSED_NOTICE_GRACE_MINUTES` (default 10) so fast evidence markets usually produce only the ready-case nudge
  - `market closed` is contract-aware: `event_full_cycle` markets include `timeline.expectedResolutionAt`, while `scheduled_measurement` markets wait until that time before sending a closed/no-case nudge
  - reminders are deduped in `oracle_operator_reminders`; heartbeat repeats do not resend the same market-closed or market-case-ready reminder
  - reminders never approve, resolve, or settle

TradingView FX snapshot loop:
- manual capture, when needed:
  `npm --prefix systems/back run oracle -- capture-tradingview-fx-snapshot --market <market-id> --symbol USDILS --observed-at <iso> --json`
- the command writes `lifecycle_events.event_type=source_snapshot_captured` with `objectType=tradingview_fx_snapshot_v1`, raw scanner payload, raw hash, `observedAt`, `fetchedAt`, price, bid/ask, and symbol identity.
- final-point contracts should point `machineResolutionEndpoint` at the returned `hachozeh://oracle/tradingview-fx-snapshot?market=...&symbol=...&at=...` URL.
- window-crossing contracts should point `machineResolutionEndpoint` at `hachozeh://oracle/tradingview-fx-snapshot?market=...&symbol=...&from=...&to=...`, set `timeline.fxObservationMode=window`, and set `timeline.fxObservationCadenceMinutes`.
- `lifecycle-run` automatically captures missing TradingView FX snapshots for provenance-clean closed markets before final evidence intake. This is source creation, not source lag: the close-time snapshot is the source artifact.
- `lifecycle-run` also captures open-market TradingView observations for window contracts while `now` is inside the window and the latest stored observation is older than the configured cadence.
- `official-final-intake` resolves `src_tradingview_fx` endpoints from stored snapshots directly through the DB-backed fetcher; no local HTTP server hop is required.
- legacy shared-source heartbeat/cycle/source-poll views are retired; production lifecycle work starts from `lifecycle-run` / `lifecycle-heartbeat`.
- persisted inspections replay an existing active Oracle case instead of inserting duplicate cases for the same market / case type / winning outcome or close condition
  - rejected or more-evidence terminal cases may be replaced by fresh evidence
  - approved/recommended active cases block duplicate case breeding
- `lifecycle-run` is the first pipeline-spine command for agent/harness operation:
  - runs Horizon scheduled close sweep
  - exact-market runs scope Horizon scheduled close sweep to that market only
  - classifies source capability for open/closed markets
  - checks supported open markets for source-start / event-completion close conditions
  - creates or recommends human-gated close-condition cases before Horizon early close
  - checks close provenance from `market_closed` audit events
  - blocks resolution intake when close provenance is missing or invalid
  - runs adapter-backed final evidence intake only for provenance-clean closed unresolved markets
  - treats official-source lag as lifecycle context, not as an unsafe manual resolution action; after expected resolution time it writes a deduped `lifecycle_events` row with `event_type=official_source_not_ready`
  - emits stable action metadata with `riskLevel`, `safeToAutoExecute`, and `requiresExplicitApproval`
  - does not auto-approve or auto-resolve
- production scheduled-close ownership:
  - run `npm --prefix systems/back run horizon:scheduler` as a separate supervised worker
  - this worker is the primary clock reconciler for `open -> closed`
  - Oracle lifecycle still calls Horizon close sweep inside `lifecycle-run` for ordering and idempotent safety, but Oracle evidence/fetch health should not be required for scheduled closes
- lifecycle-run command:
  - `npm --prefix systems/back run oracle -- lifecycle-run --json`
  - dry-run form: `npm --prefix systems/back run oracle -- lifecycle-run --dry-run true --json`
  - exact-market form: `npm --prefix systems/back run oracle -- lifecycle-run --market <market-id> --json`
  - rehearsal time override: add `--now <iso>` to test scheduled-close/evidence behavior without DB surgery
- lifecycle-heartbeat command:
  - `npm --prefix systems/back run oracle -- lifecycle-heartbeat --json`
  - bounded multi-tick form: `npm --prefix systems/back run oracle -- lifecycle-heartbeat --max-ticks 3 --interval-ms 300000 --json`
  - reminder proof form: `ORACLE_OPERATOR_REMINDERS_ENABLED=1 ORACLE_OPERATOR_REMINDER_CHANNEL=stdout npm --prefix systems/back run oracle -- lifecycle-heartbeat --max-ticks 1 --interval-ms 0 --operator-reminders true --json`
  - streaming receipt form: `npm --prefix systems/back run oracle -- lifecycle-heartbeat --max-ticks 3 --interval-ms 300000 --jsonl`
  - rehearsal time override: add `--now <iso>` to pass the same operator clock through each tick
  - reports safe/unsafe action counts; approval and resolve actions remain explicit operator work
- raw bounded lifecycle worker command:
  - `npm --silent --prefix systems/back run oracle:lifecycle-worker`
  - runs `lifecycle-heartbeat` for up to 288 ticks at 5-minute intervals
  - emits one compact JSONL tick receipt per heartbeat tick, then one final heartbeat summary
  - persists each tick as `runtime_type=lifecycle-heartbeat` in `oracle_runtime_snapshots`
  - latest tick summary is exposed through `GET /health/diagnostics` at `runtime.latestLifecycleHeartbeat`
  - non-dry-run by design: it may run Horizon scheduled closes and create human-gated Oracle cases
  - still does not auto-approve close-condition cases, resolution cases, or settlement
  - use `--silent` when capturing JSONL so npm banners do not pollute the receipt file
- supervised local lifecycle worker wrapper:
  - start: `npm --silent --prefix systems/back run oracle:lifecycle-worker:start`
  - stop: `npm --silent --prefix systems/back run oracle:lifecycle-worker:stop`
  - restart: `npm --silent --prefix systems/back run oracle:lifecycle-worker:restart`
  - status: `npm --silent --prefix systems/back run oracle:lifecycle-worker:status`
  - tail receipts: `npm --silent --prefix systems/back run oracle:lifecycle-worker:tail`
  - one live tick: `npm --silent --prefix systems/back run oracle:lifecycle-worker:once`
  - one dry-run tick: `npm --silent --prefix systems/back run oracle:lifecycle-worker:dry-run`
  - writes PID/log/status under `workspace/runtime/oracle-lifecycle-worker/`
  - before each tick, sources `ORACLE_LIFECYCLE_WORKER_ENV_FILE` when set; otherwise it uses the local private-ops default `~/Projects/private-ops/navi/.env` if present
  - if operator reminders are enabled in that env file, live ticks send one-shot closed-market nudges after the lifecycle run
  - local `start` uses a `tmux` session when available so the worker survives Codex/shell command cleanup; set `ORACLE_LIFECYCLE_WORKER_USE_TMUX=0` to force plain `nohup`
  - uses `workspace/runtime/oracle-lifecycle-worker/worker.lock` to prevent duplicate supervisors
  - rotates `worker.jsonl` and `worker.err.log` at 10 MB by default; override with `ORACLE_LIFECYCLE_WORKER_MAX_LOG_BYTES`
  - default cadence: one persisted `lifecycle-heartbeat --max-ticks 1` every 5 minutes
  - default stale threshold: 10 minutes without a completed heartbeat
  - status supports text and JSON: `npm --silent --prefix systems/back run oracle:lifecycle-worker:status -- --json`
  - status and `/health/diagnostics` expose warning breakdown and warning items so source-lag/manual-parked markets are visible without reading JSONL logs
  - error behavior: log the failure, sleep 60 seconds, retry
  - still no approval/resolve/settlement authority; it only runs safe lifecycle work and creates human-gated cases
- production supervision:
  - service template: `systems/oracle/deploy/oracle-lifecycle-worker.service.example`
  - runbook: `workspace/docs/agents/oracle/lifecycle-worker-production-runbook.md`
  - production should run `oracle-lifecycle-worker.sh supervise` under systemd with `ORACLE_LIFECYCLE_WORKER_USE_TMUX=0`
- production official-final intake command:
  - `npm --prefix systems/back run oracle -- official-final-intake --limit 20 --json`
  - exact-market form: `npm --prefix systems/back run oracle -- official-final-intake --market <market-id> --json`
- family route audit command:
  - `npm --prefix systems/back run oracle -- family-route-audit --json`
  - exact-source form: `npm --prefix systems/back run oracle -- family-route-audit --source-id <source-id> --json`
  - local private env proof, when needed for credentialed adapters: `set -a; source ~/Projects/private-ops/navi/.env; set +a; npm --silent --prefix systems/back run oracle -- family-route-audit --json`
  - same rule for capability checks: source private ops env before checking `src_ims_daily_observations` or any other credentialed source; `credential_needed` without that env is an operator preflight issue, not a route blocker
- operator resolve command:
  - create case only: `npm --prefix systems/back run oracle -- operator-resolve --market <market-id> --mode test --winning-outcome-key <key> --reason-summary "<why>" --evidence-url <url-or-local-ref> --evidence-label "<label>" --json`
  - create and approve explicitly: add `--approve true --idempotency-key <key>`
- operator-observed event command:
  - `npm --prefix systems/back run oracle -- operator-observed-event --market <market-id> --summary "<what operator observed>" --observed-outcome-key <key> --source-url <url-or-local-ref> --source-label "<label>" --idempotency-key <key> --json`
- credible-reporting intake/evaluate commands:
  - `npm --prefix systems/back run oracle -- intake-credible-report --market <market-id> --source-id src_reuters --source-url <url> --claim-summary "<what this source says>" --winning-outcome-key yes --observed-at <iso> --json`
  - `npm --prefix systems/back run oracle -- credible-reporting-evaluate --market <market-id> --json`
  - imports only one external report at a time as a wait/review signal; evaluator still requires independent approved-source agreement and creates only human-gated recommendations
- `npm --prefix systems/back run oracle:eol-gauntlet` creates two dummy markets and proves scheduled EOL close, Oracle-confirmed early close, and Oracle-approved resolution in the local DB
- `npm --prefix systems/back run oracle:eol-smoke` runs the same proof as a repeatable smoke:
  - rejects a not-ready close-condition case before early close
  - proves one independent event child can early-close and resolve while the sibling remains open and the parent event remains active
  - asserts close / resolution output shape
  - cleans up its dummy markets by default
