# Backend Contract Brief

Updated: 2026-05-27
Status: current
Owner: backend / front seam

Purpose:
- define the current app-facing backend contracts that matter for live systems/design/backend seams
- reduce guesswork across backend, market-detail, and portfolio lanes
- keep active contract truth in one place

Type:
- active contract brief

Read with:
- `systems/back/docs/README.md`
- `systems/back/docs/current-status.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/engine-decisions.md`
- `workspace/docs/roadmap.md`

This doc is not:
- the backend status board
- the architecture explainer
- a historical gap memo

This doc owns:
- app-facing contract truth for live systems/design/backend seams

This doc does not own:
- admin/operator contracts
- auth/session policy detail
- backend status

## Scope

This brief covers the current live backend contract surfaces used by product-facing lanes:
- passive market-detail read
- market catalog and raw market data
- quote
- trade
- portfolio snapshot
- portfolio orders
- portfolio history
- portfolio performance
- portfolio claims
- auth/session boundary routes used by frontend state

Not covered here:
- admin commands
- full trust/history product surfaces beyond current lifecycle/result fields
- deeper auth/session policy beyond the first cookie boundary

## Contract Stance

Use these rules unless a real blocker appears:

- app-facing paths live under `/api/`
- app-facing market identity uses `marketKey`
- backend may return canonical internal ids too, but the frontend should not need DB ids to navigate
- use direct JSON payloads, not a generic `{ ok, data }` wrapper
- timestamps use ISO-8601 UTC strings
- money / shares / price truth uses normalized decimal strings on new live contracts
- current passive market-detail bridge may keep UI-friendly numeric price values for now
- write routes never accept `userId` from the client

## Actor Rule During Auth Transition

Current live backend still needs a real actor for quote/trade/portfolio.

Current rule:
- protected routes resolve actor from session first
- if no session cookie exists, backend may still use explicit demo actor mode
- client does not send `userId`
- this fallback must stay explicit in workspace/docs/config, not hidden fallback magic

Important:
- invalid/expired session cookies do not silently drop into demo mode
- browser session flow depends on credentialed cookie requests
- frontend backend-mode fetches should send `credentials: "include"` for session-bound routes when systems/design/backend are not same-origin

Later:
- session/auth replaces demo actor mode
- contract shape should survive that swap with minimal churn

## Error Shape

Use one simple error payload:

```json
{
  "error": {
    "code": "market_not_found",
    "message": "Requested market was not found."
  }
}
```

Recommended first codes:
- `market_not_found`
- `outcome_not_found`
- `invalid_request`
- `market_not_open`
- `insufficient_cash`
- `insufficient_shares`
- `idempotency_conflict`
- `idempotency_in_progress`
- `unauthorized`

## 1. Passive Market Detail Read

Endpoint:
- `GET /api/market-detail/markets/:marketKey`

Current contract stance:
- keep the route mostly stable
- do not redesign it just to make it look more generic before quote/trade is real

Current accepted shape:

```json
{
  "context": {
    "sectionLabel": "שווקים",
    "categoryLabel": "פוליטיקה",
    "categoryHref": "trending.html?category=politics",
    "marketLabel": "מי יהיה ראש הממשלה הבא?",
    "brandAlt": "Knesset",
    "brandImageUrl": "https://..."
  },
  "snapshot": {
    "updatedLabel": "24 מרץ 2026 · 09:30",
    "marketStateVersion": 0,
    "volumeLabel": "0 V₪",
    "closeLabel": "22 ביוני",
    "outcomes": [
      {
        "id": "option-a",
        "key": "option-a",
        "label": "מועמד א׳",
        "shortLabel": "מועמד א׳"
      }
    ],
    "current": {
      "option-a": 0.25,
      "option-b": 0.25,
      "option-c": 0.25,
      "option-d": 0.25
    },
    "outcomeVolumes": {
      "option-a": "0 V₪",
      "option-b": "0 V₪"
    },
    "contract": {
      "objectType": "market_contract_v1",
      "version": "seer-contract-v1",
      "measurement": "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
      "resolutionSource": {
        "label": "NBA official final game result",
        "url": "https://www.nba.com/game/tor-vs-cle-0042500137"
      },
      "resolutionRule": "Official final result decides the winner.",
      "timeline": {
        "closeShape": "scheduled-close",
        "closeAt": "2026-05-03T23:30:00.000Z",
        "timezone": "UTC"
      },
      "outcomeMap": [],
      "delayPolicy": "If postponed before tipoff, keep pending until operator-approved source update."
    },
    "rulesLead": "…",
    "relatedMarkets": [],
    "timeline": []
  }
}
```

Current rules:
- honest `404` for unknown market keys
- backend truth owns prices and market state version
- backend should expose lifecycle status explicitly as the seam widens
- `snapshot.contract` is the full stored Seer `market_contract_v1` when available
- `snapshot.contract` is omitted when the DB has no real Seer contract; Front should not parse `resolutionRules` into fake contract sections
- `snapshot.timeframes` is not part of the DB-backed market-detail contract; chart/history consumers use `GET /api/markets/:marketKey/history?range=<range>`
- community and holdings may stay local for now

## 2. Market Catalog And Raw Market Data

These routes are reusable market-data seams. They should be preferred by charts, tools, and QA where a raw contract is better than the Hebrew page-shaped market-detail read.

Endpoints:
- `GET /api/markets`
- `GET /api/markets/:marketKey`
- `GET /api/markets/:marketKey/prices`
- `GET /api/markets/:marketKey/trades`
- `GET /api/markets/:marketKey/positions`
- `GET /api/markets/:marketKey/history`
- `GET /api/markets/:marketKey/price-history`
- `GET /api/markets/:marketKey/stream`

Catalog filters:
- `status`: `open` by default; accepts `draft`, `open`, `closed`, `resolved`, `all`
- `category`
- `q`
- `closeAfter`
- `closeBefore`
- `sort`: `updated_desc`, `close_asc`, `volume_desc`
- `limit`
- `cursor`

Trades filters:
- `side`: `buy` or `sell`
- `contractSide`: `yes` or `no`
- `outcome`: frontend outcome key or backend outcome id
- `limit`
- `cursor`

Trades rules:
- public route does not expose `user_id`
- rows expose public actor labels from active identity local-parts

History rules:
- `GET /api/markets/:marketKey/history` is the reusable graph-first history border API.
- It returns backend-sampled, carry-forward probability points for all outcomes.
- Front may choose which lines to display, but should not invent sampling or probability movement.
- standard range reads can use read-through persisted `market_history_candles`; custom bounded reads may still replay from trades.
- `sampleQuality` exposes whether the selected range is active, sparse, or flat with no trades.
- `GET /api/markets/:marketKey/price-history` remains compatibility for existing consumers and returns the older trade-replay point shape from the same backend service.
- rows fall back to `סוחר N` labels when no active identity exists

Positions rules:
- public route does not expose `user_id`
- rows expose public holder labels from active identity local-parts
- rows fall back to `סוחר N` labels when no active identity exists
- rows come from `contract_positions`
- settled rows are excluded; resolution marks `contract_positions.settled_at`, so resolved market exposure does not stay visible as open holders/positions
- `YES` and `NO` are separate open positions for the requested outcome
- `positions` remains the engine's outcome-native economic exposure table
- response groups both `holdersByOutcome` and `positionsByOutcome` by outcome key, then by `yes` / `no`

Position response sketch:

```json
{
  "marketKey": "stress-contract-position-root-2",
  "openPositionsCount": 15,
  "holdersByOutcome": {
    "stress-contract-position-root-2-alpha": {
      "yes": [
        {
          "userLabel": "omrib",
          "contractSide": "yes",
          "shares": "12.345678"
        }
      ],
      "no": [
        {
          "userLabel": "no-holder",
          "contractSide": "no",
          "shares": "5.000000"
        }
      ]
    }
  },
  "positionsByOutcome": {
    "stress-contract-position-root-2-alpha": {
      "yes": [],
      "no": []
    }
  }
}
```

Price history rules:
- current backend replays bounded recent trades into probability points
- `range=all` is the active market-detail consumer path
- shorter buckets stay page-shaped until candle/range aggregation exists

Stream rules:
- SSE emits `market.snapshot` first
- emits `heartbeat`
- emits `market.trade` after local trade execution
- emits a fresh `market.snapshot` after the post-trade price read succeeds
- `once=1` is available for smoke probes

## 3. Quote

Endpoint:
- `POST /api/markets/:marketKey/quote`

Purpose:
- advisory trade-ticket quote only
- not passive browsing compute

Buy request:

```json
{
  "side": "buy",
  "contractSide": "yes",
  "outcomeKey": "option-a",
  "cashAmount": "100.000000"
}
```

Sell request:

```json
{
  "side": "sell",
  "contractSide": "yes",
  "outcomeKey": "option-a",
  "shareAmount": "12.500000"
}
```

Rules:
- `buy` requires `cashAmount`
- `sell` requires `shareAmount`
- exactly one trade mode per request
- `contractSide` is optional and defaults to `yes`
- binary `contractSide = no` normalizes to the opposite outcome
- multi-outcome `contractSide = no` executes as a complement bundle across every non-anchor outcome
- callers should treat `outcomeKey` as the requested contract anchor
- multi-outcome complement callers should read execution truth from `executionLegs[]`

Response shape:

```json
{
  "quoteId": "quote_123",
  "marketKey": "next-prime-minister",
  "marketId": "market_seed_next_prime_minister",
  "marketStateVersion": 12,
  "quotedAt": "2026-03-26T10:15:00.000Z",
  "expiresAt": "2026-03-26T10:15:05.000Z",
  "side": "buy",
  "contractSide": "yes",
  "outcomeKey": "option-a",
  "outcomeId": "market_seed_next_prime_minister_outcome_option_a",
  "executionOutcomeKey": "option-a",
  "executionOutcomeId": "market_seed_next_prime_minister_outcome_option_a",
  "executionLegs": [
    {
      "outcomeKey": "option-a",
      "outcomeId": "market_seed_next_prime_minister_outcome_option_a",
      "shareAmount": "352.441221"
    }
  ],
  "cashAmount": "100.000000",
  "shareAmount": "352.441221",
  "averagePrice": "0.28374219",
  "priceBefore": "0.25000000",
  "priceAfter": "0.28744102",
  "priceImpact": {
    "delta": "0.03744102",
    "absDelta": "0.03744102",
    "percentPoints": "3.7441",
    "level": "medium",
    "direction": "up"
  },
  "unspentCash": "0.000000"
}
```

Contract notes:
- sell responses may include `estimatedProceeds` and `estimatedRealizedPnlDelta`
- direct and binary paths return one execution leg
- multi-outcome complement quotes return one leg per non-anchor outcome
- bundle quotes use:
  - `executionOutcomeKey = null`
  - `executionOutcomeId = null`
  - `executionLegs[]` as the authority

## 4. Trade

Endpoint:
- `POST /api/markets/:marketKey/trades`

Request:

```json
{
  "side": "buy",
  "contractSide": "yes",
  "outcomeKey": "option-a",
  "cashAmount": "100.000000",
  "idempotencyKey": "c5d8c4f0-0d7d-4c92-a89e-1f4a2b0a0d99",
  "quoteId": "quote_123",
  "quotedAt": "2026-03-26T10:15:00.000Z",
  "quoteExpiresAt": "2026-03-26T10:15:05.000Z",
  "expectedMarketStateVersion": 12
}
```

Rules:
- same mode split as quote
- `idempotencyKey` required
- quote fields may be nullable
- server always recomputes authoritative execution

Current response shape:

```json
{
  "tradeId": "trade_123",
  "marketKey": "next-prime-minister",
  "marketId": "market_seed_next_prime_minister",
  "marketStateVersionBefore": 12,
  "marketStateVersionAfter": 13,
  "executedAt": "2026-03-26T10:15:01.000Z",
  "side": "buy",
  "contractSide": "yes",
  "outcomeKey": "option-a",
  "outcomeId": "market_seed_next_prime_minister_outcome_option_a",
  "executionOutcomeKey": "option-a",
  "executionOutcomeId": "market_seed_next_prime_minister_outcome_option_a",
  "executionLegs": [
    {
      "outcomeKey": "option-a",
      "outcomeId": "market_seed_next_prime_minister_outcome_option_a",
      "shareAmount": "352.441221"
    }
  ],
  "quoteId": "quote_123",
  "priceBefore": "0.25000000",
  "priceAfter": "0.28744102",
  "priceImpact": {
    "delta": "0.03744102",
    "absDelta": "0.03744102",
    "percentPoints": "3.7441",
    "level": "medium",
    "direction": "up"
  },
  "averagePrice": "0.28374219",
  "availableCashAfter": "9900.000000",
  "positionSharesAfter": "352.441221",
  "positionCostBasisAfter": "100.000000",
  "cashSpent": "100.000000",
  "sharesBought": "352.441221"
}
```

Current rules:
- same key + same payload replays stored prior result
- same key + different payload returns `409 idempotency_conflict`
- additive persistence stores `trade_execution_legs`
- multi-outcome complement trades persist one requested trade row plus one execution-leg row per non-anchor outcome

## 5. Portfolio Snapshot

Endpoint:
- `GET /api/portfolio/snapshot`

Actor binding:
- current backend resolves session first
- explicit demo actor mode remains fallback when no session cookie exists

Current response shape:

```json
{
  "actorMode": "demo",
  "asOf": "2026-03-26T10:15:01.000Z",
  "summary": {
    "availableCash": "9900.000000",
    "portfolioValue": "101.298400",
    "totalAccountValue": "10001.298400",
    "realizedPnl": "0.000000",
    "unrealizedPnl": "1.298400",
    "openPositionsCount": 1
  },
  "positions": [
    {
      "marketKey": "next-prime-minister",
      "marketTitle": "מי יהיה ראש הממשלה הבא?",
      "marketStatus": "open",
      "outcomeKey": "option-a",
      "outcomeLabel": "מועמד א'",
      "shares": "352.441221",
      "costBasis": "100.000000",
      "averageEntryPrice": "0.28374219",
      "currentPrice": "0.28744102",
      "positionValue": "101.298400",
      "realizedPnl": "0.000000",
      "unrealizedPnl": "1.298400",
      "totalPnl": "1.298400",
      "markAsOf": "2026-03-26T10:15:01.000Z"
    }
  ]
}
```

## 5b. Portfolio Orders / History / Performance

Endpoints:
- `GET /api/portfolio/orders`
- `GET /api/portfolio/history`
- `GET /api/portfolio/performance`
- `GET /api/portfolio/claims`
- `POST /api/portfolio/claims/:claimId/claim`

Current stance:
- orders are immediate execution only for now
- open orders response is intentionally empty until a real pending-order model exists
- history merges `trades` and `realization_events`
- performance combines snapshot summary with recent activity and history counts
- claims expose pending user-claimable resolution wins and claim through backend cash/claim mutation

Current code-backed shape:
- `GET /api/portfolio/orders`
  - `actorMode`
  - `asOf`
  - `orderModel: "immediate_execution"`
  - `openOrders: []`
  - `summary.openOrderCount`
- `GET /api/portfolio/history`
  - `actorMode`
  - `asOf`
  - `summary`
  - `items`
  - trade items preserve requested contract-side truth plus additive `executionLegs[]`
- `GET /api/portfolio/performance`
  - `actorMode`
  - `asOf`
  - `activeTimeframe`
  - `timeframes`
  - `summary`
  - `dayMovement` (legacy top-fold day seam — kept for back-compat; equivalent to `views.day.movement` with `dayChange*` prefix)
  - `views[day|week|month|year|ytd|all]`
    - `kind: "snapshot"`, `label`, `value`, `timeframeLabel`, `directionIcon`, `metrics[]`, `note`, `recentActivity[]`
    - `movement: { basis, totalNow, changeAbs, changePct, changeSign }` — typed, uniform per timeframe (2026-05-28)
    - `series.points[]` — multi-point PnL series. **Primary path (2026-05-30):** mark-to-market composition `(mark_value(t) − mark_value(t_start)) + Σ realized_in_window_through(t)`, bucketed via the reusable market-history cadences (1D→5min, 1W→1h, 1M→4h, ALL/year/YTD→adaptive). V1 uses CURRENT open-position shares as multiplier across the window. **Fallback path:** realized-events-only series (starter `0`, one point per realization, closing at `asOf`) when account has no open positions or per-market candles haven't been generated yet. Closing point always anchored to `view.value`.
  - `recentActivity`

## Auth Boundary Note

Auth/session foundation already exists in code:
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/start`
- `POST /api/auth/verify`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/me`
- `GET /api/me/sessions`
- `POST /api/me/sessions/revoke-others`

This brief only notes the boundary:
- Google OAuth launch path
- email OTP fallback/operator path
- secure server cookie session
- backend session is the truth
- no client-trusted actor identity

Deeper auth/session policy lives elsewhere.

## How To Use This Doc

Use this doc when you need:
- current app-facing backend contract shape
- request/response expectations for live systems/design/backend seams
- contract-level tradeoffs during frontend or backend API work

Do not use this doc as:
- the backend status board
- the backend architecture explainer
- the historical gap memo pile
