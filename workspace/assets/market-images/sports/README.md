# Sports image assets

Club **jersey crests** — parametric SVG: a shirt silhouette in the club's `colorPrimary` on a tile of its `colorSecondary`. Football uses a sleeved shirt; basketball uses a sleeveless singlet. Same two-colour system; only the silhouette path differs (`manifest.json` → `paths`). Feeds the `crestPath` registry seam.

> **National-team identity is not here.** Country flags live at `../flags/` (shared — they serve politics, world, fx, geography too, not just sport).

## Structure

```
sports/
  football/il-premier-league/   15 clubs (14 current Ligat ha'Al + Bnei Yehuda historic)
  basketball/euroleague/        20 clubs
  basketball/nba/               30 teams
  basketball/il-winner-league/  14 clubs
  manifest.json                 slug -> names, colours, sport, league, file
```

## Notes
- Colours are **web-sourced, best-effort**; several at medium confidence (see manifest / session). Calibrate in the visual loop.
- Within-sport colour clusters are expected (Israeli football has 4+ red Hapoel clubs); the **team name** carries disambiguation in-card.
- Bridge to backend: these slugs/colours map onto registry team entity assets (`colorPrimary`, `colorSecondary`, `crestPath`).
- Discovery resolves team assets with `findTeamBrandByLabel(label, sport?, league?)`.
  When `sport` is known, lookup is sport-gated and must not fall back across
  sports. This keeps shared club names (for example Maccabi TA / Hapoel
  Jerusalem) from rendering football crests on Winner League basketball cards.
- When adding a new league folder, wire its source family to semantic discovery
  metadata (`sports.sport.key`, `sports.league.key`) before expecting the card
  to render league-specific assets.
