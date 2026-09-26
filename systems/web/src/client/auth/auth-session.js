(function () {
  const currentUrl = new URL(window.location.href);
  const queryBackendBaseUrl = currentUrl.searchParams.get("backendBase");
  // Fallback chain: explicit query param → runtime-config global (set by
  // runtime-config.js, the single client authority) → same-origin relative ''
  // (Caddy proxies /api to the backend, so relative paths work everywhere).
  const DEFAULT_BACKEND_BASE_URL =
    (queryBackendBaseUrl && queryBackendBaseUrl.trim()) ||
    window.NAVI_BACKEND_BASE_URL ||
    '';
  const enabled =
    window.NAVI_ENABLE_BACKEND_AUTH === true ||
    currentUrl.searchParams.get("source") === "backend" ||
    Boolean(queryBackendBaseUrl);
  const AUTH_CACHE_KEY = "navi.auth-session-cache.v1";
  const AUTH_CACHE_TTL_MS = 30 * 60 * 1000;
  // Cross-tab auth sync (F18): localStorage IS cross-tab (unlike the sessionStorage
  // cache above, which is deliberately per-tab). This beacon carries ONLY a
  // timestamp + nonce — never the auth payload itself — so a stale/replayed
  // `storage` event can only ever RE-TRIGGER the real /api/session revalidation
  // (see the shell's `storage` listener), never hand another tab cached identity.
  // The auth state machine stays exactly as-is; this is a doorbell, not a channel.
  const AUTH_BEACON_KEY = "navi.auth-beacon.v1";

  function writeAuthBeacon() {
    try {
      window.localStorage.setItem(
        AUTH_BEACON_KEY,
        JSON.stringify({ at: Date.now(), nonce: Math.random().toString(36).slice(2) })
      );
    } catch (error) {
      // Storage unavailable (private mode, quota) — cross-tab sync degrades to
      // each tab's own visibility-regain / manual reload. Not fatal.
    }
  }

  function buildSignedOutCapabilities() {
    return {
      canTrade: false,
      canAccessAdmin: false,
    };
  }

  function getStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      return null;
    }
  }

  function readCachedAuthState() {
    if (!enabled) {
      return null;
    }

    const storage = getStorage();

    if (!storage) {
      return null;
    }

    try {
      const rawValue = storage.getItem(AUTH_CACHE_KEY);

      if (!rawValue) {
        return null;
      }

      const payload = JSON.parse(rawValue);
      const cachedAt = Number(payload?.cachedAt || 0);

      if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > AUTH_CACHE_TTL_MS) {
        storage.removeItem(AUTH_CACHE_KEY);
        return null;
      }

      return {
        authenticated: payload?.authenticated === true,
        actor: payload?.actor || null,
        session: {
          authenticated: payload?.session?.authenticated === true,
          expiresAt: payload?.session?.expiresAt || null,
        },
        identity: payload?.identity || null,
        user: payload?.user || null,
        capabilities: payload?.capabilities || buildSignedOutCapabilities(),
        reputation: payload?.reputation || null,
        currentUserError: payload?.currentUserError || null,
        lastAuthResult: payload?.lastAuthResult || null,
        error: payload?.error || null,
      };
    } catch (error) {
      storage.removeItem(AUTH_CACHE_KEY);
      return null;
    }
  }

  function persistAuthState() {
    if (!enabled) {
      return;
    }

    const storage = getStorage();

    if (!storage) {
      return;
    }

    storage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        authenticated: state.authenticated,
        actor: state.actor,
        session: state.session,
        identity: state.identity,
        user: state.user,
        capabilities: state.capabilities,
        reputation: state.reputation,
        currentUserError: state.currentUserError,
        lastAuthResult: state.lastAuthResult,
        error: state.error,
      })
    );
  }

  function clearPersistedAuthState() {
    const storage = getStorage();

    storage?.removeItem(AUTH_CACHE_KEY);
  }

  const cachedAuthState = readCachedAuthState();
  // Server-validated auth seed (Layout.astro / middleware.ts). When present it is
  // the authoritative initial signal — the header chrome was already SSR-rendered
  // from it, so adopting it keeps the client from flipping guest↔user on load even
  // when the sessionStorage cache is cold (e.g. first load in a fresh tab).
  const ssrAuth = (typeof window !== "undefined" && window.__NAVI_SSR_AUTH) || null;

  const state = {
    enabled,
    initialized: ssrAuth ? true : !enabled || Boolean(cachedAuthState),
    loading: enabled,
    authenticated: ssrAuth ? ssrAuth.authenticated === true : cachedAuthState?.authenticated === true,
    actor: cachedAuthState?.actor || null,
    session: {
      authenticated: cachedAuthState?.session?.authenticated === true,
      expiresAt: cachedAuthState?.session?.expiresAt || null,
    },
    identity: cachedAuthState?.identity || null,
    user: cachedAuthState?.user || null,
    capabilities: cachedAuthState?.capabilities || buildSignedOutCapabilities(),
    reputation: cachedAuthState?.reputation || null,
    currentUserError: cachedAuthState?.currentUserError || null,
    lastAuthResult: cachedAuthState?.lastAuthResult || null,
    error: cachedAuthState?.error || null,
  };

  let refreshPromise = null;

  function buildUrl(path) {
    return `${DEFAULT_BACKEND_BASE_URL}${path}`;
  }

  function serializeError(error) {
    if (!error) {
      return null;
    }

    return {
      status: error.status ?? null,
      code: error.code ?? "internal_error",
      message: error.message || "Unexpected backend failure.",
    };
  }

  function normalizeIdentity(sessionPayload, currentUserPayload) {
    const primaryIdentity = currentUserPayload?.identity?.primary;

    if (primaryIdentity) {
      return {
        channel: primaryIdentity.channel || "email",
        identifierHint: primaryIdentity.identifierHint || null,
        verifiedAt: primaryIdentity.verifiedAt || null,
      };
    }

    if (sessionPayload?.identity) {
      return {
        channel: sessionPayload.identity.channel || "email",
        identifierHint: sessionPayload.identity.identifierHint || null,
        verifiedAt: null,
      };
    }

    return null;
  }

  function normalizeCapabilities(currentUserPayload) {
    if (!currentUserPayload?.capabilities) {
      return buildSignedOutCapabilities();
    }

    return {
      canTrade: currentUserPayload.capabilities.canTrade === true,
      canAccessAdmin: currentUserPayload.capabilities.canAccessAdmin === true,
    };
  }

  // Tracks the last authenticated value THIS tab beaconed, so a beacon is only
  // written on a genuine flip (guest→user or user→guest). Without this guard, tab
  // B's beacon-triggered refreshSession() would itself emitState() (even when
  // nothing changed) and re-beacon, which tab A's `storage` listener would pick
  // up and refresh again — a ping-pong between open tabs that, at the wrong
  // instant, can land mid-refresh over a real user click (e.g. the logout
  // button, whose surrounding menu gets torn down and rebuilt by renderAuthState
  // on every 'navi:auth-state' event). Gating on an actual flip makes the beacon
  // idempotent: once every open tab agrees, refreshes stop producing beacons.
  let lastBeaconedAuthenticated = null;

  function emitState(meta = {}) {
    window.dispatchEvent(
      new CustomEvent("navi:auth-state", {
        detail: {
          ...window.NaviAuthSession.getState(),
          meta,
        },
      })
    );
    // Every committed auth transition (login verify, logout, signed-out, session
    // refresh) funnels through here — so writing the beacon here (not at each call
    // site) covers all of them by construction, including the ssr-seed bootstrap
    // path below. Skip the ssr_seed reason: that's this tab adopting its OWN
    // server-rendered state on first paint, not a state CHANGE worth telling other
    // tabs about — beaconing it would just make every fresh tab load ping every
    // other open tab for no reason.
    if (meta?.reason === "ssr_seed") {
      lastBeaconedAuthenticated = state.authenticated;
      return;
    }
    if (state.authenticated === lastBeaconedAuthenticated) return;
    lastBeaconedAuthenticated = state.authenticated;
    writeAuthBeacon();
  }

  function buildError(response, payload) {
    const error = new Error(
      payload?.error?.message || "Unexpected backend failure."
    );

    error.status = response.status;
    error.code = payload?.error?.code || "internal_error";
    error.payload = payload;
    return error;
  }

  function applySignedOut(error = null, meta = {}) {
    state.initialized = true;
    state.loading = false;
    state.authenticated = false;
    state.actor = null;
    state.session = {
      authenticated: false,
      expiresAt: null,
    };
    state.identity = null;
    state.user = null;
    state.capabilities = buildSignedOutCapabilities();
    state.reputation = null;
    state.currentUserError = null;
    state.lastAuthResult = null;
    state.error = serializeError(error);
    clearPersistedAuthState();
    emitState(meta);
    return window.NaviAuthSession.getState();
  }

  function applySessionPayload(payload, currentUserPayload = null, error = null, meta = {}) {
    const authenticated = Boolean(payload?.session?.authenticated);

    state.initialized = true;
    state.loading = false;
    state.authenticated = authenticated;
    state.actor = authenticated ? payload?.actor || null : null;
    state.session = {
      authenticated,
      expiresAt: payload?.session?.expiresAt || null,
    };
    state.identity = normalizeIdentity(payload, currentUserPayload);
    state.user = currentUserPayload?.user || null;
    state.capabilities = normalizeCapabilities(currentUserPayload);
    state.reputation = currentUserPayload?.reputation || null;
    state.currentUserError = null;
    state.lastAuthResult = payload?.authResult || null;
    state.error = serializeError(error);
    persistAuthState();
    emitState(meta);
    return window.NaviAuthSession.getState();
  }

  function applyAuthenticatedWithoutCurrentUser(payload, currentUserError, error = null, meta = {}) {
    const authenticated = Boolean(payload?.session?.authenticated);

    state.initialized = true;
    state.loading = false;
    state.authenticated = authenticated;
    state.actor = authenticated ? payload?.actor || null : null;
    state.session = {
      authenticated,
      expiresAt: payload?.session?.expiresAt || null,
    };
    state.identity = normalizeIdentity(payload, null);
    state.user = null;
    state.capabilities = buildSignedOutCapabilities();
    state.reputation = null;
    state.currentUserError = serializeError(currentUserError);
    state.lastAuthResult = payload?.authResult || null;
    state.error = serializeError(error);
    persistAuthState();
    emitState(meta);
    return window.NaviAuthSession.getState();
  }

  async function fetchJson(path, options = {}) {
    const response = await window.fetch(buildUrl(path), {
      credentials: "include",
      ...options,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw buildError(response, payload);
    }

    return payload;
  }

  async function readCurrentUser() {
    return fetchJson("/api/me");
  }

  async function refreshSession() {
    if (!enabled) {
      return applySignedOut(null);
    }

    if (refreshPromise) {
      return refreshPromise;
    }

    state.loading = true;
    emitState();

    refreshPromise = window
      .fetch(buildUrl("/api/session"), {
        credentials: "include",
      })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const error = buildError(response, payload);

          if (response.status === 401) {
            return applySignedOut(error);
          }

          return applySignedOut(error);
        }

        if (!payload?.session?.authenticated) {
          return applySignedOut(null);
        }

        // Bootstrap collapse: /api/session embeds currentUser for
        // authenticated sessions — one round-trip instead of session → me.
        // Older backends (or enrichment failure) omit it; fall back to /api/me.
        if (payload.currentUser) {
          return applySessionPayload(payload, payload.currentUser, null);
        }

        try {
          const currentUserPayload = await readCurrentUser();
          return applySessionPayload(payload, currentUserPayload, null);
        } catch (error) {
          if (error?.status === 401) {
            return applySignedOut(error);
          }

          return applyAuthenticatedWithoutCurrentUser(payload, error, null);
        }
      })
      .catch((error) => applySignedOut(error))
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  window.NaviAuthSession = {
    getBackendBaseUrl() {
      return DEFAULT_BACKEND_BASE_URL;
    },
    getState() {
      return {
        enabled: state.enabled,
        initialized: state.initialized,
        loading: state.loading,
        authenticated: state.authenticated,
        actor: state.actor,
        session: state.session,
        identity: state.identity,
        user: state.user,
        capabilities: state.capabilities,
        reputation: state.reputation,
        currentUserError: state.currentUserError,
        lastAuthResult: state.lastAuthResult,
        error: state.error,
      };
    },
    handleUnauthorized(reasonCode = "unauthorized") {
      return applySignedOut({
        status: 401,
        code: reasonCode,
        message: "Unauthorized.",
      });
    },
    isEnabled() {
      return enabled;
    },
    async logout() {
      if (!enabled) {
        return applySignedOut(null);
      }

      try {
        await fetchJson("/api/auth/logout", {
          method: "POST",
        });

        return applySignedOut(null);
      } catch (error) {
        if (error.status === 401) {
          return applySignedOut(error);
        }

        throw error;
      }
    },
    refreshSession,
    async refreshCurrentUser() {
      if (!enabled || !state.authenticated) {
        return window.NaviAuthSession.getState();
      }

      try {
        const currentUserPayload = await readCurrentUser();
        return applySessionPayload(
          {
            actor: state.actor,
            session: state.session,
            identity: state.identity,
            authResult: state.lastAuthResult,
          },
          currentUserPayload,
          null,
          { reason: "current_user_refresh" }
        );
      } catch (error) {
        if (error?.status === 401) {
          return applySignedOut(error);
        }

        throw error;
      }
    },
    startGoogle(returnTo = window.location.href) {
      if (!enabled) {
        throw new Error("Backend auth mode is not enabled.");
      }

      window.location.href = buildUrl(
        `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
      );
    },
    async start(identifier, purpose) {
      if (!enabled) {
        throw new Error("Backend auth mode is not enabled.");
      }

      return fetchJson("/api/auth/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ identifier, purpose }),
      });
    },
    async verify(challengeId, code) {
      if (!enabled) {
        throw new Error("Backend auth mode is not enabled.");
      }

      const payload = await fetchJson("/api/auth/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          challengeId,
          code,
        }),
      });

      try {
        const currentUserPayload = await readCurrentUser();
        return applySessionPayload(payload, currentUserPayload, null);
      } catch (error) {
        if (error?.status === 401) {
          return applySignedOut(error);
        }

        return applyAuthenticatedWithoutCurrentUser(payload, error, null);
      }
    },
  };

  // Bootstrap. The SSR middleware already validated this session and seeded the
  // full /api/session payload, so adopt it directly — no redundant load-time
  // fetch (one validation per page instead of two). Only hit the network when the
  // server couldn't validate authoritatively (ssrAuth.validated === false), didn't
  // run (no seed), or marked us authed without the embedded user profile.
  if (!ssrAuth || ssrAuth.validated === false) {
    refreshSession();
  } else if (ssrAuth.authenticated) {
    if (ssrAuth.payload && ssrAuth.payload.currentUser) {
      applySessionPayload(ssrAuth.payload, ssrAuth.payload.currentUser, null, {
        reason: "ssr_seed",
      });
    } else {
      refreshSession();
    }
  } else {
    applySignedOut(null, { reason: "ssr_seed" });
  }
})();
