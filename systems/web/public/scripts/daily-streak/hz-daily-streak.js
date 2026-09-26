/* ============================================================
   hz-daily-streak.js  —  Daily Streak claim overlay (Direction B)
   Self-mounting, data-driven. Depends on window.HZStreakFX
   (load hz-streak-fx.js first) and hz-daily-streak.css.

   USAGE
   -----
   const streak = HZDailyStreak.create({
     walletValueEl: '#wallet-balance',  // optional: element/selector to count-up
     onClaim:     async (state) => {},  // optional: POST the claim to the API
     onSecondary: (state) => {},        // optional: "discover markets" click
     onClose:     (state) => {},        // optional
   });
   streak.open(state);                  // see normalized `state` shape in README

   The overlay credits the wallet (count-up) AFTER the claim resolves and
   always emits `window` event 'wallet:credited' {detail:{amount, source}}
   so the shell header can run its own celebration independently.
   ============================================================ */
(function () {
  "use strict";

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

  var DEFAULT_LADDER = [100, 150, 200, 250, 300, 350, 400]; // looped 7-day ladder
  var INFO_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v4M8 4.5v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function streakSymbolHtml() {
    return window.HZCurrency?.symbolHtml?.({ decorative: true }) || '<span class="hz-vshekel-symbol" aria-hidden="true"><span class="hz-vshekel-fallback">V₪</span></span>';
  }
  function streakMoneyHtml(v, className, sign) {
    var value = String(v);
    var label = "V₪ " + (sign || "") + value;
    return '<bdi class="' + className + ' hz-money" dir="ltr" aria-label="' + label + '">' +
      streakSymbolHtml() + '<span>' + (sign || "") + value + '</span></bdi>';
  }
  function amt(v) { return streakMoneyHtml(v, "hz-amt", "+"); }
  function plainAmt(v) { return streakMoneyHtml(v, "hz-amt", ""); }
  function rewardText(v) { return streakMoneyHtml(v, "hz-reward-text", ""); }

  /* ---- copy defaults (Hebrew). Numbers are templated from `state`.
     Override any field via state.copy. ---- */
  function defaultCopy(s) {
    var d = s.day, ladder = s.ladder, next = s.nextReward;
    switch (s.kind) {
      case "position": return {
        eyebrow: "כניסה יומית", medLbl: "רצף · יום",
        headline: "", sub: "", callout: null, seqLabel: "סבב נוכחי",
        footLabel: "מחר · יום " + (d + 1), footVal: amt(next), footNote: "כל עוד יש פוזיציה פתוחה", footMuted: false,
        cta: "אסוף", secondary: null
      };
      case "noposition": return {
        eyebrow: "כניסה יומית", medLbl: "הרצף בהמתנה",
        headline: "", sub: '<span class="hz-stub__sub-reward">קיבלת ' + rewardText(s.reward) + '!</span><span class="hz-stub__sub-line">הרצף שלך נשמר | כדי להתקדם מחר, צריך פוזיציה פתוחה</span>',
        callout: '<span class="hz-callout__main">עם פוזיציה פתוחה יכולת לקבל ' + plainAmt(next) + '</span><span class="hz-callout__sub">פתח פוזיציה עכשיו כדי להתחיל את הרצף הרציני</span>', seqLabel: "הרצף שלך",
        footLabel: "", footVal: "", footNote: "", footMuted: true, hideFoot: true,
        cta: "אסוף " + plainAmt(s.reward), secondary: "לשווקים →"
      };
      case "complete": return {
        eyebrow: "כניסה יומית", medLbl: "שבוע מלא",
        headline: "", sub: "", callout: null, seqLabel: "סבב הושלם",
        footLabel: "הרצף מתחיל מחדש מחר", footVal: "יום 1 · " + amt(ladder[0]), footNote: "↻ מתחילים סבב חדש", footMuted: false,
        cta: "אסוף", secondary: null
      };
      case "emergency": return {
        eyebrow: "מענק חירום", medLbl: "רשת ביטחון",
        headline: "אל דאגה — קח אוויר.", sub: "היתרה שלך הגיעה ל־0. הנה " + plainAmt(s.reward) + " כדי לחזור לזירה.",
        callout: null, seqLabel: "מענק חד־פעמי",
        footLabel: "זמינות", footVal: "פעם ביממה", footNote: "אינו חלק מהרצף היומי", footMuted: true,
        cta: "אסוף", secondary: "לגלות שווקים →"
      };
      case "claimed": return {
        eyebrow: "כניסה יומית", medLbl: "רצף · יום",
        headline: "", sub: "", callout: null, seqLabel: "סבב נוכחי",
        footLabel: "מחר · יום " + (d + 1), footVal: amt(next), footNote: "כל עוד יש פוזיציה פתוחה", footMuted: false,
        cta: "נאסף היום ✓", secondary: null
      };
    }
  }

  /* normalize + fill defaults */
  function normalize(state) {
    var s = Object.assign({}, state);
    s.ladder = s.ladder || DEFAULT_LADDER;
    if (s.kind === "complete") s.day = 7;
    if (s.reward == null && s.kind !== "emergency") s.reward = s.ladder[(s.day || 1) - 1];
    if (s.nextReward == null) {
      var ni = Math.max(0, s.day || 0); // day 0 previews ladder[0]; day 1 previews ladder[1].
      s.nextReward = s.ladder[ni % 7];
    }
    var base = defaultCopy(s);
    s.copy = Object.assign(base, state.copy || {});
    return s;
  }

  /* per-day stamp status for the 7-cell row */
  function statuses(s) {
    var a = [], i, paused = s.kind === "noposition";
    for (i = 0; i < 7; i++) {
      if (paused) a.push(i < s.day ? "done" : (i === s.day ? "paused" : "future"));
      else a.push(i < s.day - 1 ? "done" : (i === s.day - 1 ? "today" : "future"));
    }
    return a;
  }

  function render(s) {
    var c = s.copy, noladder = s.kind === "emergency", paused = s.kind === "noposition";
    var p = noladder ? 0 : s.day / 7;
    var big = noladder ? "₪" : s.day;

    var hero = '<span class="hz-stub__plus">+</span><span class="hz-stub__num">' + s.reward + '</span><span class="hz-stub__cur">' + streakSymbolHtml() + "</span>";
    var callout = c.callout ? '<div class="hz-callout">' + INFO_ICON + "<span>" + c.callout + "</span></div>" : "";

    var stub =
      '<div class="hz-stub">' +
        '<div class="hz-stub__eyebrow"><span class="hz-pip"></span>' + c.eyebrow + "</div>" +
        '<div class="hz-medallion" style="--p:' + p + '"><div class="hz-medallion__in"><div class="hz-medallion__day">' + big + '</div><div class="hz-medallion__lbl">' + c.medLbl + "</div></div></div>" +
        '<div class="hz-stub__hero">' + hero + "</div>" +
        (c.headline ? '<div class="hz-stub__head">' + c.headline + "</div>" : "") +
        (c.sub ? '<div class="hz-stub__sub">' + c.sub + "</div>" : "") +
        callout +
      "</div>";

    var body = "";
    if (!noladder) {
      var st = statuses(s), stamps = "", i;
      for (i = 0; i < 7; i++) {
        var cls = st[i];
        if (s.kind === "complete" && i === 6) cls += " hz-stamp--peak";
        var glyph = (st[i] === "done") ? "✓" : (i === 6 ? "★" : "");
        stamps += '<div class="hz-stamp hz-stamp--' + cls + '">' +
          '<span class="hz-stamp__amt">' + s.ladder[i] + '</span>' +
          '<span class="hz-stamp__glyph">' + glyph + '</span>' +
          '<span class="hz-stamp__day">' + (i + 1) + "</span></div>";
      }
      var seqNum = s.kind === "complete" ? "07" : "0" + s.day;
      body = '<div class="hz-foil__title"><span>' + c.seqLabel + '</span><span class="hz-seq hz-mono"><b>' + seqNum + "</b> / 07</span></div>" +
        '<div class="hz-stamps">' + stamps + "</div>";
    }

    var perf = '<div class="hz-perf"><span class="hz-perf__notch hz-perf__notch--s"></span><span class="hz-perf__notch hz-perf__notch--e"></span></div>';

    var foot = c.hideFoot ? "" :
      '<div class="hz-foil__foot"><div class="hz-foil__foot-l"><span class="hz-foil__foot-label">' + c.footLabel + "</span>" +
      (c.footNote ? '<span class="hz-foil__foot-note">' + c.footNote + "</span>" : "") +
      '</div><span class="hz-foil__foot-val ' + (c.footMuted ? "is-muted" : "") + '">' + c.footVal + "</span></div>";

    var claimed = s.kind === "claimed";
    var ctaAttrs = claimed ? 'disabled aria-disabled="true"' : "data-claim";
    var ctaLabel = c.cta + (claimed || s.kind === "noposition" ? "" : " " + amt(s.reward));

    var foil =
      '<div class="hz-foil' + (noladder ? " hz-foil--bare" : "") + '">' + body + foot +
        '<button class="hz-cta' + (claimed ? " is-claimed" : "") + '" ' + ctaAttrs + ">" + ctaLabel + "</button>" +
        '<p class="hz-claim-error" data-claim-error aria-live="polite" hidden></p>' +
        (c.secondary ? '<button class="hz-secondary" data-secondary>' + c.secondary + "</button>" : "") +
      "</div>";

    return '<div class="hz-ticket ' + (paused ? "is-paused" : "") + '" role="dialog" aria-modal="true" aria-label="תגמול כניסה יומית">' +
      '<button class="hz-ticket__close" data-close aria-label="סגירה">×</button>' +
      stub + perf + foil + "</div>";
  }

  /* ============================================================
     Component instance
     ============================================================ */
  function create(opts) {
    opts = opts || {};
    var FX = window.HZStreakFX;
    var scrim, slot, burstCanvas, confCanvas, state, busy = false;
    // Bumped whenever the overlay is dismissed. A claim captures the current gen;
    // its resolve/reject becomes a no-op if the gen moved on (user closed mid-claim),
    // so a slow/late claim POST can't act on a closed overlay.
    var _claimGen = 0;
    var _trap = null;
    var _opener = null;
    var _scrollHeld = false; // this instance's own lock/unlock idempotency flag

    function walletEl() {
      var w = opts.walletValueEl;
      if (!w) return null;
      return typeof w === "string" ? document.querySelector(w) : w;
    }

    function mount() {
      // ClientRouter's soft-nav swap detaches JS-appended body roots (documented
      // shell gotcha) without unmounting this instance — `scrim` stays truthy but
      // `.isConnected` goes false. Re-append the SAME root rather than rebuilding
      // (which would create a second scrim while the old one still lingers).
      if (scrim) {
        if (!scrim.isConnected) document.body.appendChild(scrim);
        if (burstCanvas && !burstCanvas.isConnected) document.body.appendChild(burstCanvas);
        if (confCanvas && !confCanvas.isConnected) document.body.appendChild(confCanvas);
        return;
      }
      burstCanvas = el("canvas", "hz-streak-fx hz-streak-fx--burst");
      confCanvas = el("canvas", "hz-streak-fx hz-streak-fx--conf");
      scrim = el("div", "hz-streak-scrim");
      scrim.setAttribute("dir", "rtl");
      scrim.hidden = true;
      slot = el("div", "hz-streak-slot");
      scrim.appendChild(slot);
      document.body.appendChild(burstCanvas);
      document.body.appendChild(scrim);
      document.body.appendChild(confCanvas);

      scrim.addEventListener("click", function (e) { if (e.target === scrim) requestClose(); });
      slot.addEventListener("click", function (e) {
        if (e.target.closest("[data-claim]")) return claim();
        if (e.target.closest("[data-secondary]")) { if (opts.onSecondary) opts.onSecondary(state); return requestClose(); }
        if (e.target.closest("[data-close]")) return requestClose();
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !scrim.hidden) requestClose(); });
    }

    function el(tag, cls) { var n = document.createElement(tag); n.className = cls; return n; }

    function open(rawState) {
      mount();
      _opener = document.activeElement;
      state = normalize(rawState);
      busy = false;
      scrim.hidden = false;
      scrim.classList.remove("is-out");
      slot.innerHTML = render(state);
      var ticket = slot.querySelector(".hz-ticket");
      ticket.classList.add("is-open", "pop");
      _trap = naviTrapTab(ticket);
      ticket.addEventListener("keydown", _trap);
      var cta = ticket.querySelector("[data-claim]");
      if (cta) cta.focus();
      if (!_scrollHeld) { _scrollHeld = true; window.NaviScrollLock?.lock?.(); }
      // "claimed" is a re-view of an already-collected reward (e.g. reopened from
      // the menu later the same day) — not a fresh grant, so no celebration burst.
      if (state.kind !== "claimed") fireworks();
    }

    function claimErrorEl() {
      return slot.querySelector("[data-claim-error]");
    }

    function showClaimError(msg) {
      var e = claimErrorEl();
      if (!e) return;
      e.textContent = msg;
      e.hidden = false;
    }

    function clearClaimError() {
      var e = claimErrorEl();
      if (!e) return;
      e.hidden = true;
      e.textContent = "";
    }

    function fireworks() {
      if (!FX || FX.prefersReduced()) return;
      var fx = FX.engine(burstCanvas), COL = FX.COLORS;
      var intense = state.kind === "complete", soft = state.kind === "emergency";
      var pal = soft ? [COL.info, COL.amberStrong, COL.white]
              : intense ? [COL.amber, COL.amberStrong, COL.mint, COL.white]
              : [COL.amber, COL.amberStrong, COL.white];
      var t = slot.querySelector(".hz-ticket"), r = t.getBoundingClientRect(), cx = r.left + r.width / 2;
      setTimeout(function () {
        fx.burst(cx, r.top + r.height * 0.28, { count: soft ? 34 : (intense ? 66 : 50), speed: soft ? 3.6 : (intense ? 6 : 5), palette: pal });
      }, 130);
      if (!soft) {
        var pts = intense ? [[r.left - 30, r.top + 40], [r.right + 30, r.top + 70], [cx, r.top - 20], [r.left + 40, r.top - 10]]
                          : [[r.left - 10, r.top + 60], [r.right + 10, r.top + 40]];
        pts.forEach(function (pt, i) {
          setTimeout(function () { fx.burst(pt[0], pt[1], { count: intense ? 44 : 38, speed: intense ? 5.6 : 5, palette: pal }); }, 340 + i * 220);
        });
      }
    }

    /* user pressed the primary CTA */
    function claim() {
      if (busy) return;
      var ticket = slot.querySelector(".hz-ticket");
      var cta = ticket && ticket.querySelector("[data-claim]");
      var reward = state.reward;
      var myGen = ++_claimGen; // invalidated if the user dismisses mid-claim

      clearClaimError();

      // Celebration (confetti, wallet count-up, close) is gated on a confirmed
      // success — it must never fire before the claim POST resolves. The FX
      // sequencing/timing here is calibrated; only the trigger moment moved.
      var done = function () {
        if (myGen !== _claimGen) return; // dismissed mid-claim — don't touch a closed overlay
        busy = false; // release the guard on success (was leaking → requestClose stayed dead)
        confettiFromCta(cta, reward);
        creditWallet(reward);
        animateClose(ticket);
      };

      if (opts.onClaim) {
        busy = true;
        if (cta) cta.disabled = true;
        Promise.resolve(opts.onClaim(state)).then(done, function (err) {
          if (myGen !== _claimGen) return; // dismissed mid-claim — nothing to re-enable
          // claim failed: stop the close, re-enable, show an honest reason,
          // surface to host for any side-effects (e.g. bell reminder state).
          busy = false;
          if (cta) cta.disabled = false;
          showClaimError("לא הצלחנו לאסוף את התגמול. נסו שוב.");
          if (opts.onClaimError) opts.onClaimError(err, state);
          if (window.console) console.error("[hz-daily-streak] claim failed", err);
        });
      } else {
        done();
      }
    }

    function confettiFromCta(cta, reward) {
      if (!cta || !FX || FX.prefersReduced()) return;
      var cr = cta.getBoundingClientRect(), fx = FX.engine(confCanvas);
      var y = cr.top + cr.height / 2, big = reward >= 300;
      var n = big ? 52 : 36, power = big ? 1.15 : 0.98;
      fx.confetti(cr.left + 6, y, { count: n, power: power, angle: -Math.PI * 0.72, spread: 0.9, hvel: 1.15 });
      fx.confetti(cr.right - 6, y, { count: n, power: power, angle: -Math.PI * 0.28, spread: 0.9, hvel: 1.15 });
    }

    function animateClose(ticket) {
      if (_trap) { ticket.removeEventListener("keydown", _trap); _trap = null; }
      ticket.classList.remove("is-open", "pop");
      setTimeout(function () {
        ticket.classList.add("is-closing");
        scrim.classList.add("is-out");
        setTimeout(function () { scrim.hidden = true; scrim.classList.remove("is-out"); }, 300);
      }, 180);
      if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
      if (_scrollHeld) { _scrollHeld = false; window.NaviScrollLock?.unlock?.(); }
      if (opts.onClose) opts.onClose(state);
    }

    /* close without claiming (×, Esc, backdrop, secondary). ALWAYS dismissable —
       an in-flight claim must never trap the user. A slow/stalled claim POST used
       to keep `busy` true, so this early-returned and Esc/backdrop did nothing,
       leaving the page inert + scroll-locked until a refresh. Bumping _claimGen
       neutralizes any late-resolving claim; if that POST did commit server-side,
       the reward is reconciled on the next faucet fetch. */
    function requestClose() {
      _claimGen++;
      busy = false;
      var ticket = slot.querySelector(".hz-ticket");
      if (ticket) animateClose(ticket);
      else {
        scrim.hidden = true;
        if (_scrollHeld) { _scrollHeld = false; window.NaviScrollLock?.unlock?.(); }
      }
    }

    /* wallet count-up + the decoupled event for the shell header */
    function creditWallet(amount) {
      var w = walletEl();
      if (w && FX) {
        var from = (state.balanceFrom != null) ? state.balanceFrom : parseFloat((w.textContent || "0").replace(/[^\d.-]/g, "")) || 0;
        var to = from + amount;
        setTimeout(function () {
          var cell = w.closest("[data-wallet]") || w;
          cell.classList.add("is-pop");
          FX.countUp(w, from, to, 900);
          setTimeout(function () { cell.classList.remove("is-pop"); }, 680);
        }, 240);
      }
      window.dispatchEvent(new CustomEvent("wallet:credited", { detail: { amount: amount, source: state.kind === "emergency" ? "emergency" : "daily-login" } }));
    }

    return { open: open, close: requestClose };
  }

  window.HZDailyStreak = { create: create, DEFAULT_LADDER: DEFAULT_LADDER };
})();
