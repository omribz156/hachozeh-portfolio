# Platform Watchdog V1

Updated: 2026-05-28
Status: active local/dev operator tool + VPS/systemd recovery seam
Owner: backend / ops seam

Purpose:
- prove the local platform is usable beyond "tmux exists"
- record backend/frontend health receipts during gauntlets
- restart only known tmux lanes when explicitly allowed

## What It Checks

Default targets:
- backend: `http://127.0.0.1:3001/health/ready`
- frontend: `http://127.0.0.1:6969/trending`

Default tmux lanes:
- backend: `codex-navi-back`
- frontend: `codex-web`

Default restart commands:
- backend: `npm --prefix systems/back run dev`
- frontend: `npm --prefix systems/web run dev`

## Platform Doctor

Use the doctor when you want a verdict without restart behavior:

```bash
npm --prefix systems/back run doctor:platform
```

Default output is compact and human-readable.

Full JSON:

```bash
npm --prefix systems/back run doctor:platform:json
```

Write a local JSONL report receipt:

```bash
npm --prefix systems/back run doctor:platform:report
```

Deep gauntlet/production read:

```bash
npm --prefix systems/back run doctor:platform:deep
```

Production-origin read:

```bash
PUBLIC_BASE_URL=https://hachozeh.com npm --prefix systems/back run doctor:production
npm --prefix systems/back run doctor:production:report
```

It checks:
- backend `/health/live`
- backend `/health/ready`
- backend `/health/diagnostics`
- frontend static route
- in deep mode: open-market catalog, representative market/detail/history/stream, portfolio shell, and market-detail shell
- in production mode: runtime identity, migration state, and backup freshness in diagnostics

Output verdicts:
- `ok`: probes reachable and diagnostics healthy
- `watch`: probes reachable but diagnostics are warm/degraded, lifecycle is blocked/stale, or deep candidate coverage is incomplete
- `bad`: required probe failed or diagnostics are bad

## Safety Model

The watchdog is dry-run by default.

Default command runs one tick and writes a JSONL receipt:

```bash
npm --prefix systems/back run watchdog:platform
```

Continuous dry-run:

```bash
npm --prefix systems/back run watchdog:platform:loop
```

Continuous restart mode:

```bash
npm --prefix systems/back run watchdog:platform:execute
```

Restart mode is intentionally scoped:
- on VPS, it restarts only explicitly configured systemd units
- on the local Mac proof runtime, it restarts only explicitly configured launchd labels
- in dev fallback, it verifies the configured tmux session exists and respawns that pane only
- it never kills arbitrary `node` processes by name

## Receipts

Receipts are JSONL lines under:

```text
workspace/runtime/watchdog/
```

Each tick records:
- target name and URL
- HTTP status / timeout error
- elapsed time
- consecutive failure count
- failure kind and tmux pane snapshot when a target is down
- action: `none`, `would_restart`, `restarted`, `restart_failed`, or `restart_blocked`

Summarize a watchdog receipt:

```bash
WATCHDOG_RECEIPT_PATH=workspace/runtime/watchdog/<file>.jsonl npm --prefix systems/back run watchdog:platform:summary
```

Execute-mode backoff:
- default max restarts: `3` per `10m` window
- default cooldown after limit: `60s`
- override with `--max-restarts-per-window=`, `--restart-window-ms=`, and `--restart-cooldown-ms=`

## Diagnostics Thresholds

`/health/diagnostics.health` exposes a machine-readable verdict.

Defaults:
- `BACKEND_RSS_WATCH_MIB=512`
- `BACKEND_RSS_BAD_MIB=1024`
- `BACKEND_HEAP_USED_WATCH_MIB=256`
- `BACKEND_HEAP_USED_BAD_MIB=512`

These are local/dev guardrails until production thresholds are tuned from real
traffic. `doctor:production` treats missing runtime identity and missing
migration state as production failures. The Render hourly launch monitor passes
`--allow-missing-backup` until off-host backup proof is wired; manual hard-gate
runs should omit that flag once backup/restore receipts exist.

Diagnostics also expose:
- `database.pool.totalCount / idleCount / waitingCount`
- rolling request metrics for `1m` and `5m`
- rolling 4xx/5xx counts
- rolling `/history` latency summary
- runtime identity: service, environment, commit SHA, build timestamp, release id
- schema migration state: latest migration and count
- latest local backup age from `workspace/backups/*.dump` or `NAVI_BACKUP_DIR`
- latest Oracle lifecycle heartbeat snapshot when one exists

Doctor verdict uses these diagnostics:
- missing `health.verdict` is `bad`
- backend diagnostics `bad` is `bad`
- backend diagnostics `watch`, DB waiting clients, 5xx pressure, slow `/history`, stale lifecycle heartbeat, blocked lifecycle status, and missing resolution cases are `watch`
- production mode requires runtime identity and migration state; backup proof is
  required unless `--allow-missing-backup` is passed for the launch monitor.
  Stale present backups are still `watch`.

## Gauntlet Companion Shape

For long soaks, run one bounded watchdog beside the gauntlet:

```bash
npm --prefix systems/back run watchdog:platform -- --loop --iterations=120 --interval-ms=30000
```

Shortcut:

```bash
npm --prefix systems/back run watchdog:platform:gauntlet
```

The gauntlet report should summarize:
- backend/frontend probe pass rate
- restart count
- longest outage
- `restart_blocked` and `restart_failed` counts
- RSS / heap trend from diagnostics
- DB pool total/idle/waiting trend
- history latency p95/p99 from soak receipts
- doctor deep verdict at start, midpoint, and closeout

## Useful Overrides

```bash
BACKEND_READY_URL=http://127.0.0.1:3001/health/ready \
FRONTEND_READY_URL=http://127.0.0.1:6969/trending \
WATCHDOG_BACK_TMUX_SESSION=codex-navi-back \
WATCHDOG_FRONT_TMUX_SESSION=codex-web \
npm --prefix systems/back run watchdog:platform -- --failure-threshold=2
```

VPS/systemd production recovery:

```bash
WATCHDOG_BACK_SYSTEMD_UNIT=hachozeh-backend.service \
WATCHDOG_FRONT_SYSTEMD_UNIT=hachozeh-web.service \
npm --prefix systems/back run watchdog:production
```

Template units live in `workspace/deploy/systemd/`.

For bounded gauntlet use:

```bash
npm --prefix systems/back run watchdog:platform -- --loop --iterations=120 --interval-ms=30000
```

## What This Is Not

This is not production process management.

systemd/host process management is still the owner of hard restarts. The
watchdog is a liveness receipt + alert + scoped recovery caller for known units.

Still missing for deploy hardening:
- persistent metrics dashboard
- user-visible status page
- cross-machine recovery
- outside-in public monitor activation

The V1 goal is runtime truth: if the platform looks alive but `/health/ready` or
the served frontend is dead, the receipt says so and execute mode can restart
the owned lane.
