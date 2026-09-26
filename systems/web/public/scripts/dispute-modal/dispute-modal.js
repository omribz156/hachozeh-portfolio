// dispute-modal.js — resolution dispute entry (trust surface, F11).
// A compact "report a resolution problem" modal opened from the market trust
// block ([data-market-dispute]). Posts to the existing feedback inbox as a
// `report`, with the market key/title folded into the message — no new backend.
// Vanilla, body-level, soft-nav safe (delegated + re-attach). Guests → login.
(function () {
  if (window.NaviDisputeModal && window.NaviDisputeModal.__installed) return;

  // Focus trap — mirrors share-modal.js's naviTrapTab (public/scripts/share/share-modal.js)
  // exactly: Tab/Shift+Tab cycle within the panel's focusable elements instead of
  // escaping to the page behind it, the way the other five vanilla overlays do.
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

  var panel = null, scrim = null, ctx = {};
  var _trap = null, _opener = null;

  function openLogin() {
    if (window.NaviOverlays && window.NaviOverlays.open) window.NaviOverlays.open("login");
    else window.location.assign("?overlay=login");
  }

  function ensureEls() {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "hz-dispute";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "דיווח על בעיית הכרעה");
      scrim = document.createElement("div");
      scrim.className = "hz-dispute-scrim";
      scrim.addEventListener("click", close);
      panel.addEventListener("click", function (e) {
        if (e.target.closest("[data-dispute-cancel]")) { close(); return; }
        if (e.target.closest("[data-dispute-submit]")) { submit(); return; }
        if (e.target.closest("[data-dispute-done]")) { close(); return; }
      });
    }
    if (!scrim.isConnected) document.body.appendChild(scrim);
    if (!panel.isConnected) document.body.appendChild(panel);
  }

  function renderForm(errorMsg) {
    var heading = ctx.title ? "דיווח על בעיה · " + esc(ctx.title) : "דיווח על בעיה";
    panel.innerHTML =
      '<div class="hz-dispute__title">' + heading + "</div>" +
      '<textarea class="hz-dispute__textarea" data-dispute-text rows="1" placeholder="מה נראה לא נכון?"></textarea>' +
      (errorMsg ? '<div class="hz-dispute__error">' + esc(errorMsg) + "</div>" : "") +
      '<div class="hz-dispute__actions">' +
        '<button type="button" class="hz-dispute__btn" data-dispute-cancel>ביטול</button>' +
        '<button type="button" class="hz-dispute__btn hz-dispute__btn--primary" data-dispute-submit>שליחה</button>' +
      "</div>";
    var ta = panel.querySelector("[data-dispute-text]");
    if (ta) {
      // single line that grows with content (capped), instead of a fixed box
      var grow = function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 240) + "px"; };
      ta.addEventListener("input", grow);
      grow();
      ta.focus();
    }
  }

  function renderSuccess() {
    panel.innerHTML =
      '<div class="hz-dispute__ok">' +
        '<div class="hz-dispute__ok-title">הדיווח התקבל</div>' +
        '<div class="hz-dispute__ok-sub">נעבור על ההכרעה הזו. אם נמצא שמשהו לא תקין, נעדכן.</div>' +
      "</div>" +
      '<div class="hz-dispute__actions">' +
        '<button type="button" class="hz-dispute__btn hz-dispute__btn--primary" data-dispute-done>סגירה</button>' +
      "</div>";
  }

  function open(market) {
    ctx = market || {};
    ensureEls();
    renderForm();
    _opener = document.activeElement;
    scrim.classList.add("is-open");
    panel.classList.add("is-open");
    if (_trap) panel.removeEventListener("keydown", _trap);
    _trap = naviTrapTab(panel);
    panel.addEventListener("keydown", _trap);
  }
  function close() {
    if (_trap && panel) { panel.removeEventListener("keydown", _trap); _trap = null; }
    if (panel) panel.classList.remove("is-open");
    if (scrim) scrim.classList.remove("is-open");
    if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
  }

  async function submit() {
    var ta = panel.querySelector("[data-dispute-text]");
    var text = (ta && ta.value || "").trim();
    if (text.length < 4) { renderForm("נא לתאר את הבעיה בכמה מילים."); return; }
    var btn = panel.querySelector("[data-dispute-submit]");
    if (btn) { btn.setAttribute("disabled", ""); btn.textContent = "שולח…"; }
    try {
      var res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "report",
          title: "בעיית הכרעה · " + (ctx.title || ctx.key || ""),
          message: text + "\n\n— שוק: " + (ctx.key || "(לא ידוע)"),
        }),
      });
      if (res.status === 401) { close(); openLogin(); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      renderSuccess();
    } catch (e) {
      renderForm("לא הצלחנו לשלוח כרגע. נסו שוב בעוד רגע.");
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel && panel.classList.contains("is-open")) close();
  });

  // Delegated open — survives soft-nav (button node gets swapped, document persists).
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-market-dispute]");
    if (!btn) return;
    if (document.documentElement.dataset.authHint !== "user") { openLogin(); return; }
    var page = btn.closest("[data-market-key]") || document.querySelector("[data-market-key]");
    var titleEl = document.querySelector(".market-detail-page-title");
    open({
      key: page ? page.dataset.marketKey : null,
      title: titleEl ? titleEl.textContent.trim() : "",
    });
  });

  window.NaviDisputeModal = { open: open, close: close, __installed: true };
})();
