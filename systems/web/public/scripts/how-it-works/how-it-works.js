/* ============================================================
   How It Works — init island (vanilla, global shell scope)
   Wires the ported HZHowItWorks walkthrough into systems/web:
     • CTA: any [data-hiw-open] click opens it (guest nav link + hamburger).
     • Handoff: the last step ("התחילו לחזות") opens the EXISTING signup
       overlay via the window.NaviOverlays seam (page-overlay.js). Read lazily
       at click time, so script load order vs. the auth module doesn't matter.
     • Trigger 2: a brand-new signup arms localStorage 'navi_hiw_pending' at
       verify-success (page-overlay.js); we consume it once here on the next
       load and auto-open the walkthrough, then mark it seen so it never re-pops.

   NON-BLOCKING by contract: the component never scroll-locks / inerts / blurs
   the page — the live surface keeps ticking behind it.
   ============================================================ */
(function () {
  "use strict";
  if (!window.HZHowItWorks || typeof window.HZHowItWorks.create !== "function") return;

  var SEEN_KEY = "navi_hiw_seen";
  var PENDING_KEY = "navi_hiw_pending";

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (_) {}
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(key); } catch (_) {}
  }

  var hiw = window.HZHowItWorks.create({
    // Last step hands off to the platform's existing signup overlay.
    onSignup: function () {
      var overlays = window.NaviOverlays;
      if (overlays && typeof overlays.open === "function") {
        overlays.open("signup");
      } else {
        // Fallback if the auth module hasn't attached the seam: drive the URL
        // state the overlay system reads on load.
        var url = new URL(window.location.href);
        url.searchParams.set("overlay", "signup");
        window.location.href = url.pathname + url.search;
      }
    },
  });

  // Reusable handle (daily-streak / shell may want to trigger it too).
  window.NaviHowItWorks = hiw;

  // CTA delegation — one listener for every [data-hiw-open] trigger anywhere
  // (guest nav link, guest hamburger entry), present now or added later.
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-hiw-open]");
    if (!trigger) return;
    event.preventDefault();
    // If the trigger lived inside an open shell popover (the mobile hamburger),
    // close it so it doesn't linger behind the non-blocking walkthrough.
    document
      .querySelectorAll("[data-hamburger-menu].is-open, [data-cat-more].is-open")
      .forEach(function (el) { el.classList.remove("is-open"); });
    hiw.open();
  });

  // Trigger 2 — one-shot auto-open for a brand-new signup. The signup-verify
  // success path armed PENDING_KEY; consume it once, then mark seen. Gated on a
  // persisted flag (not a clock), so it shows exactly once and never re-pops on
  // in-session navigation.
  if (lsGet(PENDING_KEY) && !lsGet(SEEN_KEY)) {
    lsDel(PENDING_KEY);
    lsSet(SEEN_KEY, "1");
    // Defer a tick so first paint + the auth-success overlay settle first.
    setTimeout(function () { hiw.open(); }, 400);
  }
})();
