(function () {
  const authSession = window.NaviAuthSession;
  const currentUrl = new URL(window.location.href);
  const queryBackendBaseUrl = currentUrl.searchParams.get("backendBase");
  // Fallback chain: explicit query param → auth session → runtime-config global
  // → same-origin (Caddy proxies /api to the backend, so '' is correct for prod
  // and any subdomain). The old localhost literal is removed — it was never
  // reachable (window.location.origin is always defined in a browser context).
  const DEFAULT_BACKEND_BASE_URL =
    (queryBackendBaseUrl && queryBackendBaseUrl.trim()) ||
    authSession?.getBackendBaseUrl?.() ||
    window.NAVI_BACKEND_BASE_URL ||
    '';
  const backendModeEnabled =
    window.NAVI_REQUIRE_BACKEND_PORTFOLIO === true ||
    authSession?.isEnabled?.() === true ||
    window.NAVI_ENABLE_BACKEND_PORTFOLIO === true ||
    currentUrl.hostname === "127.0.0.1" ||
    currentUrl.hostname === "localhost" ||
    currentUrl.hostname.endsWith(".hachozeh.com") ||
    currentUrl.searchParams.get("source") === "backend" ||
    Boolean(queryBackendBaseUrl);
  let cacheGeneration = 0;
  let activeAuthCacheKey = null;
  const cacheStateByAuthKey = new Map();

  function resolveAuthCacheKey() {
    const authState = authSession?.getState?.() || null;

    if (!authState || authState.enabled !== true) {
      return "auth-disabled";
    }

    if (authState.loading || authState.initialized !== true) {
      return "auth-pending";
    }

    if (authState.authenticated !== true) {
      return "auth-signed-out";
    }

    const userId = authState?.user?.userId || authState?.actor?.userId || authState?.actor?.id;

    return userId ? `user:${userId}` : "auth-without-identity";
  }

  function canReadPrivatePortfolioRecord(authState = authSession?.getState?.() || null) {
    if (!authState || authState.enabled !== true) {
      return true;
    }

    if (authState.loading || authState.initialized !== true) {
      return false;
    }

    if (authState.authenticated !== true) {
      return false;
    }

    const userId = authState?.user?.userId || authState?.actor?.userId || authState?.actor?.id;
    return Boolean(userId);
  }

  function readCacheState(cacheKey = resolveAuthCacheKey()) {
    let state = cacheStateByAuthKey.get(cacheKey);
    if (!state) {
      state = {
        cacheKey,
        generation: cacheGeneration,
        cachedRecord: undefined,
        cachedError: null,
        inflightRecord: null,
      };
      cacheStateByAuthKey.set(cacheKey, state);
    }
    return state;
  }

  function readActiveCacheState() {
    const cacheKey = resolveAuthCacheKey();

    if (activeAuthCacheKey !== cacheKey) {
      cacheGeneration += 1;
      activeAuthCacheKey = cacheKey;
      for (const state of cacheStateByAuthKey.values()) {
        state.generation = cacheGeneration;
        state.cachedRecord = undefined;
        state.cachedError = null;
        state.inflightRecord = null;
      }
    }

    const state = readCacheState(cacheKey);
    if (state.generation !== cacheGeneration) {
      state.generation = cacheGeneration;
      state.cachedRecord = undefined;
      state.cachedError = null;
      state.inflightRecord = null;
    }
    return state;
  }

  function isCurrentState(state, generation) {
    return state && state.generation === generation;
  }

  function buildSnapshotUrl() {
    return `${DEFAULT_BACKEND_BASE_URL}/api/portfolio/snapshot`;
  }

  function buildSectionUrl(section) {
    return `${DEFAULT_BACKEND_BASE_URL}/api/portfolio/${section}`;
  }

  function buildPerformanceUrl(timeframe) {
    // DEFAULT_BACKEND_BASE_URL is "" for same-origin (the prod/subdomain
    // default), so buildSectionUrl can return a relative path — `new URL()`
    // with no base throws on those. Provide window.location.origin as the
    // base so it resolves for both relative and absolute bases.
    const url = new URL(buildSectionUrl("performance"), window.location.origin);
    if (timeframe) {
      url.searchParams.set("timeframe", timeframe);
    }
    // Keep the request origin-relative when same-origin (matches the rest of
    // the data source); only emit an absolute URL when a base is configured.
    return DEFAULT_BACKEND_BASE_URL
      ? url.toString()
      : `${url.pathname}${url.search}`;
  }

  function buildCurrentUserSessionsUrl() {
    return `${DEFAULT_BACKEND_BASE_URL}/api/me/sessions`;
  }

  function buildCurrentUserRevokeOtherSessionsUrl() {
    return `${DEFAULT_BACKEND_BASE_URL}/api/me/sessions/revoke-others`;
  }

  function buildVerificationTierPurchaseUrl() {
    return `${DEFAULT_BACKEND_BASE_URL}/api/me/verification-tier/purchase`;
  }

  async function readJson(url) {
    const response = await window.fetch(url, {
      credentials: "include",
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message || "Unexpected backend failure."
      );

      error.status = response.status;
      error.code = payload?.error?.code || "internal_error";
      error.payload = payload;

      if (response.status === 401) {
        authSession?.handleUnauthorized?.(error.code);
      }

      throw error;
    }

    return payload;
  }

  async function readOptionalJson(url) {
    try {
      const payload = await readJson(url);
      return payload;
    } catch {
      return null;
    }
  }

  async function postJson(url, body) {
    const response = await window.fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message || "Unexpected backend failure."
      );

      error.status = response.status;
      error.code = payload?.error?.code || "internal_error";
      error.payload = payload;

      if (response.status === 401) {
        authSession?.handleUnauthorized?.(error.code);
      }

      throw error;
    }

    return payload;
  }

  async function readPortfolioRecord() {
    const authState = authSession?.getState?.() || null;
    if (!canReadPrivatePortfolioRecord(authState)) {
      readActiveCacheState();
      return null;
    }

    const cacheState = readActiveCacheState();
    if (cacheState.cachedRecord !== undefined) {
      return cacheState.cachedRecord;
    }
    // Single-flight: the orchestrator (portfolio.js) AND both island consumers
    // (PortfolioCards / PortfolioDepth via usePortfolioModel) call this concurrently
    // on load. Without an in-flight guard each one fired the WHOLE batch — 3× the
    // snapshot/orders/history/performance/claims/sessions requests. Share one in-flight
    // promise and clear it on settle, so a later invalidate()→refetch still starts
    // fresh. (Same coalescing pattern as market-detail/snapshot-fetch.js.)
    if (cacheState.inflightRecord) {
      return cacheState.inflightRecord;
    }
    const requestGeneration = cacheState.generation;
    cacheState.inflightRecord = (async () => {
      try {
        const shouldReadSessionSecurity = authState?.authenticated === true;
        // Snapshot rides the same parallel batch as the section reads (it
        // gates nothing), and goes through the header's shared seam when the
        // page is same-origin — the wallet already fetched it, one crossing
        // serves both.
        const snapshotUrl = buildSnapshotUrl();
        const canUseSharedSnapshot =
          typeof window.NaviSharedSnapshotFetch === "function" &&
          snapshotUrl === "/api/portfolio/snapshot";
        const [snapshot, orders, history, performance, claims, sessionSecurity] = await Promise.all([
          canUseSharedSnapshot ? window.NaviSharedSnapshotFetch() : readJson(snapshotUrl),
          readOptionalJson(buildSectionUrl("orders")),
          readOptionalJson(buildSectionUrl("history")),
          readOptionalJson(buildPerformanceUrl("day")),
          readOptionalJson(buildSectionUrl("claims")),
          shouldReadSessionSecurity
            ? readOptionalJson(buildCurrentUserSessionsUrl())
            : Promise.resolve(null),
        ]);

        const nextRecord = {
          mode: "backend",
          payload: {
            snapshot,
            orders,
            history,
            performance,
            claims,
            sessionSecurity,
          },
        };

        if (!isCurrentState(cacheState, requestGeneration)) {
          return null;
        }

        cacheState.cachedError = null;
        cacheState.cachedRecord = nextRecord;
        return nextRecord;
      } catch (error) {
        // No fixture fallback: a failed backend read surfaces as an honest
        // error state upstream. Fake data must never paint on a real page.
        if (isCurrentState(cacheState, requestGeneration)) {
          cacheState.cachedError = error;
          cacheState.cachedRecord = null;
        }
        return null;
      } finally {
        if (isCurrentState(cacheState, requestGeneration)) {
          cacheState.inflightRecord = null;
        }
      }
    })();
    return cacheState.inflightRecord;
  }

  async function readPortfolioPerformanceTimeframe(timeframe) {
    if (!backendModeEnabled || !timeframe) {
      return null;
    }

    const authState = authSession?.getState?.() || null;
    if (!canReadPrivatePortfolioRecord(authState)) {
      readActiveCacheState();
      return null;
    }

    const cacheState = readActiveCacheState();
    const requestGeneration = cacheState.generation;
    const performance = await readOptionalJson(buildPerformanceUrl(timeframe));
    if (!performance || !isCurrentState(cacheState, requestGeneration)) {
      return null;
    }

    if (cacheState.cachedRecord?.mode === "backend" && isCurrentState(cacheState, requestGeneration)) {
      cacheState.cachedRecord = {
        ...cacheState.cachedRecord,
        payload: {
          ...cacheState.cachedRecord.payload,
          performance: {
            ...cacheState.cachedRecord.payload.performance,
            ...performance,
            views: {
              ...cacheState.cachedRecord.payload.performance?.views,
              ...performance.views,
            },
          },
        },
      };
    }

    return performance;
  }

  // Drop the cached record so the next readPortfolioRecord() refetches
  // from backend. Called by the portfolio page when a navi:portfolio-
  // snapshot-updated event fires (after a successful trade elsewhere
  // — e.g. market-detail). Without this, the cache held the pre-trade
  // snapshot forever and the portfolio page stayed visibly stale.
  function invalidate() {
    cacheGeneration += 1;
    for (const state of cacheStateByAuthKey.values()) {
      state.generation = cacheGeneration;
      state.cachedRecord = undefined;
      state.cachedError = null;
      state.inflightRecord = null;
    }
  }

  window.NaviPortfolioDataSource = {
    getLastError() {
      return readActiveCacheState().cachedError;
    },
    isBackendModeEnabled() {
      return backendModeEnabled;
    },
    invalidate,
    async revokeOtherSessions() {
      const payload = await postJson(buildCurrentUserRevokeOtherSessionsUrl(), {});
      invalidate();
      return payload;
    },
    async claimPortfolioReward(claimId) {
      const payload = await postJson(
        `${buildSectionUrl("claims")}/${encodeURIComponent(claimId)}/claim`,
        {}
      );
      invalidate();
      return payload;
    },
    async purchaseVerificationTier(tier) {
      const payload = await postJson(buildVerificationTierPurchaseUrl(), { tier });
      invalidate();
      return payload;
    },
    readPortfolioPerformanceTimeframe,
    readPortfolioRecord,
  };
})();
