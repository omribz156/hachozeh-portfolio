// Shared snapshot coalescer — collapses concurrent /snapshot calls
// within a single JS turn into one network request.
//
// Both trade-ticket and viewer-positions fetch /api/portfolio/snapshot at
// mount. They mount on the same page (market-detail), so without this
// helper they fire two identical requests within the same tick.
//
// This used to be its own independent coalescer, but the persistent shell
// (header-session.client.js) runs its OWN /api/portfolio/snapshot coalescer
// for the wallet chip, on every authed page — so an authed market-detail
// load fired the fetch twice (once per coalescer). The shell's coalescer is
// now the single owner, exposed as window.NaviSharedSnapshotFetch; we
// delegate to it when present so the whole page shares one in-flight
// request. Resolved LIVE at call time (never captured at module-eval),
// per the ClientRouter gotcha — the shell script only runs once per hard
// load, so caching the reference at import time could freeze a stale
// (or pre-definition) value across soft-navs.
//
// Fallback: an island can render without the shell present (e.g. a
// shell-less embed/test), so we keep a local fetch as a backstop. Astro
// bundles this as a single ES module instance, so `_pending` is shared
// across all importers of THIS module — no window globals needed for the
// fallback path.

let _pending = null;

function fetchSnapshotLocal(options = {}) {
  const forceFresh = Boolean(options?.forceFresh);
  if (forceFresh || !_pending) {
    _pending = fetch('/api/portfolio/snapshot', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .finally(() => {
        _pending = null;
      });
  }
  return _pending;
}

export function fetchSnapshot(options = {}) {
  const shared = window.NaviSharedSnapshotFetch;
  if (typeof shared === 'function') return shared(options);
  return fetchSnapshotLocal(options);
}
