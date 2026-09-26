/* ============================================================
   HZ — How It Works overlay (self-mounting vanilla component)
   No framework, no build. Usage:

     const hiw = HZHowItWorks.create({
       onSignup: () => openSignupOverlay(),   // last step → hand off
       onClose:  () => {},                     // any close (click-outside)
       onStep:   (i, step) => {},              // optional
       steps:    [...]                         // optional override
     });
     hiw.open();    // show from step 0
     hiw.close();   // programmatic close

   The "state"/contract here is the `steps` array + the callbacks — NOT the
   DOM strings below. Port the markup to your stack; keep the shape.
   ============================================================ */
(function (root) {
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

  // ---- default content (Hebrew-first, RTL) -------------------------------
  var DEFAULT_STEPS = [
    {
      key: "choose",
      demo: "choose",
      title: "בוחרים חוזה",
      body: "מאות שווקים על פוליטיקה, ספורט, כלכלה ותרבות. בוחרים שאלה על העתיד שיש לך עליה דעה — וצוללים פנימה.",
      art: "צילום מסך · עיון בשווקים",
      icon: "grid"
    },
    {
      key: "trade",
      demo: "trade",
      title: "פותחים פוזיציה",
      body: "בוחרים תוצאה, קובעים סכום, ופותחים פוזיציה לפי מידת הביטחון שלך. המחיר משקף את ההסתברות שהשוק מתמחר כרגע.",
      art: "צילום מסך · כרטיס מסחר",
      icon: "trade"
    },
    {
      key: "compete",
      demo: "compete",
      title: "מתחרים ומוכיחים יכולת",
      body: "מטפסים בטבלת המובילים לפי רווח והפסד, בונים רקורד מדויק לאורך זמן, ומראים מי קורא את השוק הכי טוב.",
      art: "צילום מסך · טבלת מובילים",
      icon: "bars"
    },
    {
      key: "redeem",
      demo: "redeem",
      title: "פודים את התוצאה",
      body: "כשהשוק נסגר ומוכרע לפי מקור אמין, פוזיציות מנצחות נפדות אוטומטית ל-V₪ והרווח נכנס ישר ליתרה.",
      art: "צילום מסך · פדיון ויתרה",
      icon: "redeem"
    }
  ];

  // Welcome-mode only (opened from the post-signup welcome notification). A final
  // TEASER card — claims nothing (the signup bonus is already granted); it just
  // nudges "come back tomorrow" and previews the daily-login streak toward the
  // week-7 bonus. `finishAction: "close"` → CTA dismisses, no signup handoff.
  var WELCOME_STREAK_STEP = {
    key: "streak",
    demo: "streak",
    title: "מוכנים לרצף החדש שלכם?",
    body: "מחר יש למה לחזור: כניסה יומית מגדילה את הרצף שלכם, ושבוע מלא של התמדה שווה בונוס V₪ מפנק. נתראה מחר!",
    ctaLabel: "מתחילים",
    finishAction: "close"
  };

  var NEXT_LABEL = "הבא";
  var FINISH_LABEL = "התחילו לחזות";

  var ICONS = {
    grid:   '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    trade:  '<path d="M8 20V8"/><path d="M4.5 11.5 8 8l3.5 3.5"/><path d="M16 4v12"/><path d="M19.5 12.5 16 16l-3.5-3.5"/>',
    bars:   '<path d="M5 20V13"/><path d="M12 20V5"/><path d="M19 20v-9"/>',
    redeem: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2 11 14.7 16 9.5"/>'
  };
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>';

  function svgIcon(name) {
    return '<svg class="hzhiw__art-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + '</svg>';
  }

  function demoMoney(value) {
    const symbol = root.HZCurrency?.symbolHtml?.({ decorative: true }) || '<span class="hz-vshekel-symbol" aria-hidden="true"><span class="hz-vshekel-fallback">V₪</span></span>';
    return '<bdi class="hzhiw-demo__money hz-money" dir="ltr" aria-label="V₪ ' + value + '">' +
      symbol + '<span>' + value + '</span></bdi>';
  }

  function renderDemo(kind) {
    if (kind === "choose") {
      return '' +
        '<div class="hzhiw-demo hzhiw-demo--choose" aria-hidden="true">' +
          '<section class="hzhiw-demo-card hzhiw-demo-market">' +
            '<div class="hzhiw-demo-market__top">' +
              '<span class="hzhiw-demo-market__category">כלכלה</span>' +
              '<strong class="hzhiw-demo-market__chance">45%</strong>' +
            '</div>' +
            '<h3 class="hzhiw-demo-market__title">האם הריבית תישאר ללא שינוי?</h3>' +
            '<div class="hzhiw-demo-market__outcomes">' +
              '<span class="hzhiw-demo-pill hzhiw-demo-pill--yes">כן <bdi dir="ltr">45%</bdi></span>' +
              '<span class="hzhiw-demo-pill hzhiw-demo-pill--no">לא <bdi dir="ltr">55%</bdi></span>' +
            '</div>' +
            '<div class="hzhiw-demo-market__meta"><span>נפח</span>' + demoMoney("3.4M") + '</div>' +
          '</section>' +
        '</div>';
    }
    if (kind === "trade") {
      return '' +
        '<div class="hzhiw-demo hzhiw-demo--trade" aria-hidden="true">' +
          '<section class="hzhiw-demo-card hzhiw-demo-ticket">' +
            '<div class="hzhiw-demo-ticket__tabs">' +
              '<span class="is-active">קנייה</span>' +
              '<span>מכירה</span>' +
            '</div>' +
            '<div class="hzhiw-demo-ticket__outcomes">' +
              '<button class="is-selected"><span>כן</span>' + demoMoney("45") + '</button>' +
              '<button><span>לא</span>' + demoMoney("55") + '</button>' +
            '</div>' +
            '<label class="hzhiw-demo-field"><span>כמה להשקיע</span><strong>' + demoMoney("25") + '</strong></label>' +
            '<div class="hzhiw-demo-ticket__quote"><span>פדיון אפשרי</span><strong>' + demoMoney("55.5") + '</strong></div>' +
            '<button class="hzhiw-demo-buy">קנה כן ' + demoMoney("25") + '</button>' +
          '</section>' +
        '</div>';
    }
    if (kind === "compete") {
      return '' +
        '<div class="hzhiw-demo hzhiw-demo--compete" aria-hidden="true">' +
          '<section class="hzhiw-demo-card hzhiw-demo-board">' +
            '<div class="hzhiw-demo-board__head"><strong>לוח מובילים · השבוע</strong><span>הכל</span></div>' +
            '<ol class="hzhiw-demo-board__list">' +
              '<li><b>1</b><span>ישראל ישראלי</span><strong>' + demoMoney("+5,307") + '</strong></li>' +
              '<li class="is-focus"><b>2</b><span>אתה</span><strong>' + demoMoney("+3,705") + '</strong></li>' +
              '<li><b>3</b><span>שלומי שלום</span><strong>' + demoMoney("+3,209") + '</strong></li>' +
            '</ol>' +
            '<p>דיוק ציבורי משתפר כשיותר שווקים נסגרים.</p>' +
          '</section>' +
        '</div>';
    }
    if (kind === "streak") {
      // Reuse the REAL daily-streak ladder (hz-stamps / daily-streak.css, globally
      // loaded) so the teaser matches the actual claim overlay 1:1. Teaser state =
      // day-0 preview: day 1 is the gold focal "next", the week ahead is future, day 7
      // is the ★ peak. Nothing is claimed (the signup bonus is separate).
      var LADDER = [100, 150, 200, 250, 300, 350, 400];
      var stamps = "";
      for (var d = 0; d < 7; d++) {
        var cls = (d === 0) ? "today" : "future";
        if (d === 6) cls += " hz-stamp--peak";
        var glyph = (d === 6) ? "★" : "";
        stamps += '<div class="hz-stamp hz-stamp--' + cls + '">' +
          '<span class="hz-stamp__amt">' + LADDER[d] + '</span>' +
          '<span class="hz-stamp__glyph">' + glyph + '</span>' +
          '<span class="hz-stamp__day">' + (d + 1) + '</span></div>';
      }
      return '' +
        '<div class="hzhiw-demo hzhiw-demo--streak" aria-hidden="true">' +
          '<section class="hzhiw-demo-card hzhiw-streak">' +
            '<div class="hz-foil__title"><span>הרצף שלך</span>' +
              '<span class="hz-seq hz-mono"><b>00</b> / 07</span></div>' +
            '<div class="hz-stamps">' + stamps + '</div>' +
          '</section>' +
        '</div>';
    }
    return '' +
      '<div class="hzhiw-demo hzhiw-demo--redeem" aria-hidden="true">' +
        '<section class="hzhiw-demo-card hzhiw-demo-result">' +
          '<span class="hzhiw-demo-result__label">קריאה נכונה</span>' +
          '<strong class="hzhiw-demo-result__amount">' + demoMoney("+150") + '</strong>' +
          '<h3>שוק נסגר בהחוזה</h3>' +
          '<p>התוצאה נסגרה לטובתך</p>' +
        '</section>' +
      '</div>';
  }

  function create(opts) {
    opts = opts || {};
    var steps = (opts.steps && opts.steps.length) ? opts.steps : DEFAULT_STEPS;
    var activeSteps = steps;   // swapped per-open: welcome mode appends the streak teaser
    var i = 0;
    var scrim = null;        // root layer (also the click-outside target)
    var artEl, titleEl, textEl, ctaEl, bodyEl;
    var _trap = null;
    var _opener = null;
    var _scrollHeld = false; // this instance's own lock/unlock idempotency flag

    function isLast() { return i === activeSteps.length - 1; }

    function renderStep(animate) {
      var s = activeSteps[i];
      // art: crisp product demo, real image if provided, else labeled placeholder.
      if (s.demo) {
        artEl.dataset.hiwArtMode = "demo";
        artEl.innerHTML = renderDemo(s.demo);
      } else if (s.image) {
        artEl.dataset.hiwArtMode = "image";
        artEl.innerHTML = '<img src="' + s.image + '" alt="" />';
      } else {
        artEl.dataset.hiwArtMode = "placeholder";
        artEl.innerHTML =
          '<span class="hzhiw__art-tag">תמונה</span>' +
          '<div class="hzhiw__art-inner">' + svgIcon(s.icon) +
          '<div class="hzhiw__art-label">' + (s.art || "") + '</div></div>';
      }
      titleEl.textContent = s.title || "";
      textEl.textContent = s.body || "";
      ctaEl.innerHTML = (s.ctaLabel || (isLast() ? FINISH_LABEL : NEXT_LABEL)) + CHEVRON;

      if (animate) {
        bodyEl.setAttribute("data-swap", "");
        // restart the CSS animation
        // eslint-disable-next-line no-unused-expressions
        void bodyEl.offsetWidth;
      }
      if (typeof opts.onStep === "function") opts.onStep(i, s);
    }

    function next() {
      if (isLast()) { finish(); return; }
      i += 1;
      renderStep(true);
    }

    function finish() {
      var s = activeSteps[i];
      if (s && s.finishAction === "close") {
        // welcome-mode streak teaser → just dismiss, no signup handoff.
        close();
        return;
      }
      // hand off to the host's existing signup overlay, then close.
      teardown(false);
      if (typeof opts.onSignup === "function") opts.onSignup();
    }

    function onScrimClick(e) {
      if (e.target === scrim) close();   // click OUTSIDE the panel → dismiss
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    function build() {
      scrim = document.createElement("div");
      scrim.className = "hzhiw-scrim";
      scrim.setAttribute("dir", "rtl");
      scrim.setAttribute("lang", "he");
      scrim.setAttribute("data-anim", "");
      scrim.innerHTML =
        '<section class="hzhiw" role="dialog" aria-modal="true" aria-label="איך זה עובד" data-screen-label="how-it-works overlay">' +
          '<div class="hzhiw__art" data-hiw-art></div>' +
          '<div class="hzhiw__body" data-hiw-body>' +
            '<h2 class="hzhiw__title" data-hiw-title></h2>' +
            '<p class="hzhiw__text" data-hiw-text></p>' +
          '</div>' +
          '<div class="hzhiw__foot">' +
            '<button type="button" class="hzhiw__cta" data-hiw-cta></button>' +
          '</div>' +
        '</section>';

      artEl   = scrim.querySelector("[data-hiw-art]");
      titleEl = scrim.querySelector("[data-hiw-title]");
      textEl  = scrim.querySelector("[data-hiw-text]");
      ctaEl   = scrim.querySelector("[data-hiw-cta]");
      bodyEl  = scrim.querySelector("[data-hiw-body]");

      var panel = scrim.querySelector(".hzhiw");
      _trap = naviTrapTab(panel);
      panel.addEventListener("keydown", _trap);
      ctaEl.addEventListener("click", next);
      scrim.addEventListener("click", onScrimClick);
      document.addEventListener("keydown", onKey);

      (opts.mount || document.body).appendChild(scrim);
    }

    function teardown(fireClose) {
      if (!scrim) return;
      var panel = scrim.querySelector(".hzhiw");
      if (_trap && panel) { panel.removeEventListener("keydown", _trap); _trap = null; }
      document.removeEventListener("keydown", onKey);
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      scrim = null;
      if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
      if (_scrollHeld) { _scrollHeld = false; window.NaviScrollLock?.unlock?.(); }
      if (fireClose && typeof opts.onClose === "function") opts.onClose();
    }

    // ---- public API ----
    // open() — back-compat: a number is startAt. An options object can also pass
    // { startAt, variant }. variant "welcome" appends the streak teaser as a final
    // card (post-signup first run, opened from the welcome notification); every
    // other entry (nav, hamburger, guest) uses the base steps + signup handoff.
    function open(arg) {
      if (scrim) return api;            // already open
      var startAt = 0, variant = null;
      if (typeof arg === "number") {
        startAt = arg;
      } else if (arg && typeof arg === "object") {
        startAt = (typeof arg.startAt === "number") ? arg.startAt : 0;
        variant = arg.variant || null;
      }
      activeSteps = (variant === "welcome") ? steps.concat([WELCOME_STREAK_STEP]) : steps;
      _opener = document.activeElement;
      i = startAt;
      build();
      renderStep(false);
      ctaEl.focus();
      if (!_scrollHeld) { _scrollHeld = true; window.NaviScrollLock?.lock?.(); }
      return api;
    }
    function close() { teardown(true); }
    function goTo(n) { if (scrim && activeSteps[n]) { i = n; renderStep(true); } }

    var api = { open: open, close: close, goTo: goTo, get isOpen() { return !!scrim; } };
    return api;
  }

  root.HZHowItWorks = { create: create, DEFAULT_STEPS: DEFAULT_STEPS };
})(window);
