(function init(attempt) {
  // Thin portfolio shell. The cards (total, PnL, claims, closing-soon) and the
  // depth section (tabs + positions + history) are Preact islands
  // (PortfolioCards / PortfolioDepth), siblings of this container. This
  // orchestrator now owns only the data load + the auth-gate / loading / error
  // states painted into [data-portfolio-cards].
  //
  // The portfolio/personal toggle and the personal-space verification track were
  // removed from this page — they live on a dedicated page now. With no personal
  // view here, the cards/depth islands always render once authed.
  const mount = document.querySelector("[data-portfolio-cards]");
  if (!mount) return;

  // Sized load skeleton (mobile-audit 2.3) — approximates the top-fold
  // (total + PnL cards) and the first few position rows so the swap to the
  // real Preact islands doesn't reflow the page. Kept as one string here (and
  // mirrored as the static SSR placeholder in PortfolioIsland.astro) rather
  // than generated, since the shape is fixed and this avoids a template dep.
  const LOADING_SKELETON_HTML = `
    <div class="pf-skel" aria-hidden="true">
      <div class="pf-skel-top-fold">
        <div class="pf-skel-card">
          <span class="hz-skel hz-skel--line"></span>
          <span class="hz-skel hz-skel--line-lg"></span>
          <span class="hz-skel hz-skel--line"></span>
        </div>
        <div class="pf-skel-card">
          <span class="hz-skel hz-skel--line"></span>
          <span class="hz-skel hz-skel--line-lg"></span>
          <span class="hz-skel hz-skel--line"></span>
        </div>
      </div>
      <div class="pf-skel-rows">
        <div class="pf-skel-row"><span class="hz-skel hz-skel--thumb"></span><span class="hz-skel hz-skel--line"></span><span class="hz-skel hz-skel--line-sm"></span></div>
        <div class="pf-skel-row"><span class="hz-skel hz-skel--thumb"></span><span class="hz-skel hz-skel--line"></span><span class="hz-skel hz-skel--line-sm"></span></div>
        <div class="pf-skel-row"><span class="hz-skel hz-skel--thumb"></span><span class="hz-skel hz-skel--line"></span><span class="hz-skel hz-skel--line-sm"></span></div>
      </div>
    </div>
    <span class="sr-only" role="status">טוען תיק…</span>
  `;

  const dataSource = window.NaviPortfolioDataSource;
  const viewModel = window.NaviPortfolioViewModel;
  const CONTENT_READY_TIMEOUT_MS = 2500;
  let contentReadyTimer = null;

  if (!viewModel || !dataSource) {
    // Under Astro ClientRouter, the sibling helper scripts (view-model.js /
    // portfolio-data-source.js) are re-injected ASYNC on a soft navigation, so on
    // the first soft-nav to /portfolio this orchestrator can execute before they
    // define window.NaviPortfolio*. Poll briefly for them (they land within a few
    // ms) instead of painting the "missing" error. ~1.5s ceiling, then give up.
    if ((attempt || 0) < 50) {
      setTimeout(() => init((attempt || 0) + 1), 30);
      return;
    }
    // Silent fallback: never paint an internal module name to the user. Leave the
    // existing placeholder in place and log for devs only.
    console.warn("[portfolio] NaviPortfolioViewModel never loaded; giving up after poll ceiling");
    return;
  }

  const state = {
    model: null,     // loaded only so the shell can detect signed-out / error
    authGate: false,
    error: null,
    contentError: null,
    // The shell paints a loading skeleton until the Preact cards island fires
    // `navi:portfolio-content-ready`. Only then does it clear to empty and let
    // the islands own the content — this closes the empty-frame gap between the
    // shell dropping its skeleton and the islands' first paint.
    contentReady: false,
    lastAuthUserId: null,
  };

  function clearContentReadyTimer() {
    if (contentReadyTimer) {
      window.clearTimeout(contentReadyTimer);
      contentReadyTimer = null;
    }
  }

  function buildContentTimeoutError() {
    const error = new Error("Portfolio cards did not signal readiness.");
    error.code = "portfolio_content_ready_timeout";
    error.status = null;
    return error;
  }

  function scheduleContentReadyWatch() {
    clearContentReadyTimer();
    if (!state.model || state.contentReady || window.__pfCardsReady || state.authGate || state.error || state.contentError) {
      return;
    }
    contentReadyTimer = window.setTimeout(() => {
      if (state.contentReady || window.__pfCardsReady || state.authGate || state.error || state.contentError) return;
      const error = buildContentTimeoutError();
      console.warn("[portfolio] content island did not become ready", error);
      state.contentError = error;
      paint();
    }, CONTENT_READY_TIMEOUT_MS);
  }

  function getAuthState() {
    return window.NaviAuthSession?.getState?.() || null;
  }

  function isAuthPending(auth) {
    return auth?.enabled === true && (!auth.initialized || auth.loading);
  }

  function isSignedOut(auth) {
    return auth?.enabled === true && auth.initialized === true && auth.authenticated !== true;
  }

  function refreshPortfolioRecord() {
    dataSource?.invalidate?.();
    state.contentError = null;
    return loadPortfolioRecord().catch(() => {
      // On refresh-failure we keep the previous content visible
      // rather than reverting to fixture; better stale than wrong.
    });
  }

  function renderAuthGate() {
    const symbol = window.HZCurrency?.symbolHtml?.() || '<span class="hz-vshekel-symbol" aria-hidden="true"><span class="hz-vshekel-fallback">V₪</span></span>';
    mount.innerHTML = `
      <section class="pf-auth-gate" data-portfolio-auth-gate>
        <div class="pf-auth-gate__mark" aria-hidden="true">${symbol}</div>
        <h2 class="pf-auth-gate__title">צריך להתחבר כדי לראות את התיק</h2>
        <p class="pf-auth-gate__body">התיק, היתרה והפוזיציות נטענים מהחשבון האמיתי שלך.</p>
        <div class="pf-auth-gate__actions">
          <button class="pf-auth-gate__button pf-auth-gate__button--primary" type="button" data-overlay-open="login">התחברות</button>
          <button class="pf-auth-gate__button pf-auth-gate__button--secondary" type="button" data-overlay-open="signup">הרשמה</button>
        </div>
      </section>
    `;
  }

  function renderBackendError(error) {
    const message = error?.code === "portfolio_content_ready_timeout" ||
      error?.code === "portfolio_runtime_unavailable" ||
      error?.code === "portfolio_content_error"
      ? "התיק נטען מהשרת, אבל לא הצלחנו להציג אותו בדפדפן. נסה לרענן בעוד רגע."
      : error?.status === 401
      ? "הסשן פג. התחבר שוב כדי לראות את התיק."
      : "לא הצלחנו לטעון את התיק מהשרת. נסה לרענן בעוד רגע.";

    mount.innerHTML = `
      <section class="pf-auth-gate" data-portfolio-backend-error>
        <div class="pf-auth-gate__mark" aria-hidden="true">!</div>
        <h2 class="pf-auth-gate__title">התיק לא נטען</h2>
        <p class="pf-auth-gate__body">${message}</p>
        <div class="pf-auth-gate__actions">
          <button class="pf-auth-gate__button pf-auth-gate__button--primary" type="button" data-portfolio-retry>נסה שוב</button>
          ${error?.status === 401 ? '<button class="pf-auth-gate__button pf-auth-gate__button--secondary" type="button" data-overlay-open="login">התחברות</button>' : ''}
        </div>
      </section>
    `;
  }

  function paint() {
    if (state.authGate) {
      renderAuthGate();
      return;
    }

    if (state.error) {
      renderBackendError(state.error);
      return;
    }

    if (state.contentError) {
      renderBackendError(state.contentError);
      return;
    }

    // Hold the loading skeleton until the cards island signals it's painting — via the
    // `navi:portfolio-content-ready` event OR the durable `window.__pfCardsReady` flag the
    // island sets when painted. The flag is the race-proofing: on soft-nav re-entry the
    // island can paint+dispatch BEFORE this script re-binds its listener, so the event is
    // missed; the flag lets paint() see "already painted" synchronously and clear anyway
    // (otherwise the skeleton stuck under the real cards — the re-entry "loading" bug).
    if (!state.contentReady && !window.__pfCardsReady) {
      mount.innerHTML = LOADING_SKELETON_HTML;
      return;
    }
    state.contentReady = true; // converge state once the island is known painted
    state.contentError = null;
    clearContentReadyTimer();

    // Cards + depth islands own the content as siblings; this container is empty.
    mount.innerHTML = "";
  }

  mount.addEventListener("click", (event) => {
    const retryBtn = event.target.closest("[data-portfolio-retry]");
    if (retryBtn) {
      retryBtn.setAttribute("disabled", "disabled");
      dataSource?.invalidate?.();
      state.error = null;
      state.contentError = null;
      state.contentReady = false;
      paint();
      loadPortfolioRecord().catch((error) => {
        state.error = error || dataSource?.getLastError?.() || null;
        paint();
      });
    }
  });

  async function loadPortfolioRecord() {
    const auth = getAuthState();

    if (isAuthPending(auth)) {
      state.authGate = false;
      state.error = null;
      paint();
      return;
    }

    if (isSignedOut(auth)) {
      dataSource?.invalidate?.();
      state.authGate = true;
      state.error = null;
      state.model = null;
      state.contentReady = false;
      state.contentError = null;
      paint();
      return;
    }

    if (!dataSource?.readPortfolioRecord) {
      // No data source means no data — render the honest error state
      // instead of painting fixture content. Fake positions must never
      // reach a real page.
      state.model = null;
      state.authGate = false;
      state.error = new Error("Portfolio data source is unavailable.");
      state.contentError = null;
      paint();
      return;
    }

    const record = await dataSource.readPortfolioRecord();

    if (!record) {
      const error = dataSource?.getLastError?.() || null;
      if (error?.status === 401) {
        window.NaviAuthSession?.handleUnauthorized?.(error.code || "unauthorized");
        state.authGate = true;
        state.error = null;
        state.contentReady = false;
        state.contentError = null;
      } else {
        state.authGate = false;
        state.error = error || new Error("Portfolio backend record is unavailable.");
        state.contentError = null;
      }
      state.model = null;
      paint();
      return;
    }

    state.model = viewModel.buildFromBackend(record.payload);
    state.authGate = false;
    state.error = null;
    state.contentError = null;
    paint();
    scheduleContentReadyWatch();
  }

  // The Preact cards island fires this once it first paints with a model. Until
  // then the shell holds the loading skeleton, so there's no empty-frame gap.
  // We also reveal the SSR page title here so it rides in WITH the content
  // instead of sitting alone above the loading skeleton.
  const pageShell = mount.closest("[data-portfolio-page]");
  window.addEventListener("navi:portfolio-content-ready", () => {
    pageShell?.classList.add("is-content-ready");
    clearContentReadyTimer();
    state.contentError = null;
    if (!state.contentReady) {
      state.contentReady = true;
      paint();
    }
  });

  window.addEventListener("navi:portfolio-content-error", (event) => {
    const detail = event.detail || {};
    if (state.contentReady || window.__pfCardsReady) return;
    const error = new Error(detail.message || "Portfolio content failed to load.");
    error.code = detail.code || "portfolio_content_error";
    error.status = detail.status || null;
    error.source = detail.source || "portfolio-content";
    console.warn("[portfolio] content island failed before first paint", detail);
    clearContentReadyTimer();
    state.contentError = error;
    paint();
  });

  // Refresh trigger: the shared shell owns the private portfolio stream and
  // dispatches `navi:portfolio-snapshot-updated`; local trade paths can also
  // dispatch it. We invalidate the cached record and re-fetch without flashing.
  window.addEventListener("navi:portfolio-snapshot-updated", () => {
    refreshPortfolioRecord();
  });

  window.addEventListener("navi:auth-state", (event) => {
    const auth = event.detail || getAuthState();
    const previousUserId = state.lastAuthUserId;
    const nextUserId = auth?.user?.userId || auth?.actor?.userId || null;
    const isCurrentUserRefresh = auth?.meta?.reason === "current_user_refresh";

    if (isAuthPending(auth)) {
      state.authGate = false;
      state.error = null;
      paint();
      return;
    }

    if (isSignedOut(auth)) {
      dataSource?.invalidate?.();
      state.lastAuthUserId = null;
      state.authGate = true;
      state.error = null;
      state.model = null;
      state.contentReady = false;
      paint();
      return;
    }

    state.authGate = false;
    state.error = null;
    state.contentError = null;
    state.lastAuthUserId = nextUserId;

    if (isCurrentUserRefresh && previousUserId && previousUserId === nextUserId) {
      paint();
      return;
    }

    dataSource?.invalidate?.();
    state.contentReady = false;
    paint();
    loadPortfolioRecord().catch((error) => {
      state.error = error || dataSource?.getLastError?.() || null;
      paint();
    });
  });

  // Initial paint: render the loading skeleton, then kick off the backend
  // fetch (so the shell can detect signed-out / error). The cards/depth islands
  // load their own copy of the model via the shared data-source cache and fire
  // navi:portfolio-content-ready when they paint.
  paint();
  loadPortfolioRecord().catch((error) => {
    // Surface the real reason instead of swallowing it — a silent catch here is what
    // hid the formatters-not-ready soft-nav crash. getLastError() covers a backend
    // failure; `error` covers a client throw inside buildFromBackend.
    console.error("Portfolio initial load failed:", error);
    state.error = dataSource?.getLastError?.() || new Error("Portfolio backend load failed.");
    state.model = null;
    state.contentError = null;
    paint();
  });
})();
