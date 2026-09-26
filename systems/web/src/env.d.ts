/// <reference types="astro/client" />

interface Window {
  __allmkFilterBound?: boolean;
  __naviSearchBound?: boolean;
  NaviAuthSession?: { getBackendBaseUrl?: () => string };
  NaviOverlays?: { open?: (name: string) => void };
}

declare namespace App {
  interface Locals {
    // Server-validated auth for the request, set by src/middleware.ts.
    // The header chrome (guest vs user) is rendered from this, so first paint
    // matches reality instead of being reconstructed client-side.
    auth: {
      authenticated: boolean;
      // true when the server got a definitive answer (so the client can adopt it
      // without its own round-trip); false on a fail-closed fallback to re-check.
      validated: boolean;
      // The full /api/session payload (with embedded currentUser) when authed,
      // handed to the client so it skips the redundant load-time fetch.
      payload: unknown | null;
    };
  }
}
