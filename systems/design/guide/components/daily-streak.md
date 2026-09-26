# Daily Streak — Claim Overlay

Updated: 2026-06-19
Status: current (fully wired to the real faucet API; no backend follow-up)
Owner: frontend lane

Purpose:
- the first-login-of-day reward overlay — a collectible "ticket" (medallion streak
  ring, reward hero, 7-day stamp ladder, claim CTA). Fireworks on open, confetti
  from the CTA on claim.
- ported from the claude.ai design drop; **fully real** — the backend faucet
  endpoints already existed, so there are no stubs and no queued backend task.

## Files
- `systems/web/public/scripts/daily-streak/hz-daily-streak.js` — the component
  (`window.HZDailyStreak.create(opts).open(state)`), self-mounting.
- `systems/web/public/scripts/daily-streak/hz-streak-fx.js` — canvas particle
  engine (`window.HZStreakFX`) — fireworks + confetti + count-up.
- `systems/web/public/scripts/daily-streak/daily-streak.js` — the **init island**:
  reads the faucet API, maps state, gates, opens, POSTs the claim.
- `systems/web/src/styles/patterns/daily-streak.css` — component styles (token-driven).
- Loaded globally in `Layout.astro` (fx → component → init order).

## Data wiring (all real)
Reads `GET /api/wallet/faucets` and maps `faucets.dailyLogin` / `faucets.emergency`
to the overlay's `state.kind`:
- `emergency.canClaim` → **emergency** (flat 100, once/24h, not part of the streak).
- `dailyLogin.canClaim` + active position → **position** (ladder reward, day =
  `nextStreakDay`); `nextStreakDay === 7` → **complete** (week done).
- `dailyLogin.canClaim`, no position → **noposition** (flat 25, streak held, not advanced).
- nothing claimable → overlay does not open.

The CTA POSTs the real claim (`/api/wallet/faucets/{daily-login|emergency}/claim`).
`balanceFrom` comes from `liquidBalance`. Reward ladder is `100·150·200·250·300·350·400`,
looped (day 8 → day 1) — backend already enforces the streak math (Asia/Jerusalem,
04:00 grace window); the overlay only renders what the API returns.

## Trigger + gating
- Signed-in users only (gated on the `data-auth-hint` user hint — no fetch for guests).
- **Once per Asia/Jerusalem day.** Eligibility is the backend's `canClaim` (not a
  client clock); the local Jerusalem date is used only as a cheap "already handled
  today" skip (localStorage `navi_streak_seen`) so it doesn't re-fetch on every nav.
- Skips if another overlay is open (e.g. the new-user How It Works one-shot) and
  retries on the next load.

## Wallet credit (decoupled)
The overlay never touches the shell wallet. On a successful claim it dispatches a
`wallet:credited` window event; `header-session.client.js` listens, pops the wallet
cell, and re-reads a **fresh** `GET /api/portfolio/snapshot` for the real balance.
See the "credit reconcile seam" note in `site-shell.md`.

## Notes
- The component keeps its own `×` close (+ tap-outside + Esc). Left as-designed
  (unlike the auth/idea overlays, which had their × removed) — revisit if a
  consistent no-× treatment is wanted across all overlays.
- States other than **noposition** (position / complete / emergency) share the same
  wiring but haven't been exercised against live data — needs a user with an open
  position / day-7 streak / zero balance to verify end-to-end.
