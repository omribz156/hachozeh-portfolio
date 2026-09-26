# Discovery Feed Contract

Updated: 2026-04-30
Owner: frontend / backend seam

Purpose:
- define the systems/back/frontend seam for discovery feeds
- separate engine truth from discovery read-model logic and presentation hints
- keep feed migration from guessing itself into schema salad

Status:
- active contract sketch
- still allowed to evolve
- owns the boundary rules for discovery feed data

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/surfaces/discovery/discovery-route-spec.md`

## This Doc Owns

- backend truth vs derived read-model vs presentation-hint boundaries
- the base discovery item shape
- route-specific feed-contract pressure
- SQL/frontend guardrails for discovery data

## This Doc Does Not Own

- card role definitions
- card hierarchy and layout rules
- page-level route composition

Those live in:
- `feed-card-taxonomy.md`
- `discovery-card-role-spec.md`
- `feed-card-composition.md`
- `discovery-route-spec.md`

## Core Contract Stance

Discovery feed data should have 3 layers:

1. backend truth
   - canonical market facts
2. derived read-model fields
   - feed-optimized browse facts
3. optional presentation hints
   - light composition help
   - not engine truth

Short version:
- backend owns reality
- discovery read model owns browse intelligence
- frontend owns composition

## Backend Truth

These belong to backend truth:
- `marketKey`
- `marketStatus`
- `title`
- `category`
- `closeAt`
- `updatedAt`
- `volume` once honest
- `outcomes`
- current prices / probabilities
- real movement or activity facts once the backend truly owns them

These should be trustworthy outside discovery too.

## Derived Discovery Read Model

These belong in discovery response assembly:
- top outcomes preview, capped at 4 outcomes for hero/card consumers
- display probability strings
- leader preview
- strongest mover summary
- `isNew`
- `isBreaking`
- `isLive`
- route ranking/order
- route grouping
- compact sparkline data
- compact recent-trade chart preview for hero/card graph consumers
- activity labels
- featured candidate selection

These are browse-useful, but not engine schema truth.

## Presentation Hints

These should stay out of core trading tables:
- `cardRole`
- `featured`
- `heroPriority`
- `layoutSpan`
- editorial badge copy
- image crop preference
- route-specific promotion weight

If these ever become durable data, they belong in:
- discovery read-model assembly
- publish-time presentation metadata
- later management/config layers

Not:
- engine pricing/trading tables

## Boundary Rules

### SQL Rule

Do not add fields like these to core engine tables just to satisfy feed design:
- `card_role`
- `hero_priority`
- `featured_weight`
- `visual_density`

That is presentation pressure, not market truth.

### Frontend Rule

The frontend should not have to:
- infer status from random raw fields
- invent `breaking` / `new` / `live` flags from scratch
- fully re-rank cards ad hoc
- rebuild a discovery intelligence layer in page scripts

The frontend should mostly:
- render
- route
- lightly compose

### Honesty Rule

Do not claim movement or liveness the backend cannot support.

Safe:
- recent updates
- real movement summaries
- honest freshness windows

Not safe:
- fake pulse badges
- invented live counts
- route signals derived from vibes

## Recommended Shape

One discovery item should roughly look like:

```json
{
  "marketKey": "next-prime-minister",
  "marketStatus": "open",
  "title": "Who will be prime minister next?",
  "category": {
    "key": "politics",
    "label": "Politics"
  },
  "updatedAt": "2026-03-31T10:00:00.000Z",
  "closeAt": "2026-06-22T21:00:00.000Z",
  "volume": {
    "value": "1200000.000000",
    "label": "1.2M VSH"
  },
  "preview": {
    "marketType": "multi_outcome",
    "topOutcomes": [
      {
        "outcomeKey": "candidate-a",
        "label": "Candidate A",
        "probability": "0.41",
        "displayProbability": "41%"
      }
    ],
    "chart": {
      "kind": "trade_replay",
      "range": "preview",
      "source": "recent_trades",
      "points": [
        {
          "at": "2026-03-31T10:00:00.000Z",
          "t": 1774951200,
          "label": "current",
          "values": {
            "candidate-a": 0.41
          }
        }
      ]
    },
    "movement": {
      "direction": "up",
      "displayLabel": "+4%"
    }
  },
  "signals": {
    "isNew": false,
    "isBreaking": true,
    "isLive": false
  },
  "presentationHints": {
    "cardRole": "signal-led"
  }
}
```

The important thing is the layer split, not this exact JSON furniture.

## Minimal First Useful Version

The first backend discovery contract does not need everything.

Minimum useful slice:
- `marketKey`
- `marketStatus`
- `title`
- `category`
- `volume` if honest
- `preview.marketType`
- `preview.topOutcomes`
- `preview.chart` from recent backend trade replay when available
- optional `signals.isNew`
- optional `signals.isBreaking`
- optional top-level `featured`

That is enough to move discovery pages off seeded card guesswork.

## Current Browse Rule

Discovery feed should return:
- open
- published
- browse-worthy markets

It should exclude:
- bootstrap seed-only cards
- closed/resolved markets
- history/trust-only items

Those belong elsewhere:
- history
- portfolio
- trust surfaces

## Route Pressure

### Trending

Needs:
- broad mixed inventory
- ranking/order
- optional featured candidate

### Breaking

Needs:
- movement-aware ordering
- stronger mover summary
- honest short-window change fields

### New

Needs:
- freshness ordering
- clear `isNew` logic

### Live

Needs:
- explicit live grouping
- stronger short-horizon activity fields
- probably a richer specialized response later

### Category

Needs:
- category filter
- shared base item shape
- server-owned category-specific ranking logic

## Recommendation

Do this in order:
1. define one generic discovery item contract
2. make route feeds consume the same base item shape
3. add route-specific ranking/grouping server-side
4. add presentation hints only when the need is real

## Success Test

The contract succeeds when:
- backend owns real market truth
- discovery read-model owns browse intelligence
- frontend no longer depends on seeded card logic
- routes can differ in feel without demanding different market schemas
