# Backend Engine Decisions

Updated: 2026-05-27
Status: current
Owner: backend lane

Purpose:
- capture critical backend-engine decisions in plain language
- make later sessions faster and safer
- keep core engine rules durable outside chat

Read with:
- `systems/back/docs/README.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/horizon/README.md`

This doc owns:
- locked backend rules
- chosen policies
- non-negotiable boundaries

This doc does not own:
- live runtime status
- full engine walkthrough
- parked future ideas

## Core Principle

The backend should be separated by responsibility:
- `core market engine`
- `market management`
- `control plane`
- `Oracle layer`
- `Seer market-supply agent`
- `product discovery/search`

Rule:
- Seer suggests market supply
- product Discovery helps users find markets
- management prepares/publishes
- Oracle proposes truth transitions
- human oversight confirms sensitive cases
- engine enforces

## What The Core Engine Is

The core market engine is the trusted rules system for real markets.

It owns:
- market state
- outcome state
- pricing state
- trade execution
- balances and ledger state
- positions
- settlement and payouts
- lifecycle transitions for live markets

It does not own:
- topic discovery
- trend scanning
- AI market generation
- autonomous publish decisions
- admin content workflows

## Draft And Publish Boundary Decision

Draft creation and publish approval belong to `market management`, not the core engine.

Rule:
- management owns draft creation, editing, and readiness review
- management calls an explicit publish action into the engine
- the engine validates the publish transition and then owns live lifecycle behavior
- scheduled-event markets with an explicit `eventStartAt` must close before that start time; publish rejects `close_at >= eventStartAt` instead of relying on title/editorial discipline

This keeps content/admin work separate from trusted live-market state.

## Oracle Boundary Decision

Oracle and discovery are different jobs and should not be blurred together.

Rules:
- discovery finds ideas and attention signals
- Oracle checks real-world event status and proposes close/resolve evidence
- Oracle may trigger proposals for early close or resolution
- sensitive or disputed cases may require explicit human approval before settlement
- engine still owns the final structural validation and settlement execution

This keeps truth-checking separate from both market ideation and trusted money-state mutation.

Horizon note:
- deterministic close belongs under engine/Horizon truth
- it is not a peer agentic subsystem like discovery or Oracle

## Backend Architecture Decision

V1 backend should be one modular service, not an early microservice split.

Rules:
- use one Node.js + TypeScript backend runtime
- use PostgreSQL as the source of truth
- keep the HTTP route layer thin
- keep engine, economy, Horizon, Oracle, and DB concerns in separate modules inside the same app
- use SQL-first persistence with explicit transactions and locking
- keep async workers optional until settlement/Oracle/scheduling work is real enough to deserve the split

Practical stack direction:
- Node.js HTTP runtime
- TypeScript
- PostgreSQL
- SQL migrations
- Vitest for deterministic engine tests

Why:
- matches the trust-sensitive engine hot paths
- keeps idempotency + ledger + trade execution in one transactional authority
- stays small enough to reason about while the product is still forming

## Runtime Module Layout Decision

The runtime shell should adapt to the engine, not the other way around.

Rules:
- keep `src/http` as the API boundary because the scaffold already uses it
- keep `src/config`, `src/scripts`, `src/db/readiness.ts`, and `src/shared/logger.ts` in place when that avoids pointless churn
- let backend-truth modules drive the real structure under:
  - `src/engine`
  - `src/economy`
  - `src/lifecycle`
  - `src/oracle`
  - `src/db`
- split `src/http` further with:
  - `routes`
  - `schemas`
  - `presenters`
- keep repositories under `src/db/repos`
- keep transaction helpers under `src/db/tx`
- keep routes thin and keep domain logic out of `http`

Boundary note:
- logging/health runtime baseline may evolve in its own lane
- core engine truth should mainly land under `engine`, `economy`, `lifecycle`, and `db`
- runtime shell files should stay thin and route into those modules

Why:
- keeps the engine as the primary design authority
- respects work already landed
- avoids pointless renaming churn
- still gives the backend a clean long-term shape

## Market Shape Decision

Market objects should include enough fields for:
- trading correctness
- lifecycle correctness
- trust and resolution clarity
- future product growth

Rule:
- engine-critical fields stay explicit
- trust/product fields stay explicit when meaningful
- speculative future fields stay optional or under `metadata`

This avoids both:
- under-modeling
- schema junk-drawer syndrome

## Liquidity Depth Decision

LMSR `liquidity_b` is the current market depth control.

Rules:
- do not imply that historical volume means current depth
- do not silently rebase live-market depth
- live-market rebases must be dry-run first, preserve current probabilities, require an operator reason, and write audit truth
- choose new-market depth from market class and expected trade size, not from fixture defaults
- backend/admin and Seer draft creation must raise shallow candidate values to the backend recommended policy before a backend market draft is created
- explicit stress/test/toy markets may keep shallow depth for mechanics proof
- prove depth bands with quote/trade amount ladders before changing policy
- use `normal_public` (`b = 25,000`) as the default public-market posture unless a narrower class is explicitly chosen
- use `serious_economy_politics` (`b = 75,000`) for BOI, FX, elections, macro, and politics

Operational pointer:
- active calibration lives in `systems/back/docs/engine-cleanup-liquidity-depth-v1.md`
- local quote-only ladder: `npm --prefix systems/back run depth:lmsr-ladder`
- live read-only pool audit: `npm --prefix systems/back run depth:liquidity-audit`
- price-preserving rebase dry-run: `npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id>`
- creation guard: `systems/back/src/lifecycle/management/market-creation-liquidity.ts`
- Seer materialization guard: `systems/back/src/lifecycle/management/seer-market-creation-service.ts`
- named presets live in `systems/back/src/engine/pricing/liquidity-policy.ts`

## Horizon Fields Decision

Horizon policy must stay on the market aggregate.

V1 rule:
- do not create a separate persistence authority for Horizon policy
- close-related fields should live on the canonical market write model
- no generic manual close path exists in the trusted model

Required Horizon fields on the market aggregate:
- `status`
- `openAt`
- `closeAt`

Recommended Horizon fields on the market aggregate:
- `closedAt`
- `resolvedAt`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`

V1 semantics:
- `status` remains the lifecycle authority
- `openAt` and `closeAt` define the normal trading window
- `closedAt` records when the market actually stopped trading
- `resolvedAt` records when final resolution truth was fixed
- `closeOnEventCompletion` controls whether Oracle-confirmed event completion may stop trading before `closeAt`
- `eventCompletionCloseRequiresHumanApproval` controls whether that event-completion close may execute without explicit human approval

Important:
- `scheduled_time` close does not need an extra allow-flag
- no generic manual close path exists in v1
- do not store `lastCloseTriggerType` or similar history-on-row shortcuts; audit events already own that history
- do not add a separate `close_policy` table in v1 unless the whole market aggregate boundary is intentionally redesigned

Practical v1 posture:
- keep the persistent fields minimal
- keep richer trigger/evidence/approval context in command payloads and audit records
- one market row/write model remains the lifecycle source of truth

## Outcome Shape Decision

Outcomes are first-class entities.

They should not live only as a loose JSON blob forever, because they affect:
- pricing
- display ordering
- settlement
- portfolio positions

Each outcome should have:
- identity
- market ownership
- label
- ordering
- pricing state
- final winner state at resolution

## Outcome Identity Rule

Outcome identity is market-scoped.

Meaning:
- an outcome belongs to one market
- the same label in another market is still a different outcome
- positions and settlement point to a specific market outcome, not a floating global label

Example:
- `Gantz` in market A is not automatically the same entity as `Gantz` in market B

This keeps V1 safe from hidden cross-market coupling.
## Ledger Decision

Balance must not be treated as a loose mutable number.

Use an append-only ledger model.

Reason:
- easier audit
- easier trust
- safer recovery
- clearer settlement history

## Economy Policy Decision

`V-shekel` is a closed virtual economy with explicit issuance and retirement rules.

Rules:
- normal trading and settlement are transfers, not mint events
- mint events are privileged and should usually land in `platform_treasury`
- user grants should normally be treasury transfers, not direct mint-to-user shortcuts
- sink events are privileged and exceptional, not part of normal trading flow
- every mint, sink, and adjustment event must be auditable

This keeps money-supply changes rare, visible, and explainable.

## Faucet Policy Decision

User-facing rewards are faucet flows.
They should be modeled as explicit, ledger-backed transfers from
`platform_treasury` to `user_cash`, not direct balance rewrites.

Rules:
- the starter grant remains a one-time `1,000 V₪` first-account grant
- daily login streak claims use `Asia/Jerusalem` local dates
- the daily streak payout is a seven-day loop:
  - day 1: `100 V₪`
  - day 2: `150 V₪`
  - day 3: `200 V₪`
  - day 4: `250 V₪`
  - day 5: `300 V₪`
  - day 6: `350 V₪`
  - day 7: `400 V₪`
  - the next eligible claim loops back to day 1
- a missed streak window resets the next eligible streak claim to day 1
- if the previous local day was missed, a claim before `04:00 Asia/Jerusalem`
  may still continue the streak
- a login claim without an active open position may award a flat `25 V₪`, but
  it must not advance the streak tier
- the signup local day is covered by the starter grant; daily login claims start
  on the next `Asia/Jerusalem` local day
- a bankrupt user (`0 V₪` liquid balance and no active open positions) may
  claim an emergency `100 V₪` injection at most once per 24 hours
- faucet claims must be idempotent by user, faucet type, and claim window
- every faucet claim must create ledger and audit records
- grants are treasury-gated; `platform_treasury` must not silently go negative
- platform top-ups are allowed only as explicit ledgered operator actions
- future quests and achievements should reuse the same faucet infrastructure

This keeps retention rewards visible and tunable without creating hidden
inflation paths.

## Treasury Role Decision

Use distinct treasury roles in V1:
- `platform_treasury`
- `market_treasury`
- `mint_source`
- `sink`

Rules:
- `platform_treasury` funds market launch subsidy and user grants
- each live market gets its own dedicated `market_treasury`
- `market_treasury` receives buy cash and pays sells and settlement
- after a market is fully settled, leftover treasury balance returns to `platform_treasury`
- sink is only for explicit retire/remove flows

This keeps market liability isolated instead of blurring all value into one shared pool.

## Money Actor Boundary Decision

Money actors should stay role-pure.

Rules:
- `user_cash` is spendable settled balance only
- `market_treasury` is one-market trading and settlement cash pool
- `platform_treasury` is platform reserve/distribution pool
- `mint_source` is explicit issuance counterparty only
- `sink` is explicit retirement destination only

This avoids turning the economy into one blurry central-bank bucket.

## Allowed Flow Decision

Normal V1 flows should stay narrow and explicit.

Allowed core flows:
- `mint_source -> platform_treasury`
- `platform_treasury -> market_treasury`
- `platform_treasury -> user_cash`
- `user_cash -> market_treasury`
- `market_treasury -> user_cash`
- `market_treasury -> platform_treasury` after full settlement
- `user_cash -> sink`
- `platform_treasury -> sink`

Important forbidden defaults:
- no direct `mint_source -> user_cash`
- no direct `mint_source -> market_treasury`
- no cross-market treasury sharing
- no sink outflows

This keeps issuance, market liability, and retirement understandable.

Matrix summary:

| From | To | Allowed | Main use |
| --- | --- | --- | --- |
| `mint_source` | `platform_treasury` | yes | mint |
| `platform_treasury` | `market_treasury` | yes | market seed |
| `platform_treasury` | `user_cash` | yes | grant |
| `user_cash` | `market_treasury` | yes | buy |
| `market_treasury` | `user_cash` | yes | sell / settlement |
| `market_treasury` | `platform_treasury` | yes after full settlement | treasury sweep |
| `user_cash` or `platform_treasury` | `sink` | yes | explicit retirement |
| `sink` | anything | no | terminal account |

## Account Model Decision

Accounts are first-class entities, not anonymous balance buckets.

Minimum V1 account types:
- `user_cash`
- `market_treasury`
- `platform_treasury`
- `mint_source`
- `sink`

Rules:
- important balances must live in named accounts
- account stores cash-role balance only; portfolio value is separate
- user cash must not go negative
- market treasury should not go negative in normal operation
- cached balances are convenience state; ledger remains source of truth

## Ledger Transaction Decision

Ledger transactions should be balanced and append-only.

Rules:
- one global ledger should cover the whole platform
- one logical money movement creates one ledger transaction
- ledger entries in one transaction must sum to zero
- posted transactions are immutable
- corrections happen through compensating transactions linked to the original
- idempotency applies to privileged economy actions too

## Ledger Integrity Decision

Ledger integrity should follow blockchain-style discipline without requiring blockchain infrastructure in V1.

Rules:
- use `SHA-256`
- each posted transaction stores `previousTransactionHash` and `transactionHash`
- canonical payload includes canonicalized ledger entries too, not only header fields
- absent conditional fields serialize as `null` in the canonical payload
- timestamps hash in UTC; user-facing views can localize later

This gives append-order tamper evidence while keeping the backend stack simple.

## LMSR And Treasury Separation Decision

LMSR pricing state and treasury balance must stay conceptually separate.

Rules:
- LMSR determines quotes, prices, and probability movement
- treasury/ledger determine where money moves after those economics are computed
- sell-side price changes come from reversing LMSR state, not from treasury balance shrinking
- treasury balance is an accounting/solvency concern, not a direct price input

This keeps the AMM math clean and stops cash bookkeeping from leaking into the pricing model.

## Trade Pricing Semantics

Trade history and current position value are different concepts.

Rules:
- each trade stores its own execution economics
- later trades can happen at different prices
- current position value is marked from the latest market price, not frozen at old trade prices
- average entry price and current marked value must both be understandable in the model

This is required for honest portfolio reporting.

## Portfolio Value Decision

Cash and portfolio value must stay separate.

Rules:
- `availableCash` is spendable settled balance from accounts/ledger
- `portfolioValue` is current marked value of open positions
- `totalAccountValue = availableCash + portfolioValue`
- `realizedPnL` and `unrealizedPnL` are required summary concepts, not optional UI sugar

This keeps portfolio reporting honest when users hold more marked value than free cash.

## Persistence Boundary Decision

Persistence should separate:
- canonical source truth
- derived read values
- optional cache/read models
- history-only records

Rules:
- source truth includes `markets`, `market_outcomes`, `market_pricing_state`, `market_outcome_state`, `accounts`, `ledger_transactions`, `ledger_entries`, `trades`, `positions`, `market_resolutions`, `realization_events`, `idempotency_records`, and `audit_events`
- `PortfolioSnapshot` is conceptually first-class, but derived first and cached only later if performance really requires it
- `markets.settlement_status` may stay `null` before resolution begins, then move into payout-progress states later
- one active position row exists per `userId + marketId + outcomeId`
- if active position `shares` reaches `0`, remove that row in the same transaction
- closed-but-unresolved exposure stays active in `positions`
- resolved or fully exited exposure belongs in history layers, not dead zero-share rows
- derived reads should carry an `asOf` notion so cash, positions, and marks do not drift out of sync

This keeps mutation-safe truth small and clean without starving history, analytics, or later API reads.

## Schema Cut Decision

The first engine migration set should stay small but complete.

Required V1 tables:
- `markets`
- `market_outcomes`
- `market_pricing_state`
- `market_outcome_state`
- `accounts`
- `ledger_transactions`
- `ledger_entries`
- `trades`
- `positions`
- `realization_events`
- `market_resolutions`
- `idempotency_records`
- `audit_events`

Rules:
- `market_pricing_state` stays minimal at first and should not absorb outcome-level data
- `market_outcome_state.q_shares` is pricing source truth
- `market_outcome_state.last_price` is acceptable in V1 as a useful read/debug field
- `positions` stays active-only
- `audit_events` is worth first-version inclusion for debug and trust
- `idempotency_records` is required immediately, not a later nice-to-have

Later/V2 tables such as `position_cycles`, `settlement_batches`, `oracle_cases`, and cache tables should stay out of the first migration set.

This keeps the first schema honest and buildable without baking future admin/reporting dreams into every table from day one.

## Idempotency Decision

Idempotency is first-version engine truth, not optional polish.

Rules:
- all money-moving and lifecycle-changing write actions should use `idempotency_records`
- uniqueness should be `scope + actor_id + idempotency_key`
- same key and same request hash returns the same result
- same key and different request hash rejects hard
- the idempotency row and the business mutation should live in the same PostgreSQL transaction
- successful execution should store the final response snapshot before commit

Why:
- prevents duplicate trade, publish, close, and resolve execution
- removes the dangerous gap where business mutation succeeds but retry protection does not
- keeps retries boring under concurrency and network failure

V1 write scopes:
- `trade`
- `publish_market`
- `close_market`
- `resolve_market`

Later if the platform splits into multiple services:
- add outbox / distributed dedupe design deliberately
- do not weaken the single-database same-transaction rule before that split is actually needed

## Constraints And Indexes Decision

The database should enforce the cheap hard truths, while service logic keeps the richer cross-row invariants.

Rules:
- keep unique active positions at `user + market + outcome`
- keep one pricing-state row per market
- keep one `market_treasury` per market
- keep one resolution row per market
- keep one idempotency row per `scope + actor + key`
- reject zero-share active positions
- reject zero-amount ledger entries
- use partial unique indexes for account-role uniqueness where needed

Keep these in service/transaction logic first:
- zero-sum ledger transaction balancing
- no oversell
- no negative `user_cash` after execution
- no negative `market_treasury` in normal flow
- exactly one winner per resolved market

Why:
- DB constraints should carry the cheap invariant weight
- richer trade/accounting truth still needs transactional service orchestration

Resolution-history note:
- `market_resolutions` should have a stable `id` plus unique `market_id`
- this keeps one-row-per-market truth while still giving realization history and audit flows a durable resolution reference

## DB Architecture Detail Decision

The V1 database should stay explicit and boring.

Rules:
- use text columns plus check constraints instead of DB enums
- use `numeric` for money, shares, prices, and other fixed-point engine values
- use `timestamptz` in UTC
- keep core engine truth in typed columns, not `jsonb`
- use `jsonb` only for payload/debug/evidence-style fields
- keep core truth fields `NOT NULL` unless optionality is real
- prefer `ON DELETE RESTRICT` for trusted history
- prefer market-scoped composite references where a row carries both `market_id` and `outcome_id`
- keep migrations forward-only
- use explicit row locks under `READ COMMITTED`
- avoid hiding trade/settlement business logic in DB triggers or functions

Why:
- protects the engine from schema drift and hidden magic
- keeps runtime behavior easier to reason about under money-sensitive flows

## Migration Strategy Decision

Schema rollout should stay staged and boring.

Rules:
- use numbered forward-only SQL migrations
- keep schema changes separate from seed data
- keep one concern per migration
- use a first chain of:
  - core market tables
  - economy tables
  - trading tables
  - resolution/audit tables
  - constraints/indexes hardening
- use expand/contract thinking for later schema evolution

Why:
- keeps rollout readable
- reduces migration archaeology
- makes the first DB bootstrap easier to debug and trust

## Seed Slack Decision

The first seed world should be roomy enough to test real movement, but boring enough to debug.

Rules:
- baseline seed should create one open multi-outcome market
- baseline market should start symmetric
- baseline seed should not include open positions or historical trades
- first user grant should be materially smaller than first `market_treasury`
- first `market_treasury` should be materially smaller than `platform_treasury`

Recommended V1 baseline:
- `platform_treasury = 1,000,000 V₪`
- `market_treasury = 100,000 V₪`
- `seed_user_1.user_cash = 10,000 V₪`
- 4 outcomes on the first live market

Why:
- enough room for multiple meaningful trades
- enough slack to observe price movement and treasury behavior
- avoids fake tight-budget demo states that are annoying to test

## Precision And Rounding Decision

Precision rules are part of the economic engine and must stay explicit.

Rules:
- use fixed-point math only for money, shares, prices, and ledger-facing values
- money amounts persist at `6` decimal places
- share amounts persist at `6` decimal places
- outcome prices persist at `8` decimal places
- internal LMSR and quote math should use at least `18` decimal places
- round late, not mid-formula
- multiply before divide
- canonical/API/storage values use normalized decimal strings only
- centralize quantization through shared helpers for money, shares, and prices
- reject over-precision and scientific-notation inputs at the API boundary
- buy execution should floor shares, then recompute cost
- sell execution should floor proceeds
- realized PnL should use posted rounded values, not theoretical pre-rounded ones

This keeps trade execution, ledger posting, settlement, valuation, and hash payloads aligned under one deterministic policy.

## Quote Contract Decision

Quote should stay advisory, short-lived, and scoped to active trading intent.

Rules:
- V1 quote has two input modes only:
  - buy by `cashAmount`
  - sell by `shareAmount`
- `POST /markets/:id/quote` belongs to the active trade-ticket lane, not passive market browsing
- trade-ticket quote may refresh about once per second while the ticket is active
- quote must carry `quotedAt`, `expiresAt`, and `marketStateVersion`
- buy quote returns estimated shares, cost, and unspent cash
- sell quote returns estimated proceeds and estimated realized PnL delta
- all quote numbers follow the same precision/quantization rules as execution
- trade execution always revalidates and recomputes from live state inside the transaction
- quote and trade must share effective market-open and contract execution-index rules
- passive surfaces should use normal market reads and slower refresh, not quote-grade compute

This keeps the trading UX sharp without turning every feed refresh into AMM quote work.

## Trade Contract Decision

Trade is the final execution command and should behave like a live market order in V1.

Rules:
- `POST /markets/:id/trades` accepts two modes only:
  - buy by `cashAmount`
  - sell by `shareAmount`
- `idempotencyKey` is required
- `quoteId`, `quotedAt`, `quoteExpiresAt`, and `expectedMarketStateVersion` should exist from day one as nullable fields for UI wiring and debug traces
- trade always recomputes current execution inside the transaction
- if market state moved since quote, the trade should still normally execute against current live state
- trade and quote must share effective market-open and contract execution-index rules
- same idempotency key plus same payload returns the same result
- same idempotency key plus different payload is rejected
- response should return executed facts plus post-trade cash/position state, not only a success flag

This keeps execution aligned with real live-market behavior while preserving clean support/debug seams for later tightening.

## Trade Execution Flow Decision

Trade execution should use one authoritative database transaction with explicit row locking.

Rules:
- request parsing can happen before the transaction, but market state, balances, positions, and pricing must be revalidated inside it
- lock idempotency scope, market pricing state, `user_cash`, `market_treasury`, and active position rows before mutation
- recompute execution from current locked LMSR state inside the transaction
- quantize before posting money/position effects
- pricing update, position update, trade insert, realization event insert, and ledger posting commit together
- if any step fails, rollback everything
- duplicate submit returns stored prior result only when key and payload match exactly

This keeps the hot path honest under retries, concurrent clicks, and real market movement.

## Trade Decision

Trades must be server-authoritative and transactional.
Both `buy` and `sell` belong in the base engine.

Required rules:
- client never sets final price
- buy cannot overspend cash balance
- sell cannot exceed owned shares
- market must be open
- outcome must belong to market
- one idempotency key per logical trade
- balance update + pricing update + position update must commit together

## Sell Accounting Rule

Selling mirrors buying, but not perfectly.

Extra rules for sells:
- user must already own the shares being sold
- sale proceeds come from the reverse AMM move
- remaining position cost basis must be updated by an explicit accounting rule

Recommended V1 rule:
- weighted-average cost basis for the remaining open position

Reason:
- simpler than FIFO/LIFO
- easier to explain in product and code
- fits an aggregate position model well

## Realized PnL Decision

`realizedPnL` should be produced at the position level and aggregated upward for portfolio summary reads.

Rules:
- buys do not change `realizedPnL`
- partial sells realize `saleProceeds - removedCostBasis`
- full sells realize against the full remaining cost basis
- winner settlement realizes `payoutAt1 - remainingCostBasis`
- loser settlement realizes `0 - remainingCostBasis`
- price-only market moves change unrealized PnL, not realized PnL

This keeps row-level accounting explainable while still supporting top-level portfolio summaries.

## Realization History Decision

V1 should record explicit realization events, not only aggregate PnL.

Use them for:
- user win/loss history
- analytics
- auditability of realized PnL changes

This avoids reconstructing history later from trade archaeology alone.
## Lifecycle Decision

User-facing lifecycle:
- `open`
- `closed`
- `resolved`

Internal lifecycle may also include:
- `draft`

No extra lifecycle states unless a real product need appears.

Deterministic Horizon details live in:
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/horizon/authority-boundary.md`

## Resolution Decision

Every resolved market must have exactly one winning outcome.

Resolution must be:
- explicit
- audited
- source-backed
- server-authoritative

Rules:
- management defines resolution policy ahead of time
- Oracle proposes truth candidates from trusted sources
- human oversight may approve ambiguous or sensitive cases
- engine validates closed-state legality and exact winner identity before settlement

Close and resolve are therefore not "just admin buttons"; they are lifecycle commands with Oracle and audit context.

## Admin Command Contract Decision

Publish, close, and resolve should use explicit command payloads, not generic market patching.

Rules:
- `publish`, `close`, and `resolve` each get their own endpoint and contract
- publish request should include nullable review/approval fields from day one
- close request should include trigger/evidence context from day one
- resolve request should include Oracle/evidence/human-approval context from day one
- responses should return resulting state plus audit identifiers, not only `ok: true`
- audit payload snapshots are part of the trusted flow

This keeps lifecycle control explicit and makes admin/Oracle activity inspectable later.

## Resolution Execution Flow Decision

Resolution should fix truth first and settle payouts second.

Rules:
- `market.status = resolved` fixes the winning outcome
- settlement progress should use a separate `settlementStatus` domain field and `settlement_status` DB column, not a bloated lifecycle enum
- winner settlement creates both money-ledger records and realization events
- loser settlement creates realization events but no money-ledger transaction
- one ledger remains enough; non-money closeout truth belongs in event/history tables
- leftover `market_treasury` returns to `platform_treasury` only after all settlements finish
- user trading lock/deactivation must not block rightful settlement payout

This keeps the money ledger pure while still recording full closeout history.

## Cross-Market Independence Decision

Two markets may describe overlapping real-world reality.

Example:
- market A: `Will Gantz become prime minister?`
- market B: `Will Gantz join the war cabinet?`

These may share real-world meaning in part.
But in V1 they should still be treated as separate markets.

Important rule:
- shared outcome meaning across two markets does not create shared price state
- shared labels do not automatically link markets
- one market resolving does not automatically resolve another market unless an explicit future linking system exists

Reason:
- linking markets correctly is much harder than it looks
- it creates dependency, consistency, and arbitrage complexity
- it can force combinatorial or derived-market logic too early

So for V1:
- markets are independent unless explicitly designed otherwise later

## Future Linking Decision

Later, Hachozeh may support linked or derived markets.

Examples:
- one candidate outcome reused across many related markets
- one canonical event feeding several markets
- derived binary market from one multi-outcome parent market

But this should be a later layer, not part of the first engine.

If added later, it should be explicit and modeled as:
- relation metadata
- derivation rules
- consistency rules
- resolution propagation rules

Not by guessing from matching text labels.

## V1 Simplicity Rule

The first engine should support:
- independent exclusive multi-outcome markets
- clear balances
- clear positions
- clear resolution

Do not add:
- linked pricing across markets
- automatic cross-market inference
- AI-driven market publication
- hidden coupling between markets

Boring core. strong trust. less regret.
