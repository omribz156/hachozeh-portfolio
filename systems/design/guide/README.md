> **DESIGN-LAB DOCTRINE.** This guide is the **law** — tokens, surfaces, base laws, and doctrine govern all
> product work, including the live app in **`systems/web/`** (Astro SSR), where surfaces ship. Design is
> settled in `systems/design/` (`stage/`, `mockups/`) against these rules, then rebuilt in `systems/web/`.
> See `workspace/tasks/active/astro-migration.md` for status and `systems/design/README.md` for the flow.

# Frontend Guide

Updated: 2026-05-20
Status: current
Owner: frontend lane

Purpose:
- frontend operating manual
- route frontend sessions through constitution, base laws, surfaces, and components
- keep history out of startup authority

It is not the platform design source of truth. The design source of truth is
`workspace/docs/design.md`.

## Mandatory Read Order

For any frontend product/design work:

1. `workspace/docs/design.md`
2. `systems/design/README.md`
3. this file
4. relevant `base/` docs
5. relevant `surfaces/` docs
6. relevant `components/` docs
7. inspect the live or stage route in browser

Do not begin from history.

## Authority Levels

### `base/`

Frontend laws derived from the platform constitution.

Use for:
- typography
- spacing and density
- Hebrew/RTL expectations
- AI-assisted design workflow
- cross-surface visual rules

Current docs:
- `base/README.md`
- `base/css-base-contract.md`
- `base/typography-and-print.md`
- `base/ai-assisted-design-method.md`

### `surfaces/`

Page and route contracts.

Use for:
- what a surface is supposed to feel like
- user job and hierarchy
- route-specific design rules
- current status: locked, active, experimental, retired
- canonical/stage routes and browser-check anchors

Current rooms:
- `surfaces/market-detail/`
- `surfaces/discovery/`
- `surfaces/shell/`

Rule:
- if a doc describes a page or product surface, it belongs here
- each complete surface gets a clean folder

### `components/`

Implementation and wiring contracts.

Use for:
- reusable component behavior
- route ownership
- data consumed by a component
- event/state responsibilities
- current runtime files

Rule:
- if a doc explains how frontend code is built or wired, it belongs here
- component docs may point to surface docs, but they do not own product feel

### `skills/`

Portable agent workflows.

Use for:
- copying the frontend-design workflow to another Codex machine
- preserving process
- onboarding agents into the same design loop

Current skill:
- `skills/frontend-design/SKILL.md`

### `history/`

Retired docs and snapshots.

Use for:
- old stage proofs
- replaced design notes
- historical context only

Rule:
- history has no authority
- do not use history as current direction unless explicitly revived

## Current Design Locks

- `workspace/docs/design.md` is the constitution.
- `Arimo` is the active platform font direction.
- Native CSS plus `--hz-*` tokens is the active frontend style base.
- Tailwind is layout glue and transition support, not the source of visual taste.
- Market detail is the strongest proof surface.
- `systems/design/stage/` is proof work, not canonical product.
- `systems/design/pages/` is a rendered prod-snapshot reference pool (refresh via `workspace/scripts/refresh-design-sandbox.sh`).

## Placement Rules

- Product-wide design law: `workspace/docs/design.md`
- Frontend base law: `base/`
- Route/page contract: `surfaces/`
- Component/runtime contract: `components/`
- Platform design context: `../general-context/` (incl. `hachozeh.md` design-system spec)
- Portable process: `skills/`
- Retired context: `history/`

If a doc could live in two places, choose the place that describes its authority,
not its topic. That is how we keep the salad bowl from returning.
