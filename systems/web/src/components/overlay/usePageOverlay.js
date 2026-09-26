// usePageOverlay.js — Preact hook that owns overlay URL state + shell variant.
// The hook is the single source of truth for which overlay is active.
// Side effects (body class, window globals, auth-success timer) live here.

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import useAuthSession from '../header/useAuthSession.js';
import { lock as lockScroll, unlock as unlockScroll } from '../../client/shell/scroll-lock.js';
import {
  NAVI_OVERLAY_PARAM,
  NAVI_ALLOWED_OVERLAYS,
  NAVI_PAGE_ROUTES,
  buildCurrentOverlayHref,
  buildPageHref,
  freshIdeaState,
  mapAuthErrorMessage,
  canUseFakeAuth,
  shouldRedirectToHomeUser,
  shouldSuppressDevOtp,
} from './overlay-logic.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readOverlayParam() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(NAVI_OVERLAY_PARAM) || '';
}

// Extended for SSR safety.
// Priority: if auth is enabled and settled, use authenticated state.
// Otherwise fall back to data-site-shell[data-shell-variant] (DOM attr set by
// header-session.client.js). When that attr is also empty (race at hydration
// where header-session hasn't run yet), fall back to 'landing-guest' — the
// correct default for an unauthenticated/loading session.
function deriveShellVariant(auth) {
  if (typeof document === 'undefined') return '';

  const requestedVariant =
    document.querySelector('[data-site-shell]')?.dataset?.shellVariant || '';

  if (!auth?.enabled || (auth.loading && !auth.initialized)) {
    // If DOM attr isn't set yet (race), fall back to landing-guest so
    // guest overlays (login/signup etc.) are visible during the loading window.
    return requestedVariant || 'landing-guest';
  }

  return auth.authenticated ? 'landing-user' : 'landing-guest';
}

function computeActive(overlayValue, shellVariant) {
  const allowed = NAVI_ALLOWED_OVERLAYS[shellVariant] || new Set();
  return allowed.has(overlayValue);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export default function usePageOverlay() {
  const auth = useAuthSession();

  // Current ?overlay= value. SSR returns '' (no window).
  const [overlayValue, setOverlayValue] = useState(readOverlayParam);

  // Per-overlay state (auth flow, idea).
  const [authState, setAuthState] = useState({
    challengeId:  '',
    codeDraft:    '',
    devCode:      '',
    errorMessage: '',
    errorTitle:   '',
    identifier:   '',
    purpose:      'login',
    retryOverlay: 'login',
  });
  const [ideaState, setIdeaState] = useState(freshIdeaState);

  // Timer ref for auth-success auto-close.
  const timerRef = useRef(null);

  const shellVariant = deriveShellVariant(auth);
  const active = computeActive(overlayValue, shellVariant);

  // ── URL navigation ──────────────────────────────────────────────────────────

  const open = useCallback((value) => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', buildCurrentOverlayHref(value));
    setOverlayValue(value);
  }, []);

  const close = useCallback((opts = {}) => {
    if (typeof window === 'undefined') return;
    // If idea was sent, reset so reopen starts fresh (in-progress draft stays).
    setIdeaState((prev) => (prev.sent ? freshIdeaState() : prev));
    const nextHref = buildCurrentOverlayHref('');
    if (opts.replace) {
      window.history.replaceState({}, '', nextHref);
    } else {
      window.history.pushState({}, '', nextHref);
    }
    setOverlayValue('');
  }, []);

  // Real page navigation (NOT pushState) — used by fake-auth otp path.
  const goToPage = useCallback((pageName, overlayVal) => {
    if (typeof window === 'undefined') return;
    window.location.href = buildPageHref(pageName, overlayVal, { preserveCurrentSearch: false });
  }, []);

  // ── External open/close seam (NaviOverlays) ─────────────────────────────────

  useEffect(() => {
    window.NaviOverlays = { open, close };
  }, [open, close]);

  // ── Hydration sync + Popstate ────────────────────────────────────────────────
  // useState(readOverlayParam) runs during SSR where window is undefined,
  // so it initialises to ''. On mount we re-sync from the real URL so the
  // island picks up ?overlay=… that was already in the URL before hydration.

  useEffect(() => {
    // Sync from URL immediately on mount (covers SSR→hydration gap).
    setOverlayValue(readOverlayParam());

    function onPopState() {
      setOverlayValue(readOverlayParam());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ── On mount: consume external auth error from Google redirect ───────────────
  // Must run before first active computation — replaceState changes the URL so
  // the overlay param and auth error state are both correct on first render.
  // The setState here races with the initial render; using a layout-effect
  // equivalent isn't possible in SSR-safe Preact, so we update state and the
  // next render after mount will show auth-error correctly.

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('auth_error')) return;

    const errorCode =
      params.get('auth_error_code') || params.get('auth_error') || 'google_auth_failed';

    setAuthState((prev) => ({
      ...prev,
      errorTitle:   'כניסה עם Google נכשלה',
      errorMessage: mapAuthErrorMessage(errorCode),
      retryOverlay: 'login',
    }));

    params.delete('auth_error');
    params.delete('auth_error_code');
    params.set(NAVI_OVERLAY_PARAM, 'auth-error');

    const nextQuery = params.toString();
    const nextHref = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextHref);
    setOverlayValue('auth-error');
  }, []); // intentionally mount-only

  // ── body scroll-lock ─────────────────────────────────────────────────────────
  // heldRef tracks whether THIS hook instance currently holds a lock, so the
  // shared refcount (window.NaviScrollLock) only ever sees one lock()/unlock()
  // per real state transition — never a double-release. That guard matters
  // because effect cleanup + re-run order isn't something we control: a
  // cleanup can fire once for the outgoing `active` value and the new effect
  // body fire for the incoming one, or (on unmount) cleanup can fire alone.
  // Without heldRef, an unmount right after an `active`-flip effect could
  // unlock() twice for a single lock() — harmless here because unlock() is
  // itself floor-guarded at zero, but it would still release a lock some
  // OTHER owner (QuickBuyHost, the ticket-sheet script) is still holding.
  const heldRef = useRef(false);

  useEffect(() => {
    if (active && !heldRef.current) {
      heldRef.current = true;
      lockScroll();
    } else if (!active && heldRef.current) {
      heldRef.current = false;
      unlockScroll();
    }
    return () => {
      if (heldRef.current) {
        heldRef.current = false;
        unlockScroll();
      }
    };
  }, [active]);

  // ── auth-success auto-close ─────────────────────────────────────────────────

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (overlayValue === 'auth-success') {
      timerRef.current = setTimeout(() => {
        close({ replace: true });
      }, 1700);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [overlayValue, close]);

  // ── Auth error helpers ──────────────────────────────────────────────────────

  function clearAuthFlowError() {
    setAuthState((prev) => ({ ...prev, errorMessage: '', errorTitle: '' }));
  }

  function setAuthError(error, retryOverlay) {
    const msg =
      typeof error === 'string' ? error : mapAuthErrorMessage(error?.code);
    setAuthState((prev) => ({
      ...prev,
      errorTitle:   'האימות נכשל',
      errorMessage: msg,
      retryOverlay,
    }));
  }

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    overlayValue,
    active,
    shellVariant,
    authState,
    setAuthState,
    ideaState,
    setIdeaState,
    open,
    close,
    goToPage,
    clearAuthFlowError,
    setAuthError,
  };
}
