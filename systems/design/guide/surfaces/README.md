# Frontend Surfaces

Updated: 2026-05-20
Status: current
Owner: frontend lane

Purpose:
- define frontend page and route contracts
- make canonical/staged surfaces easy to identify
- keep product feel and route ownership close to the page docs

They answer:
- what this surface is for
- what it should feel like
- what hierarchy it must preserve
- which routes are canonical or staged
- which component docs support it
- what is locked, active, experimental, or retired

## Current Surface Rooms

- `market-detail/`
  - proof surface
  - strongest current Hachozeh product tone
  - includes the consumer playbook for Seer-shaped market presentation copy
- `discovery/`
  - trending/front page, discovery feed, live-page design, breaking-page surface (shipped 2026-05-25)
- `portfolio/`
  - the user's own book — legibility-first, sober, analyst's-study tone
- `shell/`
  - global navigation, drawer, support/trust surfaces
- `help-center/`
  - the reference shelf — hub/topic/article, content-collection backed (`/help`), shipped 2026-06-09
- `edge-pages.md` (loose doc)
  - error + maintenance pages served by the edge (Caddy) from disk, so they render even when the app is down

## Rule

Each complete surface gets a folder.

Loose one-off surface docs are allowed only while the surface is still small or
forming. Once it becomes important, give it a room.
