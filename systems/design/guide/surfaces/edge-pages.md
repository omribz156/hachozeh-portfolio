# Edge Pages — Error & Maintenance

Updated: 2026-06-14
Status: current (dev gateway wired; prod mirror is a private-ops step)
Owner: frontend lane + ops

Purpose:
- the two pages a visitor sees when the **app itself can't answer**: a generic
  error page and a planned-maintenance page.
- they are **edge pages** — served by the Caddy reverse proxy straight from disk,
  so they render even when the Astro upstream is fully down.

## The two pages

| Page | File | Title | When it shows |
|---|---|---|---|
| Error | `systems/web/public/error.html` | תקלה · החוזה | any error: unknown route (404), forbidden (403), server error (5xx), or upstream down |
| Maintenance | `systems/web/public/maintenance.html` | תחזוקה · החוזה | planned downtime, flipped on by an operator |

Both are **fully self-contained** by design: inline `<style>` with a minimal
`--hz-*` token subset + Google-hosted fonts, no local CSS/JS, no app dependency.
That is the whole point — they must not need the platform to render. Both are
`<meta robots noindex>`. RTL, dark-native, amber, in the platform tone.

**Design intent:** deliberately shell-less (no SiteHeader/SiteFooter). The error
page is a calm dead-end — an amber tick + hairline mark, one line of cause, and
two actions (`חזרה לדף הבית` + a `נסה שוב` button). Maintenance is a centered
crosshair-orbit schematic (CSS-animated, reduced-motion safe) + "אנחנו בתחזוקה".
Responsive with no media queries — the `clamp()` root font-size + vw/vh + flex
carry it down to phone width (verified 390px, no overflow).

## How they're served (the edge model)

They live in `systems/web/public/` → copied into `systems/web/dist/client/` on
every web build. Caddy serves them **from that directory directly** (`file_server`),
which is why they survive an app outage — `file_server` reads disk, no upstream.

`workspace/dev/Caddyfile.mac-proof` (the `:6969` dev gateway):
- **`handle_errors`** → `rewrite * /error.html` + `file_server` from `dist/client`.
  Fires on any re-raised upstream error and on Caddy-level failure (upstream
  unreachable → 502). **Status code is preserved** (verified: dead upstream → 502
  + page; unknown route → 404 + page).
- The catch-all `reverse_proxy 127.0.0.1:4321` re-raises upstream `404 / 403 /
  5xx` via `handle_response { error <code> }` so the branded page renders with
  the real status instead of Astro's bare default or a raw upstream body.
- **`@maintenance file`** matcher on a flag file → serves `maintenance.html` for
  the whole site. Checked per request, so on/off is instant (no reload).

Prod uses a different proxy/paths — **mirror these blocks in the private-ops
prod Caddy config** (the prod `dist/client` path + the prod flag path).

### Status codes
`handle_errors` preserves the originating status (404/403/502/503). The
maintenance page currently returns **200** (it's `noindex`, and maintenance is
transient). If a strict `503 + Retry-After` is wanted, that's a refinement — it
needs a separate path since `handle_errors` is reserved for `error.html`.

## Maintenance runbook

Flip the whole site to the maintenance page **(no caddy reload needed)**:

```bash
workspace/dev/maintenance.sh on      # → every route serves maintenance.html
workspace/dev/maintenance.sh status  # → "maintenance: ON" / "OFF"
workspace/dev/maintenance.sh off     # → back to normal
```

It just creates/removes `workspace/dev/MAINTENANCE_ON` (gitignored; lives outside
`dist/` so a web rebuild never wipes it). The Caddyfile matcher re-reads it per
request.

- **Scope:** v1 is whole-site. To take down only *part* of the platform (e.g.
  while reworking one area), change the `@maintenance` matcher in the Caddyfile
  from the flag-file check to a path matcher (e.g. `path /portfolio*`) — or add a
  second scoped handle — then reload. Keep `/api*` excluded if the backend should
  stay reachable.
- **Prod:** the prod gateway needs the same toggle wired in private-ops, with its
  own flag path + a deploy-runbook line for the operator.

## Changing the pages
Edit `systems/web/public/{error,maintenance}.html` → the dev build loop rebuilds
`dist/client` on save; Caddy serves the new file on the next request (no caddy
reload). Keep them self-contained — never add a local CSS/JS dependency, or they
stop being edge-safe.
