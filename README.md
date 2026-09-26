# Hachozeh / החוזה

A Hebrew-first prediction market platform with a virtual economy, built with
Astro, Preact, TypeScript, Fastify, and PostgreSQL.

[Live project](https://hachozeh.com) · [Architecture](ARCHITECTURE.md) ·
[Security](SECURITY.md)

Users discover markets, trade positions, track a portfolio, and see outcomes
resolved against recorded evidence. The currency, **V₪**, is virtual: it cannot
be purchased, withdrawn, or converted into real money.

**Project status:** maintenance-only portfolio demonstration. The production
service runs independently of the developer workstation. New product development
is paused. Historical task notes describe earlier milestones, not a commitment
to implement the remaining roadmap. This is a curated portfolio source snapshot, not the production deployment repository.
Production history, operational records, and unreviewed media are intentionally omitted.
See [snapshot notes](SNAPSHOT.md) for the exact differences and verification limits.

## Engineering Highlights

- **Market engine:** LMSR pricing, exclusive multi-outcome markets, binary and
  complement-side positions, transactional trading, and settlement accounting.
- **Consumer frontend:** Hebrew/RTL layouts, server-rendered pages, Preact
  islands, live market updates, portfolio, profiles, and account settings.
- **Authentication:** email OTP, server-owned sessions, authorization boundaries,
  rate limits, and explicit production configuration checks.
- **Market lifecycle:** separate supply, evidence, and deterministic scheduling
  systems. Sensitive publication and resolution operations remain human-gated.
- **Operations:** container deployment, health diagnostics, production monitoring,
  test automation, and documented operational procedures.

## System Map

```text
Browser -> Gateway -> Astro SSR + Preact
                   -> Fastify API -> PostgreSQL

Seer    -> reviewed market proposals
Oracle  -> source evidence and resolution recommendations
Horizon -> deterministic close/readiness scheduling
Backend -> authorized mutation, ledger, and settlement
```

| Directory | Responsibility |
| --- | --- |
| `systems/web` | Active frontend |
| `systems/back` | API, authentication, pricing, trading, persistence |
| `systems/oracle` | Evidence adapters and lifecycle review |
| `systems/seer` | Market-supply discovery and proposal tooling |
| `systems/cli` | Shared command-line boundaries |
| `systems/design` | Selected design doctrine and CSS source |
| `workspace/browser-qa` | Browser tests and local test proxy |
| `workspace` | Selected development tooling and synthetic test fixtures |

The product name is **Hachozeh**. `Navi` remains the internal repository/package
namespace; it does not identify a separate product.

## Local Evaluation

Requirements: Node.js 22.12+ (Node 24 also supported), npm, and Docker for a
local PostgreSQL instance. Use an isolated database, never production credentials.
No Cloudflare tunnel or developer-machine access is required.

From the repository root:

```sh
npm ci
docker compose up -d postgres
NAVI_ENV_FILE="$PWD/systems/back/.env.example" npm --prefix systems/back run db:bootstrap
```

In separate terminals:

```sh
# API. Fixed OTP is for local evaluation only; production rejects this setting.
NAVI_ENV_FILE="$PWD/systems/back/.env.example" HOST=127.0.0.1 AUTH_DEV_OTP_EXPOSED=true npm --prefix systems/back run dev
```

```sh
# Frontend, with same-origin /api proxy to the local backend.
npm --prefix systems/web run dev:hot
```

Open **http://127.0.0.1:6969/trending**. Local OTP: `111111`.
The API listens on `127.0.0.1:3001`; PostgreSQL is bound to loopback port `55432`.
The default seed is synthetic local data, not a copy of the production catalog.
External mail, OAuth, analytics, and credentialed source adapters require separate
configuration; consult the relevant `.env.example` files.

`NAVI_ENV_FILE` explicitly selects the sample configuration above and avoids
accidentally loading an existing maintainer's private configuration. Never expose
the evaluation settings or Vite development server to the public Internet.

## Verification

These commands do not need a running database:

```sh
npm run security:audit:prod
npm run security:codeql:gate:test
npm --prefix systems/back run typecheck
NAVI_ENV_FILE=/dev/null npm --prefix systems/back test
npm --prefix systems/web run check
npm --prefix systems/web run build
```

Database integration tests and end-to-end browser tests are separate:
see [backend documentation](systems/back/README.md) and
[browser QA](workspace/browser-qa/tests/e2e/README.md). Passing unit tests or a build does
not establish that a particular deployment is healthy.

## Source And Media

No open-source reuse license has been granted for the project code yet.
Third-party dependencies, fonts, and media retain their own terms.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and the media
licenses retained and substitutions made in this snapshot.

For coding agents: [AGENTS.md](AGENTS.md). Historical doc references in source
comments may point to internal records intentionally omitted from this snapshot.
