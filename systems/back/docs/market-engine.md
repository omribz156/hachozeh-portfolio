# Backend Market Engine

Updated: 2026-05-27
Status: current
Owner: backend lane

Purpose:
- define the first real backend shape for Hachozeh markets
- turn `ARCHITECTURE.md` into implementable backend boundaries
- keep trading, balances, and resolution trustworthy from day one

Read with:
- `systems/back/docs/README.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `workspace/docs/ai-project-structure.md`
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/engine-cleanup-liquidity-depth-v1.md` while depth calibration is active

This doc owns:
- engine model
- persistence model
- execution flows
- trade/ledger/settlement doctrine

This doc does not own:
- live runtime status
- app-facing contract details
- auth/session policy
- backend archaeology

## What The Engine Owns

The backend engine is the source of truth for:
- live market lifecycle after publish
- outcome definitions
- AMM pricing state
- trade execution
- balances and portfolio positions
- market resolution
- audit trails for sensitive actions

The frontend should never be trusted for:
- prices
- balances
- market status
- permissions
- final portfolio value

## System Boundary: Current Parts

Keep the backend separated by responsibility, not by hype.

### 1. Core Market Engine

This is the trusted rules layer.

Owns:
- market state model
- outcome state
- pricing math
- trade execution
- balance and ledger state
- positions and portfolio state
- settlement and payout rules
- lifecycle rules once a market is real

Must never own:
- web scanning
- AI topic discovery
- fuzzy ranking of public interest
- autonomous publish decisions
- marketing copy generation

Important:
- this part should stay deterministic
- this part should stay boring
- this part is the money-trust core

### 2. Market Management Layer

This is the control layer around the engine.

Owns:
- creating market drafts
- editing title, description, rules, sources, and outcomes
- admin review flow
- publishing approved drafts into the core engine
- close and resolve commands routed into explicit engine actions
- permissions for privileged actions
- validation that a proposed market is clear enough to go live

Must never own:
- direct price-setting in live markets
- direct balance rewrites outside the ledger flow
- bypassing engine lifecycle rules
- AI-only final decisions for publish or resolve

Important:
- this layer decides which markets become real
- this layer does not replace the engine rules

Lifecycle note:
- deterministic `open -> closed` behavior lives under the engine/lifecycle layer
- management may issue or approve close commands, but does not become the lifecycle authority itself
- close may be triggered by scheduler or Oracle inputs, but the engine still owns the final lifecycle mutation

### 3. Oracle Layer

This is the truth-check and event-status layer.

Owns:
- monitoring trusted sources for event status
- proposing early-close triggers from real-world developments
- proposing resolution candidates with evidence
- attaching confidence, conflict, and source notes
- escalating ambiguous or disputed cases for human review

Must never own:
- direct settlement without engine validation
- direct balance rewrites
- autonomous final truth in sensitive or disputed cases
- market copy, promotion, or discovery ranking

Important:
- this layer checks reality, not product wording
- this layer can propose, not silently settle
- this layer is distinct from discovery because truth-checking and idea-finding have different risk

### 4. Seer Market-Supply Agent

This is the idea and signal layer.

Owns:
- scanning the web and other inputs
- spotting topics people care about
- suggesting candidate markets
- suggesting draft outcomes
- attaching source links and signal notes
- ranking ideas by relevance or attention

Must never own:
- publishing live markets directly
- trading on behalf of users
- changing balances
- resolving markets
- bypassing human or admin review
- product Discovery UI routing
- Oracle resolution truth

Important:
- this layer is probabilistic
- this layer can be noisy

### 5. Product Discovery / Search

This is the user-facing browse/read layer.

Owns:
- discovery feed reads
- search reads
- market-card preview shaping
- viewer-position hints

Must never own:
- source intake truth
- market creation authority
- trade or settlement truth

## How The Current Parts Talk

Safe flow:
1. Seer creates or imports a market-supply proposal
2. market management reviews and edits the proposal
3. market management publishes the approved market into the core engine
4. core engine runs all live market behavior
5. product Discovery/Search exposes published markets to users
6. Oracle monitors event status and proposes close/resolve triggers when needed
7. human/management oversight approves sensitive truth decisions when needed
8. core engine executes explicit close/resolve actions

Good boundary rule:
- Seer suggests
- product Discovery exposes
- management prepares/publishes
- Oracle proposes truth transitions
- human oversight confirms sensitive cases
- engine enforces

That separation matters because future AI and web-scanning systems will be useful, but also noisy and attackable.
The core engine should stay protected from that noise.
## Cross-Market Behavior

Different markets may partially describe the same real-world event.
That does not mean they should share engine state.

V1 rule:
- each market is independent
- outcome labels matching across markets do not link pricing
- one market resolving does not auto-resolve another market

Example:
- `Will Gantz become prime minister?`
- `Will Gantz join the war cabinet?`

These overlap in meaning, but should still be separate markets in V1.

Reason:
- linked markets add consistency and arbitrage complexity
- they require explicit parent/child or derived-market rules
- they should not be inferred from text labels alone

If Hachozeh adds linked markets later, that should be a deliberate system with explicit relation modeling.
## V1 Goals

- support exclusive multi-outcome markets
- support LMSR-based pricing
- support buy-side and sell-side trading
- support clear open -> closed -> resolved flow
- support portfolio valuation from current market state
- support admin creation, close, and resolve actions

## LMSR Liquidity Depth

Current engine depth is controlled by `market_pricing_state.liquidity_b`.

Rules:
- `liquidity_b` is current market depth, not historical traded volume.
- larger `liquidity_b` means a given trade moves probability less.
- volume must not be used as a proxy for depth.
- no live market should be silently re-depth-adjusted.

Active calibration work:
- `systems/back/docs/engine-cleanup-liquidity-depth-v1.md`
- `npm --prefix systems/back run depth:lmsr-ladder`
- `npm --prefix systems/back run depth:liquidity-audit`
- `npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id>`

## V1 Non-Goals

- order book trading
- peer-to-peer matching
- combinatorial markets
- leverage or margin
- social features
- public API hardening for third parties
## Recommended Technical Shape

Keep the first backend as one modular service:
- TypeScript runtime
- PostgreSQL as source of truth
- Fastify-owned HTTP API boundary
- domain modules for pricing, trading, lifecycle, and settlement
- background jobs only where lifecycle work is asynchronous

Important:
- HTTP framework choice is now settled on Fastify for the backend boundary
- engine boundaries matter more than picking a fashionable server wrapper

Practical recommendation:
- Fastify + TypeScript + PostgreSQL

Reason:
- simple
- fast enough
- Docker-friendly
- easy to keep files small

## Market Object Shape

The `market` object should be rich enough for trust and scale, but not stuffed with random future dreams.

### Required Now

These fields affect engine behavior directly and should exist from the start.

- `id`
- `status`
- `title`
- `outcomes`
- `openAt`
- `closeAt`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`
- `liquidityB`
- `resolutionSource`
- `resolutionRules`
- `createdBy`

Why these are required:
- without them, the market cannot trade cleanly or resolve cleanly

### Optional Now But Real

These do not block engine correctness, but they are part of product and trust quality.

- `description`
- `categoryKey`
- `tags`
- `imageUrl`
- `publishedAt`
- `closedAt`
- `resolvedAt`
- `marketTreasuryAccountId`
- `externalReferenceUrl`
- `sourceNote`

These should be modeled clearly, even if some views do not use them yet.

### Reserve For Later

These are useful later, but should not drive V1 complexity.

- `eventId`
- `marketGroupId`
- `proposalId`
- `proposalSource`
- `discoveryScore`
- `moderationState`
- `metadata`

Rule:
- if the field is not part of pricing, trading, lifecycle, trust, or a clear product need, keep it out of the main object until needed

### Good Shape Strategy

Use this mental split:
- engine-critical fields
- trust/product fields
- future extension fields

Best practice:
- keep first-class columns for important fields
- use `metadata` only for truly secondary future extension
- do not hide core meaning inside generic blobs

### Example Shape

```ts
interface Market {
  id: string;
  status: 'draft' | 'open' | 'closed' | 'resolved';
  title: string;
  description?: string;
  categoryKey?: string;
  tags?: string[];
  imageUrl?: string;
  outcomes: MarketOutcome[];
  openAt: string;
  closeAt: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  publishedAt?: string;
  closedAt?: string;
  resolvedAt?: string;
  liquidityB: number;
  resolutionSource: string;
  resolutionRules: string;
  externalReferenceUrl?: string;
  sourceNote?: string;
  marketTreasuryAccountId?: string;
  createdBy: string;
  eventId?: string;
  marketGroupId?: string;
  proposalId?: string;
  proposalSource?: 'manual' | 'agent' | 'import';
  discoveryScore?: number;
  moderationState?: 'none' | 'flagged' | 'restricted';
  metadata?: Record<string, unknown>;
}
```

Important:
- `outcomes` are first-class, not hidden inside generic metadata
- trust fields stay explicit
- proposal and agent-origin fields can exist later without contaminating core trade logic
- close-policy truth stays on the market aggregate, not in a separate lifecycle-policy store
## Outcome Object Shape

The `outcome` object is first-class.
It is not just display text.
It affects pricing, positions, and settlement.

### Core Rule

Outcome identity belongs to a market.

Meaning:
- an outcome is not global across the whole system
- matching labels across 2 markets do not make them the same outcome
- outcome ids should be unique entities, not guessed from text alone

Good mental model:
- `market` owns many `outcomes`
- `position` points to one specific market outcome

### Required Now

These fields are needed for engine correctness.

- `id`
- `marketId`
- `label`
- `sortOrder`
- `qShares`
- `lastPrice`

Why these are required:
- identity
- ownership
- display order
- pricing state

### Optional Now But Real

These support product quality without changing core engine rules.

- `shortLabel`
- `description`
- `imageUrl`
- `colorKey`
- `tickerLikeCode`

### Resolution Field

At market resolution, the engine must store final winner state explicitly.

Use:
- `isWinner`

Rule:
- before resolution, this should be unset
- after resolution, exactly one outcome in a market should be winner

### Reserve For Later

Useful later, but not needed for V1 engine behavior.

- `externalRef`
- `eventParticipantId`
- `groupKey`
- `metadata`

### Example Shape

```ts
interface MarketOutcome {
  id: string;
  marketId: string;
  label: string;
  sortOrder: number;
  shortLabel?: string;
  description?: string;
  imageUrl?: string;
  colorKey?: string;
  tickerLikeCode?: string;
  qShares: number;
  lastPrice: number;
  isWinner?: boolean;
  externalRef?: string;
  eventParticipantId?: string;
  groupKey?: string;
  metadata?: Record<string, unknown>;
}
```

### Important Separation

Do not mix these 3 concerns mentally:
- display fields
- pricing fields
- resolution fields

That split keeps the engine understandable.

### Cross-Market Rule

If 2 markets both contain something like `Gantz`, those are still 2 separate outcomes.

Example:
- market A outcome: `Gantz`
- market B outcome: `Gantz`

In V1 they should not share:
- price state
- position state
- settlement state

Only an explicit future linking system should ever connect them.
## Trade Object Shape

A `trade` is one completed execution event.
It is not the same thing as a full position.
A trade can be a `buy` or a `sell`.

### What A Trade Records

A trade should record:
- who traded
- which market
- which outcome
- whether it was `buy` or `sell`
- how much cash moved
- how many shares moved
- what the market price was before
- what the market price became after
- what the average execution price was for that whole trade
- when it happened
- the idempotency key for replay protection

### Required Now

- `id`
- `userId`
- `marketId`
- `outcomeId`
- `side`
- `cashAmount`
- `shareAmount`
- `avgPrice`
- `priceBefore`
- `priceAfter`
- `idempotencyKey`
- `createdAt`

### Optional Now But Useful

- `slippageLimit`
- `marketStateVersion`
- `requestSource`

### Important Pricing Rule

These values are different things:
- `avgPrice` = average execution price across the whole trade
- `priceAfter` = new marginal market price after the trade is complete

Buy example:
- user buys 10 shares
- the trade starts around price `X`
- while buying, LMSR moves the price upward
- so the user does not get all 10 shares at exactly `X`
- the average paid may be above `X`
- after the trade, the marginal price may be even higher still

Sell example:
- user sells 4 shares later
- the trade starts from the newer market price
- while selling, LMSR moves the price downward
- the average sell price may differ from both the starting and ending marginal price

So a trade should store both:
- average execution price for that block of shares
- ending market price after execution

### Position Relationship

Example:
- trade 1: buy 10 shares
- trade 2: buy 4 more shares later at a higher market state
- trade 3: sell 3 shares later from that position

Then:
- current position shares reflect buys minus sells
- cost basis must be updated by an explicit accounting rule
- average entry price applies to the remaining open shares
- current marked value = `open shares * current market price`

Important:
- old trades remain historical facts
- the open position changes over time
- current value is always marked against the latest market price

### Example Shape

```ts
interface Trade {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  side: 'buy' | 'sell';
  cashAmount: number;
  shareAmount: number;
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  idempotencyKey: string;
  slippageLimit?: number;
  marketStateVersion?: number;
  requestSource?: 'web' | 'admin' | 'system';
  createdAt: string;
}
```
## Position Object Shape

A `position` is the accumulated holding for one user in one outcome of one market.

Rule:
- many trades can build one position
- sells reduce that position but must never drive it below zero

### Required Now

- `userId`
- `marketId`
- `outcomeId`
- `shares`
- `costBasis`
- `realizedPnL`
- `createdAt`
- `updatedAt`

### Good Now

- `settledAt`
- `lastTradeAt`

### Layer Rule

Keep a hard split between:
- engine persistence truth
- backend read/domain shape
- UI subset

#### Engine persistence truth

Store only the mutation-safe open-position state:

```ts
interface PositionRecord {
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: string;
  costBasis: string;
  realizedPnL: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  lastTradeAt?: string;
}
```

Do not store these as core truth on the position row:
- `currentPrice`
- `positionValue`
- `unrealizedPnL`
- `pnlPercent`

### Derived Values

These should be explicit in the read/domain layer even if they are derived.

- `averageEntryPrice = costBasis / shares` for open shares
- `currentMarketPrice = latest outcome price`
- `markedValue = shares * currentMarketPrice`
- `unrealizedPnL = markedValue - costBasis`
- `totalPnL = realizedPnL + unrealizedPnL`

#### Read/domain shape

```ts
interface PositionSnapshot {
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: string;
  costBasis: string;
  realizedPnL: string;
  averageEntryPrice: string | null;
  currentPrice: string;
  positionValue: string;
  unrealizedPnL: string;
  totalPnL: string;
  markAsOf: string;
  marketStatus?: 'open' | 'closed' | 'resolved';
  marketTitle?: string;
  outcomeLabel?: string;
}
```

### Example

If a user buys:
- 10 shares for total `100`
- then 4 shares for total `52`
- then sells 3 shares later

Then:
- `shares` becomes the remaining open shares
- `costBasis` becomes the remaining open cost basis after the chosen accounting rule is applied
- `realizedPnL` captures what was locked in by the sale
- if current market price is `0.92`, then `markedValue = open shares * 0.92`

This is the key separation:
- trade history tells how the position was built
- position state tells what the user holds now
## Core Domain Model

Think in these units:

### Market
- question and market metadata
- open time, close time
- status
- resolution rules
- resolution source
- liquidity configuration

### Outcome
- belongs to one market
- label, sort order
- current implied probability
- AMM inventory state

### Position
- belongs to one user, one market, one outcome
- holds total shares and cost basis

### Trade
- one executed buy or sell against the AMM
- stores pre-trade and post-trade pricing context
- must be idempotent

### Account
- user cash account
- market treasury account
- platform treasury account
- mint source account
- sink account for retired currency when explicit economy policy requires it

### Ledger Transaction
- append-only money movement
- balanced across accounts

### Resolution
- winning outcome
- resolver identity
- source and notes
- settlement timestamp

### Audit Event
- market creation
- market edit
- market close
- market resolve
- balance adjustment

## Lifecycle Model

User-facing lifecycle stays simple:
- `open`
- `closed`
- `resolved`

Internal backend lifecycle should also allow:
- `draft`

Reason:
- admin needs a safe state for creating and reviewing markets before publish

Do not add more states unless a real need appears.

Read for the deterministic Horizon layer:
- `systems/back/docs/horizon/overview.md`

## Pricing Model

V1 AMM:
- LMSR

Core formulas:

```text
C(q) = b * ln(sum(exp(q_i / b)))
price_i = exp(q_i / b) / sum(exp(q_j / b))
buy_cost = C(q_after) - C(q_before)
```

Where:
- `q_i` = share inventory state for outcome `i`
- `b` = liquidity parameter

Meaning of `b`:
- larger `b` = deeper liquidity, smaller price movement per trade
- smaller `b` = thinner liquidity, larger price movement per trade

Important product consequence:
- `b` also controls the market maker subsidy / risk budget

For a uniform N-outcome LMSR market:
- worst-case subsidy is bounded by `b * ln(N)`

That matters because every market should launch with an explicit risk budget, not magic numbers.

## Initial Probabilities

Two good starting modes:

### Uniform start
- all outcomes equal at publish time
- simplest launch mode

### Seeded start
- admin provides initial probabilities that sum to 1
- backend converts those probabilities into initial LMSR state

Seeded start is better for product realism.
Uniform start is easier for the very first internal milestone.

## Balance And Treasury Model

Do not treat balance as a plain mutable number.

Use an append-only ledger:
- every balance change is a ledger transaction
- balances are derived or cached from ledger state
- no silent balance rewrites

Recommended account types:
- user cash account
- market treasury account
- platform treasury account
- mint source account
- sink account

Market publish flow:
1. create market in `draft`
2. create a dedicated market treasury account
3. fund that market treasury from platform treasury with the configured subsidy budget
4. publish market to `open`

Reason:
- isolates market liability
- makes subsidy explicit
- keeps settlement explainable

### Market Reserve Policy

Do not confuse LMSR depth with treasury reserves.

`liquidity_b` controls:
- probability movement
- graph readability
- quote/trade slippage

Treasury reserves control:
- whether the market can pay sells
- whether the market can pay winners at settlement
- whether lifecycle settlement needs an emergency platform top-up

The reserve floor for a fresh LMSR market should be tied to the same risk budget
as the depth choice:

```text
reserve_floor = liquidity_b * ln(outcome_count)
```

Examples:
- binary `b = 75,000` needs about `52,000 V₪` reserve floor
- three-outcome `b = 75,000` needs about `82,000 V₪` reserve floor
- four-outcome `b = 100,000` needs about `139,000 V₪` reserve floor

Rules:
- publish calculates and exposes the required reserve before the market opens
- publish blocks when the post-seed market treasury would be below the reserve
  floor; operators should raise the seed amount or explicitly fund the market
  before retrying
- publish also blocks when platform treasury cannot cover the requested seed
- gauntlets should pre-fund a known reserve buffer instead of relying on
  mid-run emergency top-offs
- reports must separate `market depth`, `market treasury reserve`, `platform
  treasury balance`, and `actor cash exhaustion`
- emergency top-offs are allowed only as explicit ledgered operator/test events
  with receipts

## Economy Policy V1

`V-shekel` stays a closed virtual economy.

Default rule:
- trading and settlement transfer value between accounts
- they do not mint new currency
- they do not silently destroy currency

### Mint Rules

Minting is privileged and rare.

Use it only for explicit issuance events such as:
- platform bootstrap
- controlled promotions
- admin-approved compensation or corrections

Rules:
- mint should land in `platform treasury`, not directly in a live market flow
- later user grants should usually be normal transfers from `platform treasury`
- every mint event must create ledger records and audit records

### Transfer Rules

Normal engine behavior is transfer behavior.

Examples:
- user buy: `user cash -> market treasury`
- user sell: `market treasury -> user cash`
- market publish subsidy: `platform treasury -> market treasury`
- promo grant: `platform treasury -> user cash`

This keeps trading explainable without hidden money creation.

### Sink Rules

V1 should support an explicit sink path, but use it sparingly.

Good V1 uses:
- retiring expired promotional balances if the product later introduces them
- removing balances after a fraud or abuse reversal
- controlled test-environment resets

Rules:
- sink events must be explicit ledger transactions into a dedicated sink account
- normal trading, pricing, and settlement must never rely on sink behavior
- sink events require privileged authorization and audit logging

### Treasury Role Rules

`platform treasury`:
- holds issued but not yet distributed platform funds
- seeds market treasuries
- receives returned surplus from fully settled markets

`mint source`:
- exists only to make supply creation explicit inside the ledger
- should never be used for normal trading or grants directly

`sink`:
- receives retired value from explicit removal flows
- should never be part of normal trading or settlement

`market treasury`:
- belongs to one market only
- receives user buy cash
- pays user sells
- pays final winner settlement
- should not be reused across markets

Important:
- market treasury should be funded at publish time with an explicit subsidy budget
- after full settlement, any remaining market treasury balance should return to `platform treasury`
- treasury moves should always be visible in the ledger

## Money Actor Clarification

Keep the money actors narrow and non-overlapping.

### `user_cash`

Owns:
- spendable settled user balance
- buy funding
- sell proceeds receipt
- settlement payout receipt
- platform grant receipt

Must not own:
- floating portfolio value
- market pricing state
- hidden admin-only adjustments outside ledger flow

### `market_treasury`

Owns:
- one market's cash-side trading and settlement pool
- buy cash inflow
- sell proceeds outflow
- winner settlement outflow
- market subsidy budget once funded

Must not own:
- platform-wide reserve logic
- unrelated market liabilities
- direct pricing authority

### `platform_treasury`

Owns:
- active platform-held supply
- market seeding flow
- grants and promo distribution
- return sweep from fully settled markets

Must not own:
- normal live trade settlement instead of market treasury
- magical mint behavior by itself

### `mint_source`

Owns:
- explicit supply creation counterparty in the ledger only

Must not own:
- normal grants
- user-facing product balances
- trade or settlement flows

### `sink`

Owns:
- explicit retired-value destination

Must not own:
- normal trade flows
- market payout flows
- spare reserve behavior

## Allowed Money Flow Matrix

Normal allowed flows in V1:
- `mint_source -> platform_treasury`
- `platform_treasury -> market_treasury`
- `platform_treasury -> user_cash`
- `user_cash -> market_treasury`
- `market_treasury -> user_cash`
- `market_treasury -> platform_treasury`
- `user_cash -> sink`
- `platform_treasury -> sink`

Flows that should stay forbidden in normal operation:
- `user_cash -> user_cash`
- `market_treasury -> market_treasury` across different markets
- `market_treasury -> platform_treasury` before the market is fully settled, except explicit admin correction
- `mint_source -> user_cash`
- `mint_source -> market_treasury`
- `sink -> anything`

Reason:
- keeps market liability isolated
- keeps issuance and retirement explicit
- avoids treasury-role blur

### Matrix View

| From | To | Allowed | When | Transaction type |
| --- | --- | --- | --- | --- |
| `mint_source` | `platform_treasury` | yes | explicit supply creation only | `mint` |
| `platform_treasury` | `market_treasury` | yes | market publish / market funding | `market_seed` |
| `platform_treasury` | `user_cash` | yes | grant / promo / admin-approved user credit | `grant` |
| `platform_treasury` | `sink` | yes | explicit retirement / correction policy | `sink` or `adjustment` |
| `user_cash` | `market_treasury` | yes | buy trade | `trade_buy` |
| `user_cash` | `sink` | yes | explicit retirement / abuse reversal / expired promo policy later | `sink` or `adjustment` |
| `market_treasury` | `user_cash` | yes | sell trade / winner settlement | `trade_sell` or `market_settlement` |
| `market_treasury` | `platform_treasury` | yes | leftover sweep after full settlement | `treasury_sweep` |
| `user_cash` | `user_cash` | no | not a normal engine flow | forbidden |
| `market_treasury` | `market_treasury` same market | no | no need in V1 | forbidden |
| `market_treasury` | `market_treasury` different market | no | avoid cross-market liability blur | forbidden |
| `market_treasury` | `platform_treasury` | no by default | only after full settlement or explicit correction | mostly forbidden |
| `mint_source` | `user_cash` | no | grants should route via platform treasury | forbidden |
| `mint_source` | `market_treasury` | no | market funding should route via platform treasury | forbidden |
| `sink` | anything | no | sink is terminal | forbidden |

### Flow Notes

`buy`:
- money: `user_cash -> market_treasury`
- price move: LMSR state moves
- position: shares and cost basis increase

`sell`:
- money: `market_treasury -> user_cash`
- price move: LMSR state reverses
- position: shares and cost basis decrease, realized PnL updates

`winner settlement`:
- money: `market_treasury -> user_cash`
- closes remaining exposure after resolution

`market seed`:
- money: `platform_treasury -> market_treasury`
- funds the market liability budget, not a user trade

`mint`:
- money: `mint_source -> platform_treasury`
- creates supply and should stay rare

`sink`:
- money ends at `sink`
- no outflow should exist from it

## Pricing And Treasury Separation

LMSR and treasury are related, but they are not the same layer.

`LMSR` owns:
- quote math
- price state
- probability movement
- share inventory state

`treasury / ledger` owns:
- where cash moves
- which account receives buy cash
- which account pays sell proceeds
- which account pays settlement

Important:
- a sell changes prices because LMSR state moves backward
- a sell does not change prices because treasury balance changed
- treasury balance is a solvency/accounting concern
- liquidity depth is controlled by LMSR `b`, not by treasury balance directly

In practice:
1. engine computes buy/sell economics from LMSR state
2. engine updates position state
3. engine records cash movement through the ledger
4. all three commit together

This keeps pricing logic and money accounting separate but synchronized.

## Account And Ledger Object Shape

Treat accounts and ledger records as first-class backend objects, not hidden helpers.

### Account Shape

```ts
interface Account {
  id: string;
  type:
    | 'user_cash'
    | 'market_treasury'
    | 'platform_treasury'
    | 'mint_source'
    | 'sink';
  ownerId: string;
  status: 'active' | 'locked';
  createdAt: string;
  balanceCached?: string;
  lockedReason?: string;
  updatedAt?: string;
}
```

Rules:
- account owns cash-role balance only, not floating portfolio value
- every important balance lives in an account
- `balanceCached` is a convenience cache, not the source of truth
- user cash should not allow negative balance
- market treasury should not allow negative balance in normal operation
- the source of truth remains the ledger

### Ledger Transaction Shape

```ts
interface LedgerTransaction {
  id: string;
  sequenceNumber: number;
  type:
    | 'trade_buy'
    | 'trade_sell'
    | 'market_seed'
    | 'market_settlement'
    | 'grant'
    | 'mint'
    | 'sink'
    | 'adjustment'
    | 'treasury_sweep';
  referenceType:
    | 'trade'
    | 'market'
    | 'resolution'
    | 'grant'
    | 'admin_adjustment'
    | 'system';
  referenceId: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  postedAt: string;
  marketId?: string;
  outcomeId?: string;
  compensatesTransactionId?: string;
  compensationReason?: string;
  triggeredBy?: 'user' | 'admin' | 'system' | 'job';
  triggeredById?: string;
  positionId?: string;
  positionCycleId?: string;
  tradeSide?: 'buy' | 'sell';
  tradePriceBefore?: string;
  tradePriceAfter?: string;
  resolutionId?: string;
  sharesSettled?: string;
  settlementPrice?: string;
  settlementBatchId?: string;
  previousTransactionHash: string;
  transactionHash: string;
}
```

### Ledger Entry Shape

```ts
interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  amount: string;
  entryRole: string;
  memo?: string;
}
```

Rules:
- one global ledger should cover the whole platform
- trade and settlement transactions should carry exact `marketId` and `outcomeId` context
- one logical money movement should create one ledger transaction with multiple entries
- sum of all `amount` values inside one transaction must equal `0`
- posted ledger transactions are immutable forever
- corrections should happen through compensating transactions, not silent rewrites
- idempotency should apply to privileged economy actions too, not only trade requests

## Immutable Ledger Rules

Posted ledger is permanent fact.

Rules:
- no posted transaction may be edited or deleted
- no posted ledger entry may be edited or deleted
- corrections must happen through new posted transactions only
- every correction transaction must point to the original via `compensatesTransactionId`
- every correction transaction should carry a human-readable `compensationReason`
- ledger rows should not have a fuzzy pending lifecycle; if a write fails before post, no ledger row should exist

## Canonical Payload Rules

The ledger hash chain should behave like a lightweight blockchain discipline without requiring blockchain infrastructure.

Rules:
- use `SHA-256` for transaction hashing
- `transactionHash` must include canonical transaction fields plus canonicalized ledger entries
- `previousTransactionHash` links each posted transaction to the prior posted transaction in sequence order
- conditional fields that do not apply should still serialize as `null`
- timestamps in the hash payload should use canonical UTC ISO-8601 strings
- monetary amounts should serialize as normalized decimal strings
- entries must be sorted deterministically before hashing

This gives 2 different links:
- chronological integrity through `previousTransactionHash`
- business correction linkage through `compensatesTransactionId`

## Trade Execution Flow

Trade request input:
- `marketId`
- `outcomeId`
- `side` = `buy` | `sell`
- cash amount or target shares
- optional slippage cap
- idempotency key

Recommended V1 request mode:
- buy requests may use cash-to-spend
- sell requests may use shares-to-sell

Reason:
- clearer user intent
- easier validation on both sides of the trade

Buy flow:
1. authenticate user
2. validate market is `open`
3. validate outcome belongs to market
4. begin database transaction
5. lock user cash account row
6. lock market pricing state row
7. recompute quote from latest state
8. reject if insufficient balance
9. reject if slippage cap is exceeded
10. debit user cash through ledger
11. credit market treasury through ledger
12. update LMSR state
13. insert trade record
14. upsert aggregate position
15. update market stats needed for reads
16. commit

Sell flow:
1. authenticate user
2. validate market is `open`
3. validate outcome belongs to market
4. begin database transaction
5. lock user position row
6. lock market pricing state row
7. recompute quote from latest state
8. reject if user tries to sell more shares than owned
9. reject if slippage cap is exceeded
10. reduce user position shares and cost basis according to the chosen accounting rule
11. debit market treasury through ledger
12. credit user cash through ledger
13. update LMSR state
14. insert trade record
15. update market stats needed for reads
16. commit

Security-critical rules:
- server computes final quote
- one idempotency key per logical trade
- new rapid-fire orders should use new idempotency keys and still be allowed
- transaction boundary covers balance + pricing + position update
- no client-supplied prices are trusted
- sell requests must never allow negative shares

## Realization Event Model

A realization event records one moment where open exposure became locked result.

Create realization events for:
- partial sells
- full sells
- winner settlement
- loser settlement

Do not create realization events for:
- buys
- price-only mark changes

```ts
interface RealizationEvent {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  type: 'sell' | 'resolution_win' | 'resolution_loss';
  sharesClosed: string;
  proceeds: string;
  removedCostBasis: string;
  realizedPnL: string;
  createdAt: string;
  tradeId?: string;
  resolutionId?: string;
  marketTitleSnapshot?: string;
  outcomeLabelSnapshot?: string;
}
```

This layer is useful for:
- user win/loss history
- analytics
- auditability of realized PnL changes
## Portfolio Model

Keep two layers:

### Write model
- trades
- ledger entries
- aggregate positions

### Read model
- available cash
- open positions
- current marked value
- realized settlement history

### Portfolio snapshot

Treat the top portfolio summary as a dedicated read model.

Required now:
- `availableCash`
- `portfolioValue`
- `totalAccountValue`
- `realizedPnL`
- `unrealizedPnL`
- `asOf`

```ts
interface PortfolioSnapshot {
  userId: string;
  availableCash: string;
  portfolioValue: string;
  totalAccountValue: string;
  realizedPnL: string;
  unrealizedPnL: string;
  asOf: string;
}
```

Important:
- `availableCash` is spendable cash from accounts/ledger
- `portfolioValue` is current marked value of open positions
- `totalAccountValue = availableCash + portfolioValue`
- `realizedPnL` and `unrealizedPnL` are part of the core money interpretation layer, not cosmetic extras

### Realized vs unrealized PnL rules

`realizedPnL` changes only when exposure is actually closed:
- sell
- winner settlement
- loser settlement

It does not change on:
- buy
- quote refresh
- price-only market movement

Weighted-average examples:
- partial sell: `realizedPnL += saleProceeds - removedCostBasis`
- full sell: `realizedPnL += saleProceeds - remainingCostBasis`
- winner resolution: `realizedPnL += payoutAt1 - remainingCostBasis`
- loser resolution: `realizedPnL += 0 - remainingCostBasis`

## Persistence Boundaries V1

Separate four concerns:
- source truth
- derived read values
- cacheable read models
- history-only records

### Source truth

Persist as canonical state:
- `markets`
- `market_outcomes`
- `market_pricing_state`
- `accounts`
- `ledger_transactions`
- `ledger_entries`
- `trades`
- `positions`
- `market_resolutions`
- `realization_events`

Rule:
- if replay/debugging breaks without it, it belongs in source truth

### Derived on read

Do not treat these as primary persisted truth:
- `averageEntryPrice`
- `currentPrice`
- `positionValue`
- `unrealizedPnL`
- `totalPnL`
- `availableCash`
- `portfolioValue`
- `totalAccountValue`

These should be derived from:
- positions
- ledger/accounts
- current market pricing state

### Cache later if needed

Possible later cache/read models:
- `portfolio_snapshot_cache`
- `market_summary_cache`
- leaderboard-style summary reads

Rules:
- cache is never the only source of truth
- cache must be rebuildable from canonical tables
- cache should appear only if read cost really justifies it

### History-only records

Useful history layers:
- `trades`
- `ledger_transactions`
- `ledger_entries`
- `realization_events`
- `market_resolutions`

These support:
- audit
- analytics
- user history
- later time-series or reporting layers

### Active position boundary

`positions` should hold active open exposure only.

Rules:
- one active row per `userId + marketId + outcomeId`
- if `shares` becomes `0`, remove the row in the same transaction
- closed-but-unresolved market positions still stay in `positions`
- resolved or fully exited exposure should live in history layers, not as dead zero rows

This keeps active state small and avoids fake open-position clutter.

### Reopen rule

If a user fully exits and later buys the same outcome again:
- a new active position row may be created
- history continuity comes from `trades`, `realization_events`, and ledger
- a later `positionCycleId` can be added if grouping becomes useful

### Read consistency rule

Derived portfolio reads should carry an `asOf` notion and avoid mixing:
- fresh position rows
- stale price marks
- stale cash state

Early V1 recommendation:
- treat `PortfolioSnapshot` as conceptually first-class
- compute it from source truth first
- only cache it later if performance requires it

## Numeric Precision And Rounding V1

Precision policy is engine policy, not formatting garnish.

### Required now

Use fixed-point math only:
- no floating-point storage
- no JavaScript `number` as money-truth
- no scientific notation in API, storage, or canonical hash payloads

Canonical scales:
- money amounts: `6` decimal places
- share amounts: `6` decimal places
- outcome prices: `8` decimal places
- internal LMSR/trade math: at least `18` decimal places

Why:
- money and shares need clean settlement and PnL math
- prices need finer movement than ledger values
- internal LMSR math needs more precision than persisted boundaries

### Storage and normalization

Persist normalized decimal strings only.

Examples:
- money: `1000.000000`
- shares: `42.125000`
- price: `0.61340000`

Rules:
- no commas
- no currency symbols
- no scientific notation
- no variable decimal width in canonical payloads

### Core arithmetic rules

Rules:
- compute in high precision first
- round only at the execution/storage boundary
- multiply before divide
- never let mid-formula rounding become hidden economic policy

### Shared quantization helpers

Engine should centralize quantization through explicit helpers:
- `quantizeMoney`
- `quantizeShares`
- `quantizePrice`

These helpers should be reused by:
- trade execution
- ledger posting
- portfolio valuation
- settlement
- canonical payload formatting

### Validation rules

Reject input that:
- exceeds allowed decimal precision
- uses malformed decimal strings
- uses scientific notation
- attempts negative values where the route forbids them

This keeps API and persistence rules aligned.

### Buy rounding rule

If the user submits spendable cash:
1. compute exact shares from LMSR state in high precision
2. floor shares to the allowed share precision
3. recompute cost from the floored share amount
4. debit the recomputed cost

Why:
- user never overspends
- engine never mints value through rounding
- any tiny leftover stays unspent, not silently lost

### Sell rounding rule

If the user submits shares to sell:
1. compute exact proceeds in high precision
2. floor proceeds to the allowed money precision
3. use the floored proceeds for ledger, cash, and realized PnL

Why:
- no accidental overpayment
- treasury remains conservative
- posted values stay deterministic

### Settlement rule

Settlement uses the same quantization discipline.

Rules:
- winner payout = winning shares * `1.000000`
- loser payout = `0.000000`
- because money and shares both use `6` decimal places, winner settlement is exact at the storage boundary

### PnL and valuation rule

Rules:
- realized PnL uses posted rounded execution values, not pre-rounded theoretical values
- `positionValue = shares * currentPrice` should compute in high precision and then quantize to money precision
- portfolio reads should use the same quantization rules everywhere, not route-by-route improvisation

### Display rule

Display precision is separate from engine precision.

Examples:
- UI may show money with `2` decimals
- UI may show detailed admin/accounting values with more precision
- UI may show prices in `2-4` decimals or percentage form

Important:
- display rounding never changes stored truth
- canonical payloads still use fixed normalized scales

Marked position value:

```text
position_value = shares * current_outcome_price
```

Resolved value:
- winning outcome pays `1` per share
- losing outcomes pay `0`

## Lifecycle Command Handshake

Publish, close, and resolve should be explicit commands across layer boundaries.

### Publish

`market management` prepares the market.
`core engine` decides whether the transition is structurally and financially legal.

Management responsibility:
- title/rules/source/outcomes are semantically ready for users
- publish readiness review is complete

Engine validation:
- market exists
- status is `draft`
- structural required fields are present
- outcome count and ordering are legal
- treasury exists or can be created
- seed funding is available
- timestamps/lifecycle transition are legal

Engine effects:
- create/finalize market treasury if needed
- move `platform_treasury -> market_treasury`
- initialize pricing state
- mark market `open`
- stamp publish audit trail

### Close

Deterministic close behavior is documented in:
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/horizon/authority-boundary.md`
- `systems/back/docs/horizon/schemas-v1.md`

Close is not a manual admin button.

Mental model:
- trigger may come from outside the engine core
- lifecycle truth stays inside the engine
- engine validates and executes the actual close transition

Possible close triggers:
- scheduled `closeAt`
- rule-based early close after Oracle confirms real-world close condition

Close command fields should include:
- `marketId`
- `actorId`
- `triggerType`
- `reason`
- `sourceUrl`
- `note`
- `oracleCaseId`
- `triggeredByOracleId`
- `approvedByHumanId`

Rules:
- management defines lifecycle rules up front
- Oracle may propose early close based on trusted-source status
- human oversight may confirm sensitive or ambiguous cases
- engine validates legal `open -> closed` transition and executes it

Important:
- closed market still keeps open positions active
- closed means no more trading, not yet settled truth

### Resolve

Winning outcome should not come from raw management preference.

Resolve command fields should include:
- `marketId`
- `actorId`
- `winningOutcomeId`
- `triggerType`
- `resolutionSourceUrl`
- `resolutionNote`
- `oracleCaseId`
- `proposedByOracleId`
- `approvedByHumanId`
- `evidenceSnapshot`

Handshake:
- management defines resolution rules and acceptable source policy ahead of time
- Oracle proposes a winner with evidence
- human oversight confirms when ambiguity, dispute, or sensitivity exists
- engine validates structural legality and performs settlement

Engine resolution flow:
1. validate market is `closed`
2. validate exactly one winning outcome
3. validate winner belongs to market
4. store source, notes, resolver/approver ids, and timestamp
5. mark market as `resolved`
6. settle winner and loser positions
7. credit user cash from market treasury
8. write realization events
9. remove zero-share active positions
10. write audit events

For small markets:
- settlement can happen inside one transaction

For larger markets:
- resolution write can create a settlement job
- settlement job processes winners in batches

User-facing rule never changes:
- a resolved market has exactly one winner

## Admin Command Contracts V1

These commands belong to the management/Oracle boundary, but execute through explicit backend endpoints.

### Create draft command

Endpoint:
- `POST /admin/markets`

Request:
- `marketId` optional
- `title`
- `description`
- `categoryKey`
- `openAt`
- `closeAt`
- `resolutionSource`
- `resolutionRules`
- `liquidityB`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`
- `outcomes[]`
- `idempotencyKey`

```ts
interface CreateMarketDraftRequest {
  marketId: string | null;
  title: string;
  description: string | null;
  categoryKey: string | null;
  openAt: string;
  closeAt: string;
  resolutionSource: string;
  resolutionRules: string;
  liquidityB: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  outcomes: Array<{
    outcomeId: string | null;
    label: string;
    shortLabel: string | null;
    description: string | null;
    colorKey: string | null;
  }>;
  idempotencyKey: string;
}
```

Response:
- `marketId`
- `status`
- `createdAt`
- `openAt`
- `closeAt`
- `outcomeIds`
- `auditEventId`

```ts
interface CreateMarketDraftResponse {
  marketId: string;
  status: 'draft';
  createdAt: string;
  openAt: string;
  closeAt: string;
  outcomeIds: string[];
  auditEventId: string;
}
```

### Publish command

Endpoint:
- `POST /admin/markets/:id/publish`

Request:
- `marketId`
- `actorId`
- `publishAt`
- `seedAmount`
- `note`
- `reviewId`
- `checklistVersion`
- `managementApprovedAt`

V1 rule:
- keep the "good now" fields present from day one
- nullable is fine at first
- stable contract is better than reshaping later

```ts
interface PublishMarketRequest {
  marketId: string;
  actorId: string;
  publishAt: string | null;
  seedAmount: string;
  note: string | null;
  reviewId: string | null;
  checklistVersion: string | null;
  managementApprovedAt: string | null;
}
```

Response:
- `marketId`
- `status`
- `publishedAt`
- `marketTreasuryAccountId`
- `seedTransactionId`
- `marketStateVersion`
- `auditEventId`

```ts
interface PublishMarketResponse {
  marketId: string;
  status: 'open';
  publishedAt: string;
  marketTreasuryAccountId: string;
  seedTransactionId: string;
  marketStateVersion: number;
  auditEventId: string;
}
```

### Close command

Endpoint:
- `POST /admin/markets/:id/close`

Request:
- `marketId`
- `actorId`
- `triggerType`
- `reason`
- `sourceUrl`
- `note`
- `oracleCaseId`
- `triggeredByOracleId`
- `approvedByHumanId`

```ts
interface CloseMarketRequest {
  marketId: string;
  actorId: string;
  triggerType: 'scheduled_time' | 'oracle_confirmed_event_completion';
  reason: string;
  sourceUrl: string | null;
  note: string | null;
  oracleCaseId: string | null;
  triggeredByOracleId: string | null;
  approvedByHumanId: string | null;
}
```

Response:
- `marketId`
- `status`
- `closedAt`
- `triggerType`
- `auditEventId`

```ts
interface CloseMarketResponse {
  marketId: string;
  status: 'closed';
  closedAt: string;
  triggerType: 'scheduled_time' | 'oracle_confirmed_event_completion';
  auditEventId: string;
}
```

### Resolve command

Endpoint:
- `POST /admin/markets/:id/resolve`

Request:
- `marketId`
- `actorId`
- `winningOutcomeId`
- `triggerType`
- `resolutionSourceUrl`
- `resolutionNote`
- `oracleCaseId`
- `proposedByOracleId`
- `approvedByHumanId`
- `evidenceSnapshot`

```ts
interface ResolveMarketRequest {
  marketId: string;
  actorId: string;
  winningOutcomeId: string;
  triggerType: 'oracle_proposal' | 'human_reviewed_oracle_resolution';
  resolutionSourceUrl: string;
  resolutionNote: string;
  oracleCaseId: string | null;
  proposedByOracleId: string | null;
  approvedByHumanId: string | null;
  evidenceSnapshot: string | null;
}
```

Response:
- `marketId`
- `status`
- `winningOutcomeId`
- `resolutionId`
- `resolvedAt`
- `settlementStatus`
- `auditEventId`

```ts
interface ResolveMarketResponse {
  marketId: string;
  status: 'resolved';
  winningOutcomeId: string;
  resolutionId: string;
  resolvedAt: string;
  settlementStatus: 'completed' | 'queued';
  auditEventId: string;
}
```

### Audit rule

All three commands should leave a clear audit trail with:
- actor
- command payload snapshot
- source/evidence references where relevant
- resulting market state transition

This is not optional glue.
It is part of the trust model.

## Quote Contract V1

Quote is a server-computed execution preview.

Use it for:
- active trade-ticket preview
- confirmation before submit
- slippage awareness

Do not use it for:
- passive feed/card rendering
- long-lived promises about final execution

### Quote lanes

Keep two different lanes:

#### 1. Active trade-ticket quote

This is the real quote endpoint.

Rules:
- auth-bound
- user-specific
- scoped to one market and one outcome
- short-lived
- refreshed only while the trade ticket is active
- server-authoritative but still advisory

Recommended cadence:
- frontend debounce on input change: about `250-400ms`
- backend quote refresh ceiling: about `1s`
- quote expiry: about `2-3s`

Important:
- trade execution must still revalidate live state on submit

#### 2. Passive market preview

General systems/seer/detail surfaces should not spam the quote endpoint.

Use:
- normal market read models
- latest price fields
- market state version / last updated markers
- slower refresh or movement-based refresh

This keeps quote compute focused on actual trading intent instead of decorative page churn.

### Request shape

For V1, keep only two quote modes:

Buy quote:
- `marketId`
- `outcomeId`
- `side = buy`
- `cashAmount`

Sell quote:
- `marketId`
- `outcomeId`
- `side = sell`
- `shareAmount`

Reason:
- buy starts naturally from spendable cash
- sell starts naturally from owned shares
- matches the current frontend ticket model
- matches the rounding policy already chosen

```ts
type QuoteRequest =
  | {
      marketId: string;
      outcomeId: string;
      side: 'buy';
      cashAmount: string;
    }
  | {
      marketId: string;
      outcomeId: string;
      side: 'sell';
      shareAmount: string;
    };
```

### Response shape

Common required fields:
- `quoteId`
- `quoteLane`
- `marketId`
- `outcomeId`
- `side`
- `marketStateVersion`
- `priceBefore`
- `priceAfter`
- `priceImpact`
- `averageExecutionPrice`
- `slippage`
- `quotedAt`
- `expiresAt`

Buy-specific required fields:
- `requestedCashAmount`
- `estimatedCost`
- `estimatedUnspentCash`
- `estimatedShares`

Sell-specific required fields:
- `requestedShareAmount`
- `estimatedSharesSold`
- `estimatedProceeds`
- `estimatedRealizedPnlDelta`

```ts
type QuoteResponse =
  | {
      quoteId: string;
      quoteLane: 'trade_ticket';
      marketId: string;
      outcomeId: string;
      side: 'buy';
      marketStateVersion: number;
      requestedCashAmount: string;
      estimatedCost: string;
      estimatedUnspentCash: string;
      estimatedShares: string;
      priceBefore: string;
      priceAfter: string;
      priceImpact: PriceImpact;
      averageExecutionPrice: string;
      slippage: string;
      quotedAt: string;
      expiresAt: string;
    }
  | {
      quoteId: string;
      quoteLane: 'trade_ticket';
      marketId: string;
      outcomeId: string;
      side: 'sell';
      marketStateVersion: number;
      requestedShareAmount: string;
      estimatedSharesSold: string;
      estimatedProceeds: string;
      estimatedRealizedPnlDelta: string;
      priceBefore: string;
      priceAfter: string;
      priceImpact: PriceImpact;
      averageExecutionPrice: string;
      slippage: string;
      quotedAt: string;
      expiresAt: string;
    };
```

### Validation rules

Reject quote when:
- market is not `open`
- outcome does not belong to market
- buy amount is malformed or too small after quantization
- sell amount is malformed or exceeds owned shares
- user account is locked for outgoing trade activity

### Precision rules

Quote values must follow engine precision policy:
- money: `6dp`
- shares: `6dp`
- prices: `8dp`

Important:
- buy quote should floor shares and then recompute cost
- sell quote should floor proceeds
- quote response must use the same normalized numeric format as later execution paths

### Freshness rules

Rules:
- quote is advisory, not binding
- `expiresAt` is real, not decorative
- trade submit may ignore an old quote and recompute from live state
- if same user asks for same quote input against unchanged `marketStateVersion`, backend may reuse the cached quote result within the short trade-ticket window

### Read separation rule

Passive price surfaces should come from:
- `GET /markets`
- `GET /markets/:id`
- later market summary caches if needed

Trade-ticket quote should come from:
- `POST /markets/:id/quote`

This keeps the engine from doing trade-grade quote work for every casual page refresh.

## Trade Contract V1

Trade is the final execution request.

It is:
- money-moving
- position-moving
- ledger-writing
- server-authoritative

It is not:
- advisory
- a promise copied from an old quote

### Endpoint

- `POST /markets/:id/trades`

### Core execution rule

Trade should execute against current live market state inside one database transaction.

Rules:
- quote may help UX, but trade is the real source of execution truth
- if the market moved since quote, the trade is still a buy/sell request and should normally execute at current state
- stale market movement should not create fake rejection loops in V1
- market-open checks and requested/execution outcome index lookup are shared engine rules, not duplicated quote/trade guesses
- later slippage guards or special-delay markets can tighten this behavior if needed

### Request shape

For V1, keep two execution modes only:

Buy trade:
- `marketId`
- `outcomeId`
- `side = buy`
- `cashAmount`
- `idempotencyKey`

Sell trade:
- `marketId`
- `outcomeId`
- `side = sell`
- `shareAmount`
- `idempotencyKey`

Useful nullable fields from day one:
- `quoteId`
- `quotedAt`
- `quoteExpiresAt`
- `expectedMarketStateVersion`

Reason:
- easier UI wiring
- easier debug/support traces
- easier future tightening without reshaping the contract

```ts
type TradeRequest =
  | {
      marketId: string;
      outcomeId: string;
      side: 'buy';
      cashAmount: string;
      idempotencyKey: string;
      quoteId: string | null;
      quotedAt: string | null;
      quoteExpiresAt: string | null;
      expectedMarketStateVersion: number | null;
    }
  | {
      marketId: string;
      outcomeId: string;
      side: 'sell';
      shareAmount: string;
      idempotencyKey: string;
      quoteId: string | null;
      quotedAt: string | null;
      quoteExpiresAt: string | null;
      expectedMarketStateVersion: number | null;
    };
```

### Response shape

Return executed facts, not a soft success blob.

Common required fields:
- `tradeId`
- `marketId`
- `outcomeId`
- `side`
- `quoteId`
- `marketStateVersionBefore`
- `marketStateVersionAfter`
- `priceBefore`
- `priceAfter`
- `priceImpact`
- `averageExecutionPrice`
- `availableCashAfter`
- `positionSharesAfter`
- `positionCostBasisAfter`
- `executedAt`

Buy-specific required fields:
- `cashSpent`
- `sharesBought`

Sell-specific required fields:
- `sharesSold`
- `proceedsReceived`
- `realizedPnlDelta`

```ts
type TradeResponse =
  | {
      tradeId: string;
      marketId: string;
      outcomeId: string;
      side: 'buy';
      quoteId: string | null;
      marketStateVersionBefore: number;
      marketStateVersionAfter: number;
      cashSpent: string;
      sharesBought: string;
      priceBefore: string;
      priceAfter: string;
      priceImpact: PriceImpact;
      averageExecutionPrice: string;
      availableCashAfter: string;
      positionSharesAfter: string;
      positionCostBasisAfter: string;
      executedAt: string;
    }
  | {
      tradeId: string;
      marketId: string;
      outcomeId: string;
      side: 'sell';
      quoteId: string | null;
      marketStateVersionBefore: number;
      marketStateVersionAfter: number;
      sharesSold: string;
      proceedsReceived: string;
      realizedPnlDelta: string;
      priceBefore: string;
      priceAfter: string;
      priceImpact: PriceImpact;
      averageExecutionPrice: string;
      availableCashAfter: string;
      positionSharesAfter: string;
      positionCostBasisAfter: string;
      executedAt: string;
    };
```

### Validation rules

Reject trade when:
- market is not `open`
- outcome does not belong to market
- user account is locked for outgoing trade activity
- amount is malformed or over-precision
- buy `cashAmount` exceeds `availableCash`
- sell `shareAmount` exceeds owned shares
- quantized execution amount becomes zero
- same `idempotencyKey` is reused with different payload

### Idempotency rule

`idempotencyKey` is required.

Rules:
- same user + same action + same key + same payload returns the same prior result
- same key with different payload is a hard reject
- real rapid trading is allowed through new keys, not blocked by old ones

### Quote relation rule

Trade may carry quote context, but should not depend on quote freshness for validity.

Rules:
- `quoteId`, `quotedAt`, and `expectedMarketStateVersion` are support/debug fields first
- server still recomputes current execution inside the transaction
- market movement after quote does not turn the trade into an automatic reject in normal V1 flow

### Precision rule

Trade execution uses the same precision policy already chosen:
- buy floors shares, then recomputes cost
- sell floors proceeds
- response returns posted rounded execution values
- ledger values remain final truth

### Position boundary rule

If a sell or settlement leaves `positionSharesAfter = 0`:
- remove the active position row in the same transaction
- return `0.000000` in the response

This keeps open-position state clean while still letting the frontend understand the closeout result.

## Trade Execution Flow V1

Trade execution should be split into:
- light preflight outside the database transaction
- full authoritative execution inside one database transaction

Reason:
- cheap rejects can happen early
- money/pricing/position truth must still commit atomically

### Preflight outside transaction

Allowed outside-tx checks:
- auth/session presence
- request shape parsing
- decimal-format validation
- side/input mode validation
- obvious malformed ids

Important:
- these checks are convenience, not final truth
- market state, balances, positions, and pricing must still be revalidated inside the transaction

### Inside one database transaction

Authoritative flow:

1. load and lock idempotency scope
2. load and lock market state
3. load and lock relevant account rows
4. load and lock active position row if present
5. revalidate market lifecycle and ownership rules
6. short-circuit duplicate request if same idempotency key already completed
7. reject if same idempotency key was used with different payload
8. recompute execution from current LMSR state
9. quantize execution values by the shared precision policy
10. revalidate cash/shares against the quantized execution
11. build ledger transaction and entries
12. apply pricing state update
13. apply position update
14. insert trade record
15. insert realization event if sell realizes PnL
16. post ledger transaction + entries
17. update cached account balances if the system keeps them
18. remove active position row if resulting shares are `0`
19. persist idempotency result
20. commit

Nothing in steps `8-19` should leak outside the same commit boundary.

### Locking rule

Within the transaction, lock at least:
- market pricing state for the target market
- user cash account
- target market treasury account
- active position row for `userId + marketId + outcomeId` if it exists
- idempotency record scope for the caller/key

This prevents double-spend, double-sell, and conflicting market-state writes.

### Buy flow detail

Inside the tx:
1. compute exact shares from current LMSR state and requested `cashAmount`
2. floor shares to share precision
3. recompute actual `cashSpent`
4. reject if `cashSpent > availableCash`
5. debit `user_cash`, credit `market_treasury`
6. increase position shares and cost basis
7. bump market pricing state/version
8. persist trade response facts from posted values

### Sell flow detail

Inside the tx:
1. verify owned shares from the active position
2. compute exact proceeds from the reverse LMSR move
3. floor proceeds to money precision
4. compute removed cost basis using weighted-average accounting
5. compute `realizedPnlDelta = proceedsReceived - removedCostBasis`
6. debit `market_treasury`, credit `user_cash`
7. reduce position shares and cost basis
8. increase position realized PnL by the realized delta
9. write `RealizationEvent`
10. bump market pricing state/version

### Response assembly rule

Trade response should be assembled from committed execution facts:
- posted ledger values
- persisted trade row
- persisted market state version change
- resulting position state
- resulting available cash

Not from pre-commit theoretical numbers.

### Failure rule

If any authoritative step fails:
- rollback everything
- no partial ledger
- no partial pricing change
- no partial position mutation
- no half-written trade row

### Duplicate-submit rule

If the same logical trade arrives twice:
- same `idempotencyKey` + same payload -> return stored prior result
- same `idempotencyKey` + different payload -> reject

This check must happen before any second mutation path runs.

### Market-move rule

Trade should execute against current locked market state inside the transaction.

Meaning:
- old quote may be stale
- current execution facts still become the truth
- backend does not owe the user the old preview, only a valid live execution

### Write ownership rule

Trade service owns:
- pricing state mutation
- position mutation
- trade row insertion
- realization event insertion when needed
- ledger posting for the trade

Other services should not partially mutate those records around it.

## Resolution Execution Flow V1

Resolution closes market truth and then closes open exposure.

Treat it as two linked phases:
- resolution decision
- settlement execution

### Resolution decision phase

Inside one authoritative command:
1. lock market row/state
2. verify market is `closed`
3. verify market is not already resolved
4. verify `winningOutcomeId` belongs to the market
5. verify exactly one winning outcome
6. write `market_resolutions` row
7. mark market `resolved`
8. set `settlementStatus`
9. write audit event
10. decide settlement mode

Important:
- `market.status = resolved` means truth is fixed
- domain/read model uses `settlementStatus`
- DB schema uses `settlement_status`
- both mean payout progress after truth is fixed
- unresolved markets may keep this field as `null`

Recommended `settlementStatus` values:
- `pending`
- `processing`
- `completed`

### Settlement execution phase

Settlement turns open positions into:
- cash movement for winners
- realized history for all positions
- removal from active positions

### Winner settlement

For each winning position:
1. lock market treasury
2. lock user cash account
3. lock active position row
4. compute `payout = shares * 1.000000`
5. compute `realizedPnlDelta = payout - remainingCostBasis`
6. post ledger transaction:
   - `market_treasury -> user_cash`
7. update position realized PnL
8. write `RealizationEvent` with type `resolution_win`
9. remove active position row

### Loser settlement

For each losing position:
1. lock active position row
2. compute `payout = 0.000000`
3. compute `realizedPnlDelta = 0 - remainingCostBasis`
4. do not post a money-ledger transaction
5. update position realized PnL
6. write `RealizationEvent` with type `resolution_loss`
7. remove active position row

Important:
- loser closeout still must be explicitly recorded
- loser closeout belongs in event/history truth
- money ledger stays for real money movement only

### Ledger vs event rule

Keep one ledger only.

Rules:
- `ledger_transactions` and `ledger_entries` record money movement only
- `realization_events`, `market_resolutions`, and `audit_events` record non-money closeout truth
- losing positions should not create fake zero-value ledger rows just to look symmetrical

This keeps accounting clean without hiding half the story.

### Treasury sweep rule

After all positions in the market are settled:
1. verify no active positions remain for the market
2. verify settlement batches/jobs are complete if async
3. move leftover `market_treasury -> platform_treasury`
4. post `treasury_sweep`
5. set `settlementStatus = completed`

Important:
- never sweep before all winner payouts are complete

### Inline vs queued settlement

Small markets:
- resolution and settlement may finish in one flow

Larger markets:
- resolution fixes truth first
- settlement may run in queued batches
- final sweep happens only after all batches complete

### Account-status rule

Settlement payout should still succeed when:
- user trading is locked
- user is deactivated from active trading

Reason:
- settlement is owed value
- it is not a new outgoing user trade

### Failure rule

If settlement hits an invariant break:
- stop
- rollback the current settlement chunk/transaction
- alert operators

Examples:
- market treasury cannot cover winner payout
- active positions remain after market marked fully settled

These are not soft warnings.
They mean the market-accounting assumptions broke.

## Schema Cut V1

For the first real engine migration set, keep the schema small but complete enough to support:
- pricing truth
- money truth
- active positions
- trade history
- resolution history
- audit/debug

### Required now

First migration set should include:
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

Reason:
- this is the smallest set that still supports trustworthy quote/trade/resolve flows
- cutting any of these weakens either money truth, history truth, or replay/debug ability

### Notes on required tables

`market_pricing_state` should stay minimal:
- `market_id`
- `version`
- `liquidity_b`
- `updated_at`

Do not add market-level pricing junk too early.

`market_outcome_state` should carry:
- `q_shares` as source truth
- `last_price` as useful current-state read/debug field

`positions` should stay active-only:
- no zero-share graves
- one active row per `user_id + market_id + outcome_id`

`markets.settlement_status` should stay nullable until settlement work becomes relevant:
- `null` before resolution begins
- `pending | processing | completed` once payout progress actually exists

`audit_events` belongs in V1:
- not because money math needs it
- because first-version debug, trust, and admin traceability need it

`idempotency_records` also belongs in V1:
- trade hardening needs it immediately
- later admin commands can reuse the same pattern

### Later / V2 schema tables

Do not put these in the first migration set:
- `position_cycles`
- `settlement_batches`
- `portfolio_snapshot_cache`
- `market_summary_cache`
- `oracle_cases`
- `review_cases`
- linked-market relation tables
- fee/reward tables
- public API usage tables

These are real later candidates, not V1 foundation.

## Data Model Sketch

Start with these core tables:

### `markets`
- `id`
- `status`
- `title`
- `description`
- `category_key`
- `open_at`
- `close_at`
- `resolution_source`
- `resolution_rules`
- `liquidity_b`
- `market_treasury_account_id`
- `created_by`

### `market_outcomes`
- `id`
- `market_id`
- `label`
- `sort_order`
- `initial_probability`
- `winning_state`

### `market_pricing_state`
- `market_id`
- `version`
- `liquidity_b`
- `updated_at`

### `market_outcome_state`
- `market_id`
- `outcome_id`
- `q_shares`
- `last_price`

### `accounts`
- `id`
- `type`
- `owner_id`
- `status`
- `created_at`
- `balance_cached`
- `locked_reason`
- `updated_at`

### `ledger_transactions`
- `id`
- `sequence_number`
- `type`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `created_by`
- `created_at`
- `posted_at`
- `market_id`
- `outcome_id`
- `compensates_transaction_id`
- `compensation_reason`
- `triggered_by`
- `triggered_by_id`
- `position_id`
- `position_cycle_id`
- `trade_side`
- `trade_price_before`
- `trade_price_after`
- `resolution_id`
- `shares_settled`
- `settlement_price`
- `settlement_batch_id`
- `previous_transaction_hash`
- `transaction_hash`

### `ledger_entries`
- `id`
- `transaction_id`
- `account_id`
- `amount`
- `entry_role`
- `memo`

### `trades`
- `id`
- `market_id`
- `outcome_id`
- `user_id`
- `side`
- `cash_amount`
- `share_amount`
- `avg_price`
- `price_before`
- `price_after`
- `idempotency_key`

### `positions`
- `user_id`
- `market_id`
- `outcome_id`
- `shares`
- `cost_basis`
- `realized_pnl`
- `created_at`
- `updated_at`
- `last_trade_at`
- `settled_at`

### `realization_events`
- `id`
- `user_id`
- `market_id`
- `outcome_id`
- `type`
- `shares_closed`
- `proceeds`
- `removed_cost_basis`
- `realized_pnl`
- `trade_id`
- `resolution_id`
- `created_at`

### `market_resolutions`
- `id`
- `market_id`
- `winning_outcome_id`
- `resolved_by`
- `source_url`
- `notes`
- `resolved_at`

### `idempotency_records`
- `id`
- `scope`
- `actor_id`
- `idempotency_key`
- `request_hash`
- `status`
- `response_snapshot`
- `resource_type`
- `resource_id`
- `error_code`
- `error_message`
- `created_at`
- `completed_at`

### `audit_events`
- `id`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `payload`
- `created_at`

## Constraints And Indexes V1

Goal:
- let the database enforce the truths we already chose
- keep concurrency and money paths from depending only on polite service code

### `markets`

Constraints:
- primary key on `id`
- check-valid `status`
- check `open_at < close_at`
- check `liquidity_b > 0`
- check-valid `settlement_status` if stored on the market row

Indexes:
- `status`
- `close_at`
- `(status, close_at)` for later lifecycle sweeps

### `market_outcomes`

Constraints:
- primary key on `id`
- foreign key `market_id -> markets.id`
- unique `(market_id, id)` to support market-scoped composite references cleanly
- unique `(market_id, sort_order)`
- unique `(market_id, label)`

Indexes:
- `market_id`

### `market_pricing_state`

Constraints:
- primary key or unique on `market_id`
- foreign key `market_id -> markets.id`
- check `version >= 0`
- check `liquidity_b > 0`

Indexes:
- unique `market_id`

Important:
- this row is a hot lock target in the trade path

### `market_outcome_state`

Constraints:
- foreign key `market_id -> markets.id`
- foreign key `outcome_id -> market_outcomes.id`
- prefer a composite reference so `outcome_id` is guaranteed to belong to the same `market_id`
- unique `(market_id, outcome_id)`
- check `q_shares >= 0`
- check `last_price >= 0 and <= 1`

Indexes:
- unique `(market_id, outcome_id)`

### `accounts`

Constraints:
- primary key on `id`
- check-valid `type`
- check-valid `status`
- one `user_cash` per user
- one `market_treasury` per market
- one `platform_treasury`
- one `mint_source`
- one `sink`

Indexes:
- `owner_id`
- `(type, owner_id)`

Important:
- these uniqueness rules should use partial unique indexes where needed

### `ledger_transactions`

Constraints:
- primary key on `id`
- unique `sequence_number`
- unique `transaction_hash`
- nullable foreign key `compensates_transaction_id -> ledger_transactions.id`
- check `sequence_number > 0`

Indexes:
- unique `sequence_number`
- unique `transaction_hash`
- `(reference_type, reference_id)`
- `market_id`
- `outcome_id`
- `posted_at`
- `compensates_transaction_id`

### `ledger_entries`

Constraints:
- primary key on `id`
- foreign key `transaction_id -> ledger_transactions.id`
- foreign key `account_id -> accounts.id`
- check `amount <> 0`

Indexes:
- `transaction_id`
- `account_id`
- `(account_id, transaction_id)`

Important:
- zero-sum per transaction is still a service/transaction invariant in V1
- later it could move into a deferred constraint trigger if we really need it

### `trades`

Constraints:
- primary key on `id`
- foreign keys to `user_id`, `market_id`, `outcome_id`
- prefer a market-scoped outcome reference so the trade cannot point at an outcome from another market
- check-valid `side`
- check `cash_amount > 0`
- check `share_amount > 0`

Indexes:
- `user_id`
- `market_id`
- `(user_id, created_at)`
- `(market_id, created_at)`

### `positions`

Constraints:
- foreign keys to `user_id`, `market_id`, `outcome_id`
- prefer a market-scoped outcome reference so the position cannot drift across markets
- unique `(user_id, market_id, outcome_id)`
- check `shares > 0`
- check `cost_basis >= 0`

Indexes:
- unique `(user_id, market_id, outcome_id)`
- `user_id`
- `market_id`

Important:
- zero-share rows do not belong here

### `realization_events`

Constraints:
- primary key on `id`
- foreign keys to `user_id`, `market_id`, `outcome_id`
- prefer a market-scoped outcome reference here too
- nullable foreign keys `trade_id` and `resolution_id`
- check-valid `type`
- check `shares_closed > 0`

Indexes:
- `user_id`
- `market_id`
- `resolution_id`
- `(user_id, created_at)`

### `market_resolutions`

Constraints:
- one row per market
- foreign key `market_id -> markets.id`
- foreign key `winning_outcome_id -> market_outcomes.id`
- prefer a market-scoped outcome reference so the winner must belong to the same market

Indexes:
- unique `market_id`
- `resolved_at`

### `idempotency_records`

Constraints:
- primary key on `id`
- unique `(scope, actor_id, idempotency_key)`
- check-valid `status`
- check `request_hash` is not empty

Indexes:
- unique `(scope, actor_id, idempotency_key)`
- `created_at`
- `(resource_type, resource_id)`

### `audit_events`

Constraints:
- primary key on `id`
- check action is not empty
- keep `entity_type + entity_id` generic; no polymorphic FK acrobatics in V1

Indexes:
- `actor_id`
- `(entity_type, entity_id)`
- `created_at`

### Cross-row Rules That Stay In Service Logic First

Do not pretend all truth belongs in plain row checks.

Keep these in service/transaction logic first:
- ledger entries per transaction must sum to zero
- winning outcome must belong to the resolved market
- user cannot sell more than owned
- user cash cannot go negative after execution
- market treasury should not go negative in normal operation
- exactly one winner per resolved market
- trade only when market status is `open`
- settlement only after legal resolve transition

### Main Lock Targets

Trade hot path likely locks:
- `idempotency_records`
- `market_pricing_state`
- touched `market_outcome_state` rows
- buyer `user_cash`
- market `market_treasury`
- active `positions` row

Resolution hot path likely locks:
- market row
- market treasury
- affected positions and user cash rows in chunks

## DB Architecture Details V1

Goal:
- keep the persistence layer explicit
- avoid future schema hell while the engine is still forming

### Text + check, not DB enums

Recommendation:
- use text columns plus check constraints for V1 state fields

Good fits:
- `markets.status`
- `markets.settlement_status`
- `accounts.type`
- `accounts.status`
- `trades.side`
- `realization_events.type`
- `idempotency_records.status`
- ledger `type` and `reference_type`

Why:
- easier migrations
- easier value changes
- less enum-alter friction during product formation

### Numeric column policy

Use Postgres `numeric` for persisted engine values.

Recommended scales:
- money: `numeric(20,6)`
- shares: `numeric(20,6)`
- prices: `numeric(12,8)`
- liquidity `b`: `numeric(20,8)` unless schema work proves a tighter fit

Never use:
- `float`
- `double precision`

### Timestamp policy

Store:
- `timestamptz`
- UTC

Display:
- convert to Israel time in the systems/design/read layer

### ID policy

Use opaque string ids for domain entities:
- markets
- outcomes
- accounts
- trades
- realization events
- audit events
- idempotency records

Keep ledger ordering separate with:
- `sequence_number`

### `jsonb` policy

Use `jsonb` surgically:
- `audit_events.payload`
- `idempotency_records.response_snapshot`
- later evidence snapshots if needed

Do not use `jsonb` as a hiding place for core engine truth.

### Nullability discipline

Rules:
- core truth fields should be `NOT NULL`
- nullable only when the meaning is genuinely optional

Good nullable examples:
- `compensates_transaction_id`
- `trade_id` on `realization_events`
- `resolution_id` on `realization_events`
- `locked_reason`

Avoid nullable mush on:
- ids
- statuses
- core amounts
- required timestamps
- required foreign keys

### Default-value discipline

Good defaults:
- `created_at = now()`
- obvious lifecycle defaults like active status where safe

Bad defaults:
- fake balances
- fake prices
- hidden business-state shortcuts

### Foreign-key delete policy

Recommendation:
- trusted history tables should prefer `ON DELETE RESTRICT`
- cascade only for rows that are purely dependent and safe to remove

Important:
- deleting a market should not silently vaporize trades, ledger, or audit history

### Market-scoped ownership references

Important:
- wherever a row carries both `market_id` and `outcome_id`, prefer composite FK/uniqueness patterns that guarantee the outcome belongs to that same market

Applies especially to:
- `market_outcome_state`
- `trades`
- `positions`
- `realization_events`
- `market_resolutions`

This stops cross-market identity drift at the DB level instead of leaving it only to service code.

### `updated_at` policy

V1 recommendation:
- app/service sets `updated_at`
- no hidden DB trigger magic yet

### Migration discipline

Rules:
- forward-only migrations
- never edit already-applied migrations
- each schema change gets a real migration
- destructive changes need explicit plan

### Constraint/index naming

Name:
- foreign keys
- unique constraints
- checks
- indexes

Why:
- better error messages
- easier ops/debug later

### Partial unique indexes

Use them explicitly for:
- single `platform_treasury`
- single `mint_source`
- single `sink`
- one `market_treasury` per market
- one `user_cash` per user

### Transaction isolation posture

V1 recommendation:
- `READ COMMITTED`
- explicit row locks on hot paths

Do not jump to `SERIALIZABLE` unless real contention proves it necessary.

### No hidden DB business logic

Keep DB magic minimal in V1.

Okay later if proven useful:
- timestamp helpers
- deferred constraint trigger for ledger balance

Not okay:
- burying trade or settlement logic in triggers/functions

### Dev reset posture

Local workflow should support:
- reset
- migrate
- seed

Clean reset is a first-class feature, not a side quest.

## Migration And Rollout Strategy V1

Goal:
- turn the locked schema into real metal without mega-migration soup

Core rules:
- forward-only migrations
- never edit already-applied migrations
- one concern per migration
- schema and seed stay separate
- use expand/contract thinking for later schema evolution

Recommended first migration chain:

### `001_core_market_tables`
- `markets`
- `market_outcomes`
- `market_pricing_state`
- `market_outcome_state`

### `002_economy_tables`
- `accounts`
- `ledger_transactions`
- `ledger_entries`

### `003_trading_tables`
- `trades`
- `positions`
- `idempotency_records`

### `004_resolution_and_audit_tables`
- `realization_events`
- `market_resolutions`
- `audit_events`

### `005_constraints_and_indexes_hardening`
- partial unique indexes
- composite market/outcome safety refs
- hot-path indexes
- named checks and foreign keys

Why this split:
- easier to read
- easier to debug
- less schema archaeology later

Important:
- seed data should not live in migration files
- migrations build the house
- seeds place the first furniture inside

Recommended file style:
- numbered SQL files
- short purpose-driven names

Examples:
- `001_core_market_tables.sql`
- `005_constraints_and_indexes_hardening.sql`

Recommended local rollout order:
1. start postgres
2. run migrations
3. run seed
4. boot backend
5. run smoke checks

Later-change rule:
- additive first
- app learns new shape
- destructive/contract step only after that

## API Shape V1

Admin:
- `POST /admin/markets`
- `POST /admin/markets/:id/publish`
- `POST /admin/markets/:id/close`
- `POST /admin/markets/:id/resolve`

Trading:
- `POST /api/markets/:id/quote`
- `POST /api/markets/:id/trades`

Reads:
- `GET /api/markets`
- `GET /api/markets/:id`
- `GET /api/markets/:id/prices`
- `GET /api/markets/:id/trades`
- `GET /api/markets/:id/positions`
- `GET /api/markets/:id/price-history`
- `GET /api/markets/:id/stream`
- `GET /api/market-detail/markets/:id`
- `GET /api/portfolio/snapshot`
- `GET /api/portfolio/orders`
- `GET /api/portfolio/history`
- `GET /api/portfolio/performance`

Notes:
- `quote` endpoint is advisory and belongs to the active trade-ticket lane
- `trades` always recomputes quote inside the transaction
- `side` belongs in the request body, not the route name
- all write endpoints should require idempotency handling
- passive market surfaces should use market reads, not quote spam
- trade should normally execute on current live state even if the quote is stale
- public market positions read from `contract_positions`, while engine accounting still mutates outcome-native `positions`

## Idempotency Records V1

Purpose:
- dedupe retry for write actions
- return the same result for the same logical request
- reject same key with different payload
- protect money paths and privileged lifecycle commands

Required V1 write scopes:
- `trade`
- `publish_market`
- `close_market`
- `resolve_market`

Rules:
- unique scope should be `scope + actor_id + idempotency_key`
- same scope + actor + key + request hash should return the same result
- same scope + actor + key + different request hash should hard reject
- passive reads and quote reads do not need idempotency rows

Recommended V1 fields:
- `id`
- `scope`
- `actor_id`
- `idempotency_key`
- `request_hash`
- `status`
- `response_snapshot`
- `resource_type`
- `resource_id`
- `error_code`
- `error_message`
- `created_at`
- `completed_at`

Recommended V1 status values:
- `in_progress`
- `completed`
- `failed`

Best-practice coordination rule:
- create the idempotency row and perform the business mutation inside the same PostgreSQL transaction
- update the row to `completed` with the final response snapshot before commit
- if the transaction rolls back, both the business mutation and the idempotency row rollback together

Why this matters:
- avoids money-moving success with missing dedupe state
- avoids stuck fake `in_progress` truth after partial failure
- keeps retry behavior deterministic under concurrency and network retries

Implementation note:
- if the insert hits the unique constraint, load the existing row in the same transaction and:
  - return stored response for `completed`
  - reject as already processing for `in_progress`
  - reject conflict if request hash differs

Important:
- this is request-dedupe state, not ledger state
- `audit_events` and `idempotency_records` are related but different
- `audit_events` explain who did what
- `idempotency_records` prevent duplicate execution

## Implementation Order

### Phase 1
- define schema
- define TypeScript domain types
- implement pure LMSR math module
- write unit tests for pricing, quote, and settlement math

### Phase 2
- implement ledger module
- implement repositories
- implement transactional trade service

### Phase 3
- implement admin market service
- market create, publish, close, resolve
- add audit logging

### Phase 4
- expose HTTP endpoints
- add auth boundaries
- add request validation
- add rate limiting on sensitive routes

### Phase 5
- build portfolio read endpoints
- build discovery read endpoints from backend data

### Phase 6
- connect frontend in slices:
  - market detail first
  - portfolio second
  - discovery feeds after that

## Rollout Plan

Do not swap the whole frontend at once.

Recommended rollout:
1. backend runs with seeded test markets only
2. one market-detail page reads live market data and submits live trades
3. portfolio page reads backend positions and cash
4. discovery feeds switch from seeded JS data to backend reads
5. admin market creation and resolution tools move in last, behind strict auth

Reason:
- market detail is the core loop
- it proves pricing, balance, and portfolio integrity early
- it avoids breaking all discovery pages while the engine is still stabilizing

## Things That Must Be True Before Launch

- every trade is idempotent
- every balance change is explainable through ledger records
- every market has clear outcomes and resolution rules
- every state transition is server-validated
- every admin action is audited
- every resolved market pays exactly one winner outcome

## What To Build Next

After this doc is accepted:
1. choose the concrete backend folder layout
2. scaffold the service
3. implement the pure LMSR module first
4. add ledger + trade transaction flow
5. wire market-detail page to the first live endpoint
