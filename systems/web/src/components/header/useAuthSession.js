import { useState, useEffect } from 'preact/hooks';

// Hook: subscribes to window.NaviAuthSession (the shared vanilla auth layer).
// Mirrors the pattern from usePortfolioModel.js — SSR-safe, render-then-hydrate.
//
// During SSR (window is undefined) returns null; the island must accept SSR-derived
// props for the initial render so first paint is correct without a hydration flip.
// After hydration, this hook re-syncs once and then tracks every navi:auth-state
// event, keeping the island live without any polling.
//
// Returns the full auth state object, or null during SSR / before NaviAuthSession loads.

function readAuthState() {
  if (typeof window === 'undefined') return null;
  return window.NaviAuthSession?.getState?.() ?? null;
}

export default function useAuthSession() {
  const [auth, setAuth] = useState(readAuthState);

  useEffect(() => {
    // Re-sync at hydration in case auth resolved between SSR and mount.
    setAuth(readAuthState());

    function onAuthState() {
      setAuth(readAuthState());
    }

    window.addEventListener('navi:auth-state', onAuthState);
    return () => {
      window.removeEventListener('navi:auth-state', onAuthState);
    };
  }, []);

  return auth;
}
