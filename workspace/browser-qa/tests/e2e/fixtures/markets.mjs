/** Shared catalog of representative real markets, one per (type × state), so specs
 *  cover the real layout matrix instead of re-discovering a single happy-path market.
 *
 *  market-detail is THREE different outlays, not one:
 *    - binary  → yes/no pill duo            → `[data-binary-pill-duo]`, has `[data-md-chart]`
 *    - multi   → N-outcome list             → `[data-market-detail-outcomes]` (N rows), has chart
 *    - event   → event ladder (sub-markets) → `[data-market-detail-event]`, NO `[data-md-chart]`
 *  × lifecycle: open (tradeable) | resolved (verdict, no ticket) | closing-soon.
 *
 *  These are dev-seed keys. If one 404s, re-pin from:
 *    curl -s localhost:3001/api/discovery/feed?limit=40 | (classify: outcomes<=2=binary, >2=multi, event!=null=event)
 *  Resolved keys come from omrib's record: GET /api/portfolio/history (authed) — kind=realization. */
export const MARKETS = {
  // ── open (from the discovery feed — guest-readable) ──
  binaryOpen: { key: 'disc-cm-winner-league-hapoel-ta-maccabi-ta-20260623', type: 'binary' },
  multiOpen:  { key: 'disc-cm-gauntlet-sim-next-israel-pm-4out-20260615', type: 'multi', outcomes: 4 },
  eventOpen:  { key: 'disc-cm-gauntlet-sim-election-jun-2026-20260615', type: 'event' },

  // ── resolved (from omrib history) ──
  binaryResolved:  { key: 'disc-cm-gauntlet-sim-basketball-netanya-raanana-20260617-20260615', type: 'binary', state: 'resolved' },
  multiResolved:   { key: 'disc-cm-graph-check-multi-20260526',         type: 'multi', state: 'resolved', outcomes: 3 },
  multiResolved10: { key: 'disc-cm-graph-check-10-outcome-20260526',    type: 'multi', state: 'resolved', outcomes: 10 },
};

// Distinguishing layout assertion per type — a spec switches on `type`:
export const TYPE_MARKERS = {
  binary: '[data-binary-pill-duo]',
  multi: '[data-market-detail-outcomes]',
  event: '[data-market-detail-event]',
};
