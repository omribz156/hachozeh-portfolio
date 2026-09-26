# Backend Docs

Updated: 2026-06-17
Status: current
Owner: backend lane

Purpose:
- front door for `systems/back/docs`
- keep backend reading path fast
- separate status, shape, contract, engine, control-plane, Horizon, and history
- keep new agents from treating old engine doctrine as route/API truth

## Read Order

1. `systems/back/docs/current-status.md`
   - live backend/runtime truth now
2. `systems/back/docs/backend-overview.md`
   - backend mental model and layer ownership
3. `systems/back/docs/v1-contract-brief.md`
   - app-facing contract truth
4. `workspace/tasks/reference/current-backend-api-map.md`
   - current route map, market API parameters, and next API gaps
5. `systems/back/docs/market-history-v1.md`
   - active graph-first reusable market history border API
6. `systems/back/docs/platform-watchdog-v1.md`
   - local backend/front health watcher, platform doctor, diagnostics thresholds, and tmux-scoped restart receipts
7. `systems/back/docs/market-integrity-and-abuse-controls-v1.md`
   - endpoint abuse policy, risk signal recording, summaries, review actions, and operator response boundary
8. `systems/back/docs/engine-cleanup-liquidity-depth-v1.md`
   - active engine cleanup and LMSR depth calibration work
9. `systems/back/docs/market-engine.md`
   - engine model, data model, and execution flows
10. `systems/back/docs/engine-decisions.md`
   - durable backend non-negotiables
11. `systems/back/docs/public-handles.md`
   - public profile handle rules, reserved handles, and API seams
12. `systems/back/docs/control-plane/README.md`
   - auth/session/user-account cluster
13. `systems/back/docs/horizon/README.md`
   - deterministic lifecycle-close cluster
14. `systems/back/docs/history/README.md`
   - backend archaeology only when needed

## What Owns What

- `current-status.md`
  - what is live
  - what is verified
  - what is still bridgey
- `backend-overview.md`
  - backend layer map
  - runtime module map
  - money/trade/resolution orientation
  - current code-owned module families
- `v1-contract-brief.md`
  - systems/design-facing quote/trade/portfolio contract truth
- `workspace/tasks/reference/current-backend-api-map.md`
  - exact route family map
  - market catalog/data API parameters
  - next API gaps
- `market-history-v1.md`
  - active reusable market history border API
  - graph-first sampling and compatibility stance for `price-history`
- `platform-watchdog-v1.md`
  - local backend/front health watcher
  - platform doctor verdicts
  - diagnostics thresholds
  - tmux-scoped restart safety policy
  - JSONL receipt shape
- `market-integrity-and-abuse-controls-v1.md`
  - endpoint abuse posture
  - risk signal storage
  - admin risk inbox, summary, review actions, and user-linked context
  - response boundary before richer analytics
- `engine-cleanup-liquidity-depth-v1.md`
  - active engine cleanup map
  - LMSR `liquidity_b` depth ladder
  - pool-depth calibration direction
- `market-engine.md`
  - engine model
  - persistence model
  - execution flows
- `engine-decisions.md`
  - locked rules
  - non-negotiable boundaries
  - chosen policies
- `public-handles.md`
  - public profile handle rules
  - reserved handle list
  - handle/search privacy policy
- `future-topics.md`
  - later maybe pile
  - not build-now truth
- `control-plane/`
  - auth/session/user-account/identity doctrine
- `horizon/`
  - deterministic lifecycle-close doctrine
- `history/`
  - crossed memos and TTL docs

## Use By Intent

- if you need live backend truth:
  - `current-status.md`
- if you need the backend map:
  - `backend-overview.md`
- if you need frontend/backend seam truth:
  - `v1-contract-brief.md`
- if you need current backend API routes:
  - `workspace/tasks/reference/current-backend-api-map.md`
- if you need graph/history API truth:
  - `market-history-v1.md`
- if you need local platform health/restart truth:
  - `platform-watchdog-v1.md`
- if you need market integrity / abuse-control truth:
  - `market-integrity-and-abuse-controls-v1.md`
- if you need engine/trade/ledger truth:
  - `market-engine.md`
  - `engine-decisions.md`
- if you need auth or user lifecycle:
  - `control-plane/README.md`
- if you need Google OAuth / OTP / session behavior:
  - `control-plane/auth-flow-session-policy-v1.md`
- if you need close/lifecycle authority:
  - `horizon/README.md`
- if you need archaeology:
  - `history/README.md`
