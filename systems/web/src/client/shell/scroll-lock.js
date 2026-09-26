// scroll-lock.js — single refcounted owner of `body.overlay-open`.
//
// Three independent callers toggle the platform's scroll-lock class:
// usePageOverlay.js (auth overlays), QuickBuyHost.jsx (mobile quick-buy
// sheet), and the market page's inline ticket-sheet script
// ([marketKey].astro). Each used to add/remove the class unconditionally,
// so whichever one closed LAST won — closing the login overlay while the
// mobile ticket sheet was still open removed the class and let the
// background scroll behind an open sheet. A soft-nav could also orphan the
// class entirely (ClientRouter doesn't swap <body>, so a lock held at
// navigation time never got its matching unlock).
//
// This module is the one thing all three callers agree to call instead of
// touching classList directly. It's a plain counter: lock() increments and
// applies the class on 0→1, unlock() decrements and removes it on 1→0.
// unlock() is guarded against going below zero so a stray extra call can't
// desync the count negative (which would require N future locks before the
// class could ever come off again).
//
// Idempotency is the CALLER's job, not the counter's: each owner tracks its
// OWN held/not-held boolean and only calls lock()/unlock() on actual state
// transitions (see usePageOverlay.js's `heldRef`). A shared counter can't
// tell "component re-rendered and effect re-ran" apart from "a genuinely new
// lock" — token/handle semantics would solve that too, but they add an
// object identity to thread through three very different call sites (two
// Preact effects with their own cleanup timing, one vanilla event-delegated
// script) for no benefit over "don't call unlock twice for one lock".
//
// Published as window.NaviScrollLock so the vanilla market-page script can
// resolve it live (per the ClientRouter gotcha: never capture a module
// reference across a soft-nav swap — always read window.NaviScrollLock at
// call time). Preact islands may import the named exports directly; both
// paths share the same counter since the window global IS this module's
// state, not a copy.

let count = 0;

function apply() {
  document.body.classList.toggle('overlay-open', count > 0);
}

export function lock() {
  count += 1;
  if (count === 1) apply();
}

export function unlock() {
  if (count === 0) return; // guard: never go below zero
  count -= 1;
  if (count === 0) apply();
}

// Hard reset used on soft-nav (astro:before-swap) and anywhere else that
// needs a known-clean slate regardless of how many locks are outstanding —
// e.g. a component tree that's about to be torn down without running its
// own cleanup (ClientRouter unmounts client:only islands on swap, but the
// vanilla market-page script has no unmount hook at all, only before-swap).
export function releaseAll() {
  count = 0;
  document.body.classList.remove('overlay-open');
}

export function isLocked() {
  return count > 0;
}

const api = { lock, unlock, releaseAll, isLocked };

// Registration mirrors window.NaviSharedSnapshotFetch in this same file's
// neighbor (header-session.client.js): guard against re-registration so a
// second module evaluation (shouldn't happen, but matches the house style)
// never resets an in-flight count.
window.NaviScrollLock = window.NaviScrollLock || api;

// Soft-nav catch-all: release whatever is held before ClientRouter swaps the
// document. No LOCK-HOLDING surface survives a soft-nav today: the one
// transition:persist subtree is the site-shell chrome (SiteHeader.astro),
// which never takes a scroll lock; PageOverlayHost/QuickBuyHost are
// client:only islands OUTSIDE it and fully unmount on swap, and the vanilla
// ticket-sheet script has no other cleanup hook. So a blanket release-all is
// safe. If a future overlay is ever built to persist across navigation,
// it must opt out by re-acquiring its own lock after the swap rather than
// relying on this catch-all skipping it.
document.addEventListener('astro:before-swap', releaseAll);
