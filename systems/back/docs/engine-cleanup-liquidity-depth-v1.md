# Engine Cleanup + Liquidity Depth v1

Updated: 2026-05-30
Status: active
Owner: back-engine

Purpose:
- make the market engine easier to audit and change
- replace "pool feels shallow" debates with repeatable LMSR depth numbers
- keep the current LMSR engine, but make its depth policy explicit

## Current Engine Shape

Main write path:
- `quote-service.ts` validates quote requests and produces preview math.
- `trade-service.ts` executes the authoritative write transaction.
- `lmsr.ts` owns pure price math: buy/sell, direct outcome and complement/no bundles.
- `contract-side-normalization.ts` maps requested `YES/NO` contracts into execution legs.
- `position-writes.ts` updates outcome-native `positions` and public/requested `contract_positions`.
- `ledger-writes.ts` and trade record writers persist cash movement and audit truth.

Important split:
- `positions` is engine/economic exposure by executed outcome.
- `contract_positions` is user/product exposure by requested outcome and contract side.
- Quote and trade must gate sell ownership through the same requested contract-position truth.

Shared cleanup modules added in this slice:
- `systems/back/src/engine/sell-ownership.ts`
  - shared quote/trade requested-contract sell ownership gate
- `systems/back/src/engine/market-state-guards.ts`
  - shared effective market-open guard
  - shared requested/execution outcome index resolver for direct and complement contracts
- `systems/back/src/engine/pricing/execution-quote.ts`
  - shared quote/trade LMSR quote selection for direct `YES`, binary `NO`, and multi-outcome complement paths

## Cleanup Findings

Known duplication / slop targets:
- Quote and trade both parse actor, market, contract execution, cash account, and some sell settlement details.
- Quote and trade both map quantized-zero sell errors into user-facing `untradeable_amount`.
- Quote and trade both build LMSR state from `liquidity_b + q_shares`.
- Sell cost-basis removal appears in quote PnL estimates and trade settlement.

Cleanup already landed:
- close-time trading eligibility now lives in `market-state-guards.ts`
- requested/execution outcome index lookup now lives in `market-state-guards.ts`
- quote and trade both use the same contract-position sell ownership helper
- quote and trade both use the same direct/complement LMSR execution quote builder

Non-goals for this slice:
- no new AMM
- no order book
- no silent live-market depth rebase
- no broad `trade-service.ts` rewrite before we have depth data and invariant tests

## Liquidity Depth Model

The current "pool" is LMSR `liquidity_b`.

Product meaning:
- higher `b` means more cash is needed to move probability
- volume is historical activity and does not imply current depth
- a high-volume market can still be shallow if `liquidity_b` is low

Starting test bands:
- toy/test: `b = 500 .. 1,500`
- small/social: `b = 2,500 .. 7,500`
- normal public: `b = 10,000 .. 25,000`
- serious economy/politics: `b = 25,000 .. 75,000`
- flagship/proof: `b = 100,000+`

Backend policy module:
- `systems/back/src/engine/pricing/liquidity-policy.ts`
- creation guard: `systems/back/src/lifecycle/management/market-creation-liquidity.ts`
- Seer materialization gate: `systems/back/src/lifecycle/management/seer-market-creation-service.ts`

Named presets:
- `toy_test`: recommended `b = 1,000`
- `small_social`: recommended `b = 5,000`
- `normal_public`: recommended `b = 25,000`
- `serious_economy_politics`: recommended `b = 75,000`
- `flagship_proof`: recommended `b = 100,000`

Creation policy direction:
- Seer/admin creation use `normal_public` as the boring default.
- BOI, FX, elections, macro, and politics should use `serious_economy_politics`.
- Direct backend/admin draft creation now raises shallow `liquidityB` to policy
  before the draft is written.
- Backend Seer materialization now raises shallow Seer draft values to the
  recommended policy value before creating a backend draft.
- Seer source draft defaults now use the same public-depth posture:
  `25,000` for normal public markets and `75,000` for BOI/rate/FX/economy/
  politics markets.
- `seer-create list` shows `b=<effective> (raised from <draft>)` when the
  backend materialization gate will lift a draft.
- Explicit stress/test/toy markets can keep shallow `liquidityB` for mechanics
  proof and gauntlet work.

## New Depth Ladder

Reusable module:
- `systems/back/src/engine/pricing/depth-ladder.ts`
- `systems/back/src/engine/pricing/liquidity-audit.ts`
- `systems/back/src/engine/pricing/price-impact.ts`

CLI:

```bash
npm --prefix systems/back run depth:lmsr-ladder
```

Useful variants:

```bash
npm --prefix systems/back run depth:lmsr-ladder -- --action=buy_yes --probabilities=0.50000000,0.50000000
npm --prefix systems/back run depth:lmsr-ladder -- --action=buy_no --probabilities=0.84000000,0.16000000
npm --prefix systems/back run depth:lmsr-ladder -- --action=buy_no --probabilities=0.40000000,0.30000000,0.20000000,0.10000000 --anchor-outcome-index=1
npm --prefix systems/back run depth:lmsr-ladder -- --mode=presets
npm --prefix systems/back run depth:lmsr-ladder -- --format=json
```

Default ladder:
- liquidity bands: `700`, `2500`, `10000`, `25000`, `75000`, `100000`
- trade amounts: `100`, `500`, `2000`, `10000`, `25000`
- binary probabilities: `50/50`

The ladder reports:
- price before/after
- probability delta in percentage points
- average execution price
- shares bought
- spent/unspent cash

## Price Impact Surface

Quote and trade responses expose advisory `priceImpact`.

Shape:
- `delta`: signed probability delta as an `8dp` decimal
- `absDelta`: absolute probability delta as an `8dp` decimal
- `percentPoints`: absolute movement in percentage points
- `direction`: `up`, `down`, or `flat`
- `level`: `low`, `medium`, `high`, or `extreme`

Current advisory bands:
- `low`: under `1pp`
- `medium`: `1pp .. <5pp`
- `high`: `5pp .. <15pp`
- `extreme`: `15pp+`

This does not reject trades yet. It gives Front and the next gauntlet concrete
impact truth so warning, confirmation, chunking, or rejection policy can be set
from observed behavior.

## Live Liquidity Audit

The audit compares current market pools against the backend policy without mutating
markets.

CLI:

```bash
npm --prefix systems/back run depth:liquidity-audit
```

Useful variants:

```bash
npm --prefix systems/back run depth:liquidity-audit -- --status=open --only-flagged
npm --prefix systems/back run depth:liquidity-audit -- --status=open --only-flagged --with-rebase-plan
npm --prefix systems/back run depth:liquidity-audit -- --status=open --only-flagged --require-clean
npm --prefix systems/back run depth:liquidity-audit -- --market=disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31
npm --prefix systems/back run depth:liquidity-audit -- --format=json
```

Current operator packet:
- `workspace/test/reports/2026-05-30-liquidity-rebase-approval-packet.md`
- contains the live flagged-market audit, price-preserving rebase dry-runs,
  operator-approved execution receipts, and post-execute verify receipts for
  the three old shallow serious markets

Audit flags:
- `below_recommended`: current `liquidity_b` is below the recommended preset
- `below_recommended_min`: current `liquidity_b` is below the preset minimum
- `legacy_shallow_pool`: non-stress market still looks like old fixture depth
- `volume_depth_mismatch`: historical trade volume is large relative to pool depth
- `missing_outcomes`: market has fewer than two outcomes and needs data repair

This is deliberately read-only. Any live-market depth change still needs a
separate price-preserving rebase tool and an audit/lifecycle event.
`--with-rebase-plan` remains read-only; it prints the exact dry-run, execute,
and post-execute verify
commands an operator can review market-by-market. In JSON mode it adds a
structured `rebasePlan` object per repairable row with argv-safe args plus a
human shell command. The verify command reruns the audit for that market with
`--require-clean`.
Audit output includes a top-level summary in JSON and markdown:
`total`, `flagged`, severity counts, `repairable`, and
`requiresOperatorApproval`. Operators and gauntlet gates should read this
summary first instead of scraping table rows.
`--require-clean` is also read-only; it preserves normal output and exits `2`
when any returned row has repair-blocking findings, so gauntlets can fail loudly
on shallow pools. Watch-only rows, such as `volume_depth_mismatch` after a market
already meets policy depth, stay visible but exit `0`.

## Price-Preserving Liquidity Rebase

The rebase tool deepens an existing market while keeping the visible probability
vector unchanged.

CLI:

```bash
npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id>
```

Useful variants:

```bash
npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id> --target-b=75000.00000000
npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id> --format=json
npm --prefix systems/back run depth:liquidity-rebase -- --market=<market-id> --execute --reason="operator-approved depth repair"
```

Safety rules:
- dry-run by default
- `--execute` requires an operator reason
- target `liquidity_b` cannot be lower than the current value
- only `draft` and `open` markets can be rebased
- execution updates `markets.liquidity_b`, `market_pricing_state.liquidity_b`,
  `market_outcome_state.q_shares`, and `last_price`
- execution increments `market_pricing_state.version`
- execution writes `market_liquidity_rebased` to `audit_events`
- execution refuses plans whose `maxPriceDrift` exceeds `0.00000001`
- execution fails if `markets`, `market_pricing_state`, or any expected
  `market_outcome_state` update does not touch exactly one row
- execution receipts include `marketStateVersionBefore` and
  `marketStateVersionAfter`; dry-runs keep them equal, execution shows a one-step
  version bump

Math rules:
- current prices are calculated from current `q_shares` and `liquidity_b`
- target `q_shares` are derived from those prices using target `liquidity_b`
- the current minimum `q_shares` gauge is preserved, because common `q` shifts do
  not change LMSR prices or future trade costs
- the receipt reports `maxPriceDrift` and `lmsrCostDelta`; cost delta is a
  gauge-preserved diagnostic, not a user balance mutation

Current dry-run receipt for the USD/ILS market:
- `b: 700.00000000 -> 75000.00000000`
- `maxPriceDrift: 0.00000000`
- `lmsrCostDelta: 462049.145878778834000000`
- visible price vector stays `0.00199184 / 0.99800816`

Executed live rebase receipt:
- Omri approved execution on 2026-05-30.
- USD/ILS: `audit_dc015819-f709-41a4-b708-c20c2c2a5f78`, version `2216 -> 2217`, `b: 700 -> 75000`, `maxPriceDrift=0.00000000`
- Knesset: `audit_ed3c93d3-3581-4c8e-a371-0fee0be4fd5a`, version `1820 -> 1821`, `b: 700 -> 75000`, `maxPriceDrift=0.00000000`
- BOI August: `audit_93f2dc1e-b546-4af0-bafd-dff389116503`, version `1867 -> 1868`, `b: 1000 -> 75000`, `maxPriceDrift=0.00000000`
- Post-execute aggregate gate `depth:liquidity-audit -- --status=open --only-flagged --require-clean --limit=10` exits `0`.
- Remaining `volume_depth_mismatch` rows are watch-only evidence for the next
  gauntlet/policy pass.

## First Read From The Tool

The dollar-gate trust gap is expected under low `b`:
- at `b = 700`, medium trades are allowed to move probabilities sharply
- at `b = 25,000+`, the same trade becomes much less violent

Concrete receipt:
- binary `buy_no`, starting `84/16`, amount `2,000 V₪`
- `b = 700`: `16.00% -> 95.18%` (`+79.1757pp`)
- `b = 25,000`: `16.00% -> 22.46%` (`+6.4582pp`)
- `b = 100,000`: `16.00% -> 17.66%` (`+1.6633pp`)

Multi-outcome complement receipt:
- 4-outcome `buy_no`, starting `40/30/20/10`, anchor outcome index `1`, amount `2,000 V₪`
- `b = 25,000`: complement price `70.00% -> 72.31%` (`+2.3065pp`)
- `b = 75,000`: complement price `70.00% -> 70.79%` (`+0.7894pp`)

This does not prove final policy. It gives the next gauntlet a controlled input matrix.

## V1 Locked Work

- Shared quote/trade sell-ownership validation lives in `engine/sell-ownership.ts`.
- Shared market state and execution outcome resolution lives in
  `engine/market-state-guards.ts`.
- Shared direct-YES, binary-NO, and multi-outcome complement quote selection
  lives in `engine/pricing/execution-quote.ts`.
- Quote/trade responses expose advisory `priceImpact` for next-gauntlet policy
  decisions.
- Depth ladder, live audit, and price-preserving rebase CLIs are available and
  documented.
- Seer/admin backend creation paths now raise shallow public-market depth to the
  policy recommendation before backend draft creation.
- Seer source defaults now start from the same public-depth posture.
- Old live serious-market shallow pools were rebased to policy depth with
  operator approval and audit-event receipts.

## Remaining Policy Work

- Run the next depth gauntlet with `priceImpact` enabled and decide whether
  warnings, confirmations, chunking, or hard rejection thresholds belong in v2.
- Treat `volume_depth_mismatch` as a product-policy watch signal after a market
  already meets recommended depth; decide whether flagship events need a higher
  preset than `75,000`.
- Keep Seer source defaults and backend creation guards aligned when adding new
  market classes.
