// result-overlay.js — market resolution result overlay (Milestone 2).
// The payoff moment: win = quietly celebratory, loss = calm + honest, both
// carrying the track-record DELTA (accuracy before→after + streak). Vanilla,
// body-level, soft-nav safe. Eventually opened by the resolution notification CTA;
// for now also openable via ?resultDemo=win|loss so the design is viewable.
//   window.NaviResultOverlay.open({ outcome:'win'|'loss', amount, market, verdict,
//                                   accFrom, accTo, streak, marketHref, nextHref })
(function () {
  if (window.NaviResultOverlay && window.NaviResultOverlay.__installed) return;

  function naviTrapTab(panel) {
    return function (e) {
      if (e.key !== 'Tab') return;
      var sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      var f = Array.prototype.filter.call(panel.querySelectorAll(sel), function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey) { if (document.activeElement === first || !panel.contains(document.activeElement)) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last || !panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); } }
    };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function currencyHtml(s) {
    return esc(s).replace(
      /V[\u200e\u200f]?\u20aa/g,
      window.HZCurrency?.symbolHtml?.() || "V₪",
    );
  }

  var panel = null, scrim = null, isOpen = false;
  var _trap = null;
  var _opener = null;
  var _scrollHeld = false; // this instance's own lock/unlock idempotency flag
  // Claim context for the current win overlay (set in open()).
  var _claimMarketKey = null, _claimId = null, _claimDemo = false;
  // Share context for the current win: seeded from open(), enriched by the
  // claim POST response (which carries the market title + winning outcome).
  var _share = null;

  // ── Claim wiring ────────────────────────────────────────────────────────────
  // Same-origin by default (Caddy proxies /api); fall back to the configured base.
  function apiBase() {
    return (window.NaviAuthSession && window.NaviAuthSession.getBackendBaseUrl && window.NaviAuthSession.getBackendBaseUrl())
      || window.NAVI_BACKEND_BASE_URL || "";
  }
  function apiFetch(path, init) {
    return window.fetch(apiBase() + path, Object.assign({ credentials: "include" }, init || {}))
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (p) {
          if (!r.ok) {
            var e = new Error((p && p.error && p.error.message) || "request_failed");
            e.code = (p && p.error && p.error.code) || "internal_error";
            e.status = r.status;
            throw e;
          }
          return p;
        });
      });
  }
  // The win notification carries marketKey, not the claim id — resolve the claim
  // for this market from the claims list (matches the portfolio's own lookup).
  // Prefer a pending claim (the CTA needs one); fall back to a claimed one so the
  // winning-outcome label still resolves after the payout was collected.
  function resolveClaim(marketKey) {
    if (!marketKey) return Promise.resolve(null);
    return apiFetch("/api/portfolio/claims", { method: "GET" }).then(function (data) {
      var list = (data && data.claims) || [];
      var pending = null, claimed = null;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].marketKey) !== String(marketKey)) continue;
        if (list[i].status === "pending") { if (!pending) pending = list[i]; }
        else if (list[i].status === "claimed") { if (!claimed) claimed = list[i]; }
      }
      return pending || claimed || null;
    });
  }

  // ── Share wiring ────────────────────────────────────────────────────────────
  // Same artifact as the portfolio claim flow (share/claims/win) so the win
  // reveal and the claims list offer the identical share.
  function claimShareQuery(d) {
    var q = new URLSearchParams();
    // Persisted-truth key first (identity + entry odds render from the backend
    // snapshot once consent is stamped); plain params are the pre-consent
    // fallback — deletable once consent stamping is verified in prod.
    if (_claimId) q.set("claim", String(_claimId));
    if (d.marketKey) q.set("market", String(d.marketKey));
    if (d.title) q.set("title", String(d.title).slice(0, 140));
    if (d.outcome) q.set("outcome", String(d.outcome).slice(0, 60));
    if (d.amountNum != null && isFinite(d.amountNum)) q.set("amount", String(d.amountNum));
    if (d.amountLabel) q.set("amountLabel", String(d.amountLabel).slice(0, 24));
    return q.toString();
  }

  // Act-of-share = consent: the first real share action stamps the claim as
  // publicly readable. Fire-and-forget, once per opened modal.
  function buildShareConsent() {
    var claimId = _claimId;
    if (!claimId || _claimDemo) return null;
    var sent = false;
    return function () {
      if (sent) return;
      sent = true;
      apiFetch("/api/portfolio/claims/" + encodeURIComponent(claimId) + "/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(function () {});
    };
  }

  function openShare() {
    if (!_share || !window.HachozehShare || !window.HachozehShare.open) return;
    var d = _share;
    var query = claimShareQuery(d);
    var onAction = buildShareConsent();
    var text = d.title
      ? 'קראתי את זה נכון: "' + d.title + '". ' + (d.amountLabel ? d.amountLabel + " בהחוזה." : "בהחוזה.")
      : "קראתי את זה נכון. בהחוזה.";
    // The result overlay defensively closes the share modal on open, so leave
    // first and hand off — never stack the two.
    close();
    window.setTimeout(function () {
      window.HachozehShare.open({
        kind: "claim",
        title: "קריאה נכונה בהחוזה",
        text: text,
        url: "/share/claims/win" + (query ? "?" + query : ""),
        image: "/share/claims/win.png" + (query ? "?" + query : ""),
        onAction: onAction,
      });
    }, 80);
  }

  function markAlreadyClaimed() {
    if (!panel) return;
    var btn = panel.querySelector("[data-result-claim]");
    if (!btn) return;
    btn.removeAttribute("data-result-claim");
    btn.textContent = "כבר נאסף";
    btn.classList.add("is-claimed");
    btn.disabled = true;
  }

  function setOutcomeLabel(label) {
    if (!panel || !label) return;
    var el = panel.querySelector("[data-result-outcome]");
    if (!el) return;
    el.textContent = "התוצאה: " + label;
    el.classList.add("is-shown");
  }

  // One claim lookup on open: fill the winning-outcome label (works whether the
  // payout is pending or already collected) AND reconcile the claim CTA (if we
  // optimistically showed "אסוף עכשיו" but no pending claim exists, mark claimed).
  function hydrateFromClaim(opts) {
    if (!opts || opts.outcome !== "win" || opts.claimDemo === true || !_claimMarketKey) return;
    resolveClaim(_claimMarketKey).then(function (match) {
      if (!isOpen) return;
      // Fallback only: the notification usually carries outcomeLabel (painted in
      // render). Fill from the claim just for older rows where the slot is empty.
      var slot = panel && panel.querySelector("[data-result-outcome]");
      if (match && match.outcomeLabel && slot && !slot.classList.contains("is-shown")) {
        setOutcomeLabel(match.outcomeLabel);
      }
      if (opts.claimed !== true && (!match || match.status !== "pending")) markAlreadyClaimed();
    }).catch(function () {
      // Keep the optimistic CTA if the preflight fails; the POST path still guards.
    });
  }

  // Body swap on ClientRouter soft-nav detaches body-appended nodes; re-attach
  // the same nodes (listeners survive) before showing. (Same trap as the bell.)
  function ensureEls() {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "hz-result";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "תוצאת הכרעה");
      panel.setAttribute("tabindex", "-1");
      scrim = document.createElement("div");
      scrim.className = "hz-result-scrim";
      scrim.addEventListener("click", close);
      // Action buttons: if the destination is the page we're already on, just
      // close (no redundant same-URL navigation / "refresh" feel). Otherwise
      // close and let the link soft-nav. Mirrors the shell's same-link guard.
      panel.addEventListener("click", function (e) {
        var claimBtn = e.target.closest("[data-result-claim]");
        if (claimBtn) { e.preventDefault(); doClaim(claimBtn); return; }
        var shareBtn = e.target.closest("[data-result-share]");
        if (shareBtn) { e.preventDefault(); openShare(); return; }
        var a = e.target.closest("a.hz-result__btn");
        if (!a) return;
        var dest;
        try { dest = new URL(a.href, window.location.href); } catch { close(); return; }
        if (dest.pathname === window.location.pathname) { e.preventDefault(); close(); return; }
        close();
      });
    }
    if (!scrim.isConnected) document.body.appendChild(scrim);
    if (!panel.isConnected) document.body.appendChild(panel);
  }

  function deltaLine(opts) {
    if (opts.accFrom == null || opts.accTo == null) return "";
    var up = Number(opts.accTo) >= Number(opts.accFrom);
    var cls = up ? "up" : "down";
    var arrow = up ? "↑" : "↓";
    var html =
      'דיוק <b>' + esc(opts.accFrom) + '%</b> ' +
      '<span class="' + cls + '">' + arrow + " " + esc(opts.accTo) + '%</span>';
    if (opts.streak != null) {
      html += ' <span class="hz-result__delta-sep">·</span> רצף <b>' + esc(opts.streak) + "</b>";
    }
    return '<div class="hz-result__delta">' + html + "</div>";
  }

  // Pull the bare number out of a money string ("V₪ 2,500" → 2500) so the win
  // headline can count up to it. Returns null if there's nothing to count.
  function parseAmountNumber(s) {
    var n = parseFloat(String(s == null ? "" : s).replace(/[^\d.]/g, ""));
    return isFinite(n) ? n : null;
  }

  function render(opts) {
    var win = opts.outcome === "win";
    var claimed = opts.claimed === true;
    panel.className = "hz-result is-open " + (win ? "hz-result--win" : "hz-result--loss");
    var cap = win ? "צדקת" : "השוק הוכרע";
    var headline;
    if (win) {
      // Split the payout into symbol + number so the number can animate up from
      // 0 (the symbol must stay put — countUp writes textContent, which would
      // otherwise wipe the currency glyph). Falls back to the plain money string
      // if there's no parseable amount.
      var num = parseAmountNumber(opts.amount);
      if (num != null) {
        var symHtml = (window.HZCurrency && window.HZCurrency.symbolHtml && window.HZCurrency.symbolHtml()) || "V₪";
        headline =
          '<span class="hz-result__amount-sym">' + symHtml + "</span> " +
          '<span class="hz-result__amount-num" data-result-amount data-amount-target="' + num + '">0</span>';
      } else {
        headline = currencyHtml(opts.amount || "");
      }
    } else {
      headline = esc(opts.market || "השוק הוכרע");
    }
    var sub = win
      ? (opts.market ? '<div class="hz-result__market">' + esc(opts.market) + "</div>" : "")
      : (opts.verdict ? '<div class="hz-result__market">' + esc(opts.verdict) + "</div>" : "");
    var href = esc(opts.marketHref || "#");
    var nextHref = esc(opts.nextHref || "/");
    // Win → the primary action CLAIMS the payout (wired in the click handler).
    // Loss → keep the "next market" nudge.
    var actions = win
      ? '<a class="hz-result__btn" href="' + href + '">לשוק</a>' +
        (claimed
          ? '<button class="hz-result__btn hz-result__btn--primary is-claimed" type="button" disabled>כבר נאסף</button>'
          : '<button class="hz-result__btn hz-result__btn--primary" type="button" data-result-claim>אסוף עכשיו</button>')
      : '<a class="hz-result__btn" href="' + href + '">לשוק</a>' +
        '<a class="hz-result__btn hz-result__btn--primary" href="' + nextHref + '">שוק הבא</a>';
    // Wins get a quiet share footer under the actions — the reveal is the peak,
    // and the artifact (share/claims/win) already exists one flow away.
    var shareRow = win
      ? '<button class="hz-result__share" type="button" data-result-share>' +
        '<span class="material-symbols-outlined" aria-hidden="true">ios_share</span>' +
        '<span>שתף קריאה נכונה</span></button>'
      : "";
    // Winning outcome — which side resolved. Painted SYNCHRONOUSLY from the
    // notification (opts.outcomeLabel) so it pops with the card. Older
    // notifications lack it → empty slot, filled by hydrateFromClaim as a fallback.
    var outcomeRow = "";
    if (win) {
      outcomeRow = opts.outcomeLabel
        ? '<div class="hz-result__outcome is-shown" data-result-outcome>התוצאה: ' + esc(opts.outcomeLabel) + "</div>"
        : '<div class="hz-result__outcome" data-result-outcome></div>';
    }
    panel.innerHTML =
      '<div class="hz-result__cap">' + esc(cap) + "</div>" +
      '<div class="hz-result__headline">' + headline + "</div>" +
      sub +
      outcomeRow +
      deltaLine(opts) +
      '<div class="hz-result__actions">' + actions + "</div>" +
      shareRow;
  }

  // Never stack two overlays — dismiss the shell's other surfaces first.
  function closeOtherOverlays() {
    document.querySelectorAll("[data-hamburger-menu].is-open, [data-hamburger-menu]")
      .forEach(function (n) { n.classList.remove("is-open"); });
    document.querySelectorAll("[data-hamburger-trigger]")
      .forEach(function (t) { t.setAttribute("aria-expanded", "false"); });
    try {
      if (window.NaviOverlays && window.NaviOverlays.close) window.NaviOverlays.close();
    } catch {}
    try {
      if (window.HachozehShare && window.HachozehShare.close) window.HachozehShare.close();
    } catch {}
  }

  function removeFx() {
    var fxs = document.querySelectorAll(".hz-result-fx");
    for (var i = 0; i < fxs.length; i++) fxs[i].remove();
  }

  // Claim the win's payout into the wallet. Resolves the claim id from the market
  // (the notification only carries marketKey), POSTs the claim, then nudges the
  // wallet + portfolio to refresh. Demo mode (?resultDemo) just plays the state.
  function doClaim(btn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.textContent = "אוסף…";
    var done = function (payload) {
      btn.textContent = "כבר נאסף";
      btn.classList.add("is-claimed");
      btn.disabled = true;
      window.dispatchEvent(new CustomEvent("navi:portfolio-claim-settled", {
        detail: { claimId: _claimId, marketKey: _claimMarketKey }
      }));
      window.dispatchEvent(new CustomEvent("wallet:credited", { detail: { reason: "claim" } }));
      window.dispatchEvent(new CustomEvent("navi:portfolio-snapshot-updated", { detail: { reason: "claim" } }));
      // Enrich the share with the claim's own truth (title/outcome/proceeds) and
      // surface it — same behavior as claiming from the portfolio claims list.
      var claim = payload && payload.claim;
      if (claim && _share) {
        if (claim.marketTitle) _share.title = claim.marketTitle;
        if (claim.outcomeLabel) _share.outcome = claim.outcomeLabel;
        if (claim.proceeds != null && isFinite(Number(claim.proceeds))) _share.amountNum = Number(claim.proceeds);
      }
      openShare();
    };
    var fail = function (err) {
      var alreadyClaimed = err && (err.code === "already_claimed" || err.code === "claim_already_claimed");
      if (alreadyClaimed) {
        btn.textContent = "כבר נאסף";
        btn.classList.add("is-claimed");
        btn.disabled = true;
        window.dispatchEvent(new CustomEvent("navi:portfolio-claim-settled", {
          detail: { claimId: _claimId, marketKey: _claimMarketKey }
        }));
        return;
      }
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.textContent = "נסו שוב";
    };
    if (_claimDemo) { window.setTimeout(done, 600); return; }
    var idP = _claimId
      ? Promise.resolve(_claimId)
      : resolveClaim(_claimMarketKey).then(function (m) { return m && m.status === "pending" ? m.claimId : null; });
    idP.then(function (claimId) {
      if (!claimId) { var e = new Error("no_claim"); e.code = "already_claimed"; throw e; }
      _claimId = claimId;
      return apiFetch("/api/portfolio/claims/" + encodeURIComponent(claimId) + "/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    }).then(done).catch(fail);
  }

  // The win payoff: count the headline up from 0, then a confetti+spark burst
  // around the panel — the SAME FX vocabulary as the trade-commit moment, so a
  // win feels like the natural sequel to the bet. Reduced-motion: number snaps,
  // no confetti.
  function celebrateWin() {
    var FX = window.HZStreakFX;
    var numEl = panel.querySelector("[data-result-amount]");
    if (numEl) {
      var target = Number(numEl.getAttribute("data-amount-target")) || 0;
      if (FX && FX.countUp) FX.countUp(numEl, 0, target, 950);
      else numEl.textContent = Math.round(target).toLocaleString("en-US");
    }
    if (!FX || !FX.engine || (FX.prefersReduced && FX.prefersReduced())) return;
    var cv = document.createElement("canvas");
    cv.className = "hz-result-fx";
    document.body.appendChild(cv);
    var fx = FX.engine(cv);
    var COL = FX.COLORS || {};
    var pal = [COL.mint, COL.amber, COL.amberStrong, COL.white, COL.info].filter(Boolean);
    var r = panel.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height * 0.32, { count: 54, speed: 5, palette: pal });
    var y = r.top + r.height * 0.5;
    setTimeout(function () {
      fx.confetti(r.left + 8, y, { count: 40, power: 1.05, angle: -Math.PI * 0.72, spread: 0.9, hvel: 1.1, palette: pal });
      fx.confetti(r.right - 8, y, { count: 40, power: 1.05, angle: -Math.PI * 0.28, spread: 0.9, hvel: 1.1, palette: pal });
    }, 120);
    setTimeout(removeFx, 2600);
  }

  function open(opts) {
    opts = opts || {};
    closeOtherOverlays();
    ensureEls();
    _opener = document.activeElement;
    _claimMarketKey = opts.marketKey || null;
    _claimId = opts.claimId || null;
    _claimDemo = opts.claimDemo === true;
    _share = opts.outcome === "win"
      ? {
          marketKey: _claimMarketKey,
          title: opts.market || "",
          outcome: opts.winningOutcome || "",
          amountNum: parseAmountNumber(opts.amount),
          amountLabel: opts.amount || "",
        }
      : null;
    render(opts);
    isOpen = true;
    scrim.classList.add("is-open");
    panel.classList.add("is-open");
    if (!_scrollHeld) { _scrollHeld = true; window.NaviScrollLock?.lock?.(); }
    hydrateFromClaim(opts);
    if (_trap) panel.removeEventListener("keydown", _trap);
    _trap = naviTrapTab(panel);
    panel.addEventListener("keydown", _trap);
    // move focus to the primary action (claim button for wins), or the panel itself
    var firstBtn = panel.querySelector(".hz-result__btn--primary, a.hz-result__btn");
    if (firstBtn) firstBtn.focus(); else panel.focus();
    if (opts.outcome === "win") celebrateWin();
  }
  function close() {
    isOpen = false;
    removeFx();
    if (_trap && panel) { panel.removeEventListener("keydown", _trap); _trap = null; }
    if (panel) panel.classList.remove("is-open");
    if (scrim) scrim.classList.remove("is-open");
    if (_scrollHeld) { _scrollHeld = false; window.NaviScrollLock?.unlock?.(); }
    if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
  }

  document.addEventListener("keydown", function (e) {
    if (isOpen && e.key === "Escape") close();
  });

  // Demo trigger — ?resultDemo=win|loss opens with mock data, then strips the
  // param so it doesn't re-fire on every soft-nav. Delete once the notification
  // CTA opens this with real resolution data.
  function maybeDemo() {
    var url = new URL(window.location.href);
    var demo = url.searchParams.get("resultDemo");
    if (demo !== "win" && demo !== "loss") return;
    url.searchParams.delete("resultDemo");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (demo === "win") {
      open({
        outcome: "win", amount: "V₪ 2,500", market: "ישראל נגד קוסובו",
        accFrom: 64, accTo: 66, streak: 5, marketHref: "#", nextHref: "/",
        claimDemo: true, claimed: true
      });
    } else {
      open({
        outcome: "loss", market: "הפועל מול מכבי", verdict: "הקריאה שלך לא צדקה הפעם",
        accFrom: 66, accTo: 64, streak: 0, marketHref: "#", nextHref: "/"
      });
    }
  }

  window.NaviResultOverlay = { open: open, close: close, __installed: true };
  maybeDemo();
  document.addEventListener("astro:page-load", maybeDemo);
})();
