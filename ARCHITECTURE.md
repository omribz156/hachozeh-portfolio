# ARCHITECTURE.md

Updated: 2026-05-27
Status: current
Owner: project-wide

Purpose:
- define durable product/system doctrine
- preserve the platform mental model as implementation grows
- point current implementation truth to the right live docs

## Overview

Hachozeh is a Hebrew-first prediction market platform for Israeli users.

The product is designed to feel simple and intuitive on the surface, while being supported by clear internal market mechanics.

At this stage, the architecture should stay focused on the core foundations of the platform:
- markets
- trading
- portfolio tracking
- market resolution
- trust and transparency

The goal is not to over-design the system early, but to give it a structure that can grow cleanly over time.

---

## SECURITY

Security considerations are defined separately in SECURITY.md and should inform implementation decisions across all core layers.

## Current Platform Overlay

This doc owns the durable product/system doctrine.
It is not the live status board.

Current platform truth now has these named owners:
- core engine
  - market state, pricing, trades, ledger, positions, settlement
- market management / control plane
  - drafts, publish/close/resolve commands, auth/session/user controls, admin review
- Horizon
  - deterministic lifecycle sweeps and close/readiness inspection
- Oracle
  - evidence, event-status checking, resolve recommendations, operator review
- social / status
  - profile, reputation, leaderboard/status, and community primitives that support trust and return loops
- Seer
  - source intake, signal clustering, market proposals, creation-draft handoff
- product Discovery
  - browse/feed surfaces: trending, new, breaking, categories, retrieval
- runtime confidence
  - health/readiness, structured logs, smoke checks, manual reports

Boundary rule:
- Seer suggests market supply
- product Discovery helps users find markets
- market management prepares and publishes
- Oracle proposes truth transitions
- Horizon executes deterministic lifecycle checks
- social/status consumes platform truth but does not own market truth
- the engine enforces money, pricing, positions, and settlement

Read current implementation truth with:
- `systems/back/docs/current-status.md`
- `systems/back/docs/backend-overview.md`
- `systems/back/docs/v1-contract-brief.md`
- `systems/back/docs/market-engine.md`
- `systems/seer/README.md`
- `systems/oracle/README.md`
- `workspace/tasks/current.md`

## General System Shape

Hachozeh can be thought of as a few connected layers:

### Market Layer
Defines the markets themselves:
- the question
- the possible outcomes
- prices
- status
- timing
- resolution details

### Trading Layer
Handles the logic of buying positions and updating prices.

### Portfolio Layer
Tracks what each user holds, what it is worth, and how performance changes over time.

### Discovery Layer
Supports the product browsing experience:
- new markets
- breaking markets
- categories
- trending surfaces

Important:
- product Discovery is not the Seer runtime
- Seer creates reviewed market-supply proposals
- product Discovery ranks and presents markets to users

### Trust Layer
Supports clear rules, reliable resolution, history, and accuracy over time.

In the current platform, this spans:
- deterministic engine/lifecycle rules
- Horizon close/readiness inspection
- Oracle evidence and review flows
- user-facing resolution/history surfaces

These layers do not need to be separate services.
They are simply the main concerns the system should be built around.

### Social / Status Layer
Supports profile, reputation, leaderboard/status, and community signals.

Important:
- this layer should strengthen trust and participation
- it must not own balances, prices, outcomes, lifecycle mutation, or resolution truth
- profile/status primitives should come before generic feed/chat work

---

## Core Platform Assumptions

Hachozeh is built as a closed virtual economy.

Important assumptions:
- the platform uses a virtual currency called `V₪`
- `V₪` cannot be bought, deposited, or topped up with real money — granted or earned only (Path A; deposit path removed entirely 2026-06-22)
- `V₪` cannot be withdrawn or converted back to real money
- `V₪` has no cash-out path; future cosmetics must not imply redeemable value
- users trade probabilities of future events
- prices are meaningful parts of the product experience
- markets should be understandable, tradable, and resolvable in a clear way

These assumptions should shape implementation decisions from the beginning.

Economy loop decisions:
- new users receive a one-time `1,000 V₪` starter grant
- daily login rewards are a faucet, not trade winnings
- daily streaks use `Asia/Jerusalem` calendar days
- the active streak payout loops every seven eligible claim days:
  - day 1: `100 V₪`
  - day 2: `150 V₪`
  - day 3: `200 V₪`
  - day 4: `250 V₪`
  - day 5: `300 V₪`
  - day 6: `350 V₪`
  - day 7: `400 V₪`
  - day 8 returns to day 1, not day 7
- if a user misses the streak window, the next eligible streak claim resets to day 1
- a missed previous day can still continue the streak when claimed before `04:00` in `Asia/Jerusalem`
- if a user logs in without an active open position, they may receive a flat `25 V₪` baseline claim, but the streak tier does not advance
- the signup local day is covered by the starter grant; daily login claims start on the next `Asia/Jerusalem` local day
- if a user has `0 V₪` liquid balance and no active open positions, an emergency `100 V₪` claim is allowed at most once per 24 hours
- faucet claims must be ledger-backed, idempotent, treasury-gated, and visible in audit/telemetry
- platform treasury must not silently go negative; top-ups must be explicit ledgered operator actions
- resolved winnings remain reserved until the user claims them; no expiry by default
- voided markets refund remaining cost basis, not mark-to-market value
- multi-account abuse should be flagged first, not automatically punished until signals are trusted

---

## Market Model

The MVP should support **exclusive multi-outcome markets**.

This means:
- a market can have two or more outcomes
- binary markets are a special case
- outcomes within a market are mutually exclusive
- exactly one outcome wins at resolution

Examples:
- Yes / No
- Home Win / Draw / Away Win
- Candidate A / Candidate B / Candidate C / Other

This model should be treated as the default.
The system should not be built around yes/no only.

A good mental model is:
- **market** = the question
- **outcome** = one possible answer
- **position** = a user’s holding in a specific outcome

---

## Market Structure

A market should carry both product-facing and system-facing information.

Typical market fields may include:
- id
- title
- description
- category
- image
- outcomes
- open time
- close time
- status
- resolution source
- resolution rules
- volume
- liquidity
- tags

Not every field needs full implementation immediately, but the system should be designed with this richer market concept in mind.

---

## Pricing and Trading

The platform should use an **Automated Market Maker (AMM)** for the initial version.

This is the right fit for the current stage because it:
- keeps trading simple
- supports liquidity without needing a direct counterparty
- works better for a product that is still growing its user base

The initial AMM model can be LMSR-based.

At a high level:
- each outcome has its own price
- prices reflect probabilities
- prices update as users buy positions
- total outcome probabilities in a market should sum to 1

Users buy shares in a specific outcome, not in the market as a whole.

This is enough for the first real version of the market engine.
More advanced trading models can come later if needed.

### Contract-Side Rule

The engine stays **outcome-native** underneath.

That means:
- user-facing trade requests may ask for `yes` or `no`
- the request still anchors to one named outcome
- execution may differ from the requested surface when `no` is used

Current rule:
- binary market:
  - `buy no` / `sell no` normalize to the opposite outcome
- multi-outcome market:
  - `buy no` / `sell no` execute as a complement bundle across every non-anchor outcome

Important:
- this is a user-facing contract and portfolio/history language seam
- it is not a second market engine
- the ledger, positions, and settlement logic still run on underlying outcomes
- requested-side truth and executed-leg truth should both remain visible where the product needs them

---

## Portfolio Model

Each user should have a portfolio layer that tracks:
- available `V₪` balance
- open positions
- current portfolio value
- position history
- performance over time

A position should generally belong to:
- one user
- one market
- one outcome

Typical tracked values:
- shares
- average buy price
- current marked value

Important:
- open positions stay outcome-native even when the user asked for `no`
- contract-side requests may fan out into one or more underlying execution legs
- portfolio history and ticket copy may lead with the requested contract side, but holdings should not invent synthetic assets and double-count exposure

The portfolio experience is not just a frontend view.
It needs a clear internal model from the start.

---

## Market Lifecycle

Markets move through a simple lifecycle:

### Open
The market is available for trading.

### Closed
Trading stops, and the market waits for final resolution.

### Resolved
A winning outcome is selected and positions are settled.
A resolved market must always have exactly one winning outcome.

At resolution:
- the winning outcome pays `1`
- all other outcomes pay `0`
- portfolio balances and history are updated

For contract-side requests:
- binary `no` settles through the opposite underlying outcome
- multi-outcome `no` settles through its complement execution legs
- there is no separate payout engine for synthetic `no` contracts

This lifecycle should remain clear and predictable.

---

## Trust and Resolution

Trust is a core part of the product.

Markets should not feel vague or arbitrarily settled.
Each market should be supported by:
- a clear question
- clear outcome definitions
- a resolution source
- resolution rules
- visible timing

Resolved markets should remain historically accessible.
Over time, the platform should be able to support accuracy and reliability views based on market history.

This trust layer is part of the product itself, not just an admin concern.

Current implementation boundary:
- the engine owns trusted lifecycle mutation and settlement
- Oracle owns evidence/recommendation flow, not final mutation authority
- Horizon owns deterministic close/readiness checks, not fuzzy truth decisions
- admin/human review remains part of sensitive publish and resolution paths

---

## Discovery and Product Flow

The architecture should support the product’s main user flow:

1. discover a market
2. understand the available outcomes
3. take a position quickly
4. track it in the portfolio
5. see it resolve clearly

Discovery surfaces such as:
- landing
- new markets
- breaking markets
- category views

should be treated as part of the core product structure, not as secondary decoration.

---

## Engineering Direction

The architecture should remain simple, modular, and easy to evolve.

In practice, that means:
- avoid unnecessary complexity early
- keep concepts clean
- avoid hardcoding the system around one market type
- avoid mixing unrelated concerns
- keep frontend/backend integration explicit
- keep portability in mind from the start

The project should be able to grow without needing to be rebuilt from scratch.

---

## Portability

Hachozeh should remain portable across environments.

As the system evolves:
- do not rely on one specific machine setup
- prefer environment-based configuration
- keep deployment assumptions minimal
- keep Docker in mind as the standard runtime direction
- avoid tying core logic to local filesystem persistence

Portability matters because the product should be able to move across local, staging, and cloud environments without major friction.

---

## Scope for the Current Stage

For now, the architecture should stay focused on the essentials:
- market modeling
- pricing and trading
- portfolio tracking
- market lifecycle
- trust and resolution
- Seer market-supply support
- product Discovery support
- control-plane/auth basics
- runtime confidence
- social/status foundations where they support the core loop

There is no need to prematurely design:
- order book trading
- advanced governance systems
- linked or combinatorial markets
- external developer APIs beyond the current product-read backend routes
- large infrastructure patterns
- generic social-network machinery

Those can come later if the product proves the need.

---

## Final Note

Hachozeh should grow from the current working platform into a real product with a clear internal logic.

The architecture should support that by staying:
- understandable
- flexible
- product-oriented
- strong enough for real mechanics
- simple enough to evolve without friction
