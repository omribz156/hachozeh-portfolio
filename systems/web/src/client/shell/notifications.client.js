// notifications.js — bell notifications panel controller
// ─────────────────────────────────────────────────────────────────────────
// Renders + drives the shell's bell notifications surface. Vanilla, no deps,
// same template-string idiom as site-shell.js. Pairs with
// patterns/notifications.css.
//
// Integration (see README.md for the full walk-through):
//   import { mountNotifications } from "./notifications.js";
//   const notif = mountNotifications({
//     bell: document.querySelector(".hz-shell__bell"),
//     fetchFeed: async () => (await api("/api/me/notifications")).items,
//     onMarkAllRead: () => api("/api/me/notifications/read-all", { method: "POST" }),
//     onMarkRead:    (id) => api(`/api/me/notifications/${id}/read`, { method: "POST" }),
//     onClaim:       (id) => api(`/api/wallet/faucets/daily-login/claim`, { method: "POST" }),
//     settingsHref:  "/settings#notifications",
//     historyHref:   "/notifications",
//     options: { grouping: "unread", density: "compact", thumbnails: true, marker: "dot" },
//   });
//
// The controller owns open/close, positioning (RTL-aware, fixed + JS coords
// like the other shell popovers), the mobile sheet break, mark-read / mark-all
// / inline-claim optimistic updates, and the bell unread dot.
// ─────────────────────────────────────────────────────────────────────────

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

const DEFAULT_OPTIONS = {
  grouping: "unread",   // "time" | "unread"
  density: "compact",   // "regular" | "compact"
  thumbnails: true,     // market rows show a topic thumbnail vs an icon disc
  marker: "dot",        // "dot" | "rail"  — how unread rows are flagged
};

// ── escaping (mirror site-shell.js) ───────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Defense-in-depth for the notification `html` field. The server already escapes user content
// before building this markup, but the field is innerHTML'd here — so a single future producer
// that forgets escapeHtml would become stored XSS in everyone's bell. This allowlist sanitizer
// is the belt to that suspenders: only the tags the templates actually use survive (b/strong/
// em/i/br, and span with a class attr); any other tag is unwrapped to its text and every other
// attribute (incl. on* handlers) is stripped. DOMParser builds an inert document — scripts
// never execute during parsing.
const NOTIF_ALLOWED_TAGS = { B: [], STRONG: [], EM: [], I: [], BR: [], SPAN: ["class"] };
function sanitizeNotifHtml(raw) {
  if (!raw) return "";
  try {
    const doc = new DOMParser().parseFromString("<div>" + raw + "</div>", "text/html");
    const root = doc.body.firstChild;
    if (!root) return "";
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) return; // text node — safe
        if (child.nodeType !== 1) { child.remove(); return; } // comments, etc.
        const allowedAttrs = NOTIF_ALLOWED_TAGS[child.tagName];
        if (!allowedAttrs) {
          // disallowed tag → keep its text, drop the element (and any nested markup)
          child.replaceWith(doc.createTextNode(child.textContent || ""));
          return;
        }
        Array.prototype.slice.call(child.attributes).forEach((attr) => {
          if (allowedAttrs.indexOf(attr.name.toLowerCase()) === -1) child.removeAttribute(attr.name);
        });
        walk(child);
      });
    })(root);
    return root.innerHTML;
  } catch (_) {
    return esc(raw); // parser unavailable / threw → fall back to fully-escaped text
  }
}

// ── type → icon / tint / thumb-badge maps ─────────────────────────────────
// type is the semantic kind; the renderer derives icon + color from it unless
// the item overrides `icon` / `thumb`.
const TYPE = {
  win:    { icon: "emoji_events",       cls: "win",    tone: "action-buy-strong",  badge: "emoji_events" },
  loss:   { icon: "do_not_disturb_on",  cls: "loss",   tone: "action-sell-strong", badge: "do_not_disturb_on" },
  rise:   { icon: "trending_up",        cls: "rise",   tone: "signal-rising",      badge: "trending_up" },
  fall:   { icon: "trending_down",      cls: "fall",   tone: "signal-falling",     badge: "trending_down" },
  streak: { icon: "local_fire_department", cls: "streak", tone: "brand" },
  rank:   { icon: "leaderboard",        cls: "rank",   tone: "brand-strong" },
  reply:  { icon: "forum",              cls: "reply",  tone: "text-soft",          badge: "forum" },
  close:  { icon: "schedule",           cls: "close",  tone: "warning",            badge: "schedule" },
  system: { icon: "verified",           cls: "system", tone: "info" },
};

const TIME_LABELS = { today: "היום", week: "השבוע", earlier: "מוקדם יותר" };
const TIME_ORDER = ["today", "week", "earlier"];

// ── row markup ─────────────────────────────────────────────────────────────
// item shape (see README for the proposed API contract):
//   { id, type, bucket, html, time, unread, market,
//     amount?, amountTone?, claim?, claimed?,
//     thumb?: { glyph, accent } }
function renderLeading(item, opts) {
  const t = TYPE[item.type] || TYPE.system;
  const thumb = item.thumb || {};
  // Topic-thumbnail tile for market rows that actually have art: a real market
  // image (the SVG/photo cards use), else a category glyph — with a small type
  // badge in the corner either way. Market rows with NEITHER fall through to the
  // full type-tinted icon disc below (an empty tile looked broken).
  if (opts.thumbnails && item.market && (thumb.image || thumb.glyph)) {
    const accent = thumb.accent || "var(--hz-text-muted)";
    const badge = t.badge
      ? `<span class="hz-notif__thumb-badge" style="color:var(--hz-${t.tone})">
           <span class="material-symbols-outlined">${esc(t.badge)}</span>
         </span>`
      : "";
    const inner = thumb.image
      ? `<img class="hz-notif__thumb-img" src="${esc(thumb.image)}" alt="" loading="lazy">`
      : `<span class="hz-notif__thumb-glyph material-symbols-outlined">${esc(thumb.glyph)}</span>`;
    return `<span class="hz-notif__thumb" aria-hidden="true" style="--thumb-accent:${esc(accent)}">${inner}${badge}</span>`;
  }
  return `<span class="hz-notif__icon hz-notif__icon--${t.cls}" aria-hidden="true">
            <span class="material-symbols-outlined">${esc(item.icon || t.icon)}</span>
          </span>`;
}

function renderMeta(item) {
  const parts = [];
  if (item.amount) {
    parts.push(`<span class="hz-notif__amount hz-notif__amount--${esc(item.amountTone || "pos")}">${esc(item.amount)}</span>`);
  }
  if (item.claim) {
    const claimed = !!item.claimed;
    const label = item.claimLabel || (claimed ? "כבר נאסף" : `קבל ${esc(item.claim)}`);
    const actionClass = item.claimMode === "action" ? " hz-notif__claim--action" : "";
    parts.push(
      `<button type="button" class="hz-notif__claim${actionClass} ${claimed ? "is-claimed" : ""}" data-notif-claim="${esc(item.id)}">
         <span class="material-symbols-outlined" style="font-size:0.95rem">${claimed ? "check" : "redeem"}</span>
         ${esc(label)}
       </button>`
    );
  }
  if (item.amount || item.claim) parts.push(`<span class="hz-notif__meta-sep">·</span>`);
  parts.push(`<span class="hz-notif__time">${esc(item.time)}</span>`);
  return parts.join("");
}

function renderRow(item, opts) {
  // `html` is trusted markup from the renderer (built server/client side with
  // <b> / .hz-notif__q spans). It is NOT user input — keep it that way.
  // .hz-notif__row-wrap is position:relative so the absolutely-positioned dismiss
  // button sits over the row without nesting a <button> inside a <button> (invalid HTML).
  const rowClass = [
    "hz-notif__row",
    item.unread ? "is-unread" : "is-read",
    item.noMarker ? "hz-notif__row--no-marker" : "",
  ].filter(Boolean).join(" ");
  return `
    <div class="hz-notif__row-wrap">
      <button class="${rowClass}" type="button" data-notif-row="${esc(item.id)}">
        ${renderLeading(item, opts)}
        <span class="hz-notif__body">
          <span class="hz-notif__text">${item.html ? sanitizeNotifHtml(item.html) : esc(item.text)}</span>
          <span class="hz-notif__meta">${renderMeta(item)}</span>
        </span>
      </button>
      <button type="button" class="hz-notif__dismiss" data-notif-dismiss="${esc(item.id)}" aria-label="הסר התראה" title="הסר"><span class="material-symbols-outlined">close</span></button>
    </div>`;
}

function groupItems(items, grouping) {
  if (grouping === "unread") {
    const u = items.filter((n) => n.unread);
    const r = items.filter((n) => !n.unread);
    const out = [];
    if (u.length) out.push(["לא נקראו", u]);
    if (r.length) out.push(["נקראו", r]);
    return out;
  }
  return TIME_ORDER
    .map((b) => [TIME_LABELS[b], items.filter((n) => n.bucket === b)])
    .filter(([, arr]) => arr.length);
}

function renderPanel(items, opts, links) {
  const unread = items.filter((n) => n.unread).length;
  const empty = items.length === 0;

  const head = `
    <div class="hz-notif__head">
      <span class="hz-notif__title">התראות
        <span class="hz-notif__count" data-zero="${unread === 0}">${unread}</span>
      </span>
      <div style="display:flex;align-items:center;gap:0.35rem">
        ${items.length === 0
          ? ""
          : unread > 0
            ? `<button class="hz-notif__markall" type="button" data-notif-markall>סמן הכל כנקרא</button>`
            : `<button class="hz-notif__markall" type="button" data-notif-clear>נקה את התיבה</button>`}
        <button class="hz-notif__close" type="button" aria-label="סגירה" data-notif-close>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>`;

  const body = empty
    ? `<div class="hz-notif__empty">
         <span class="material-symbols-outlined">notifications_off</span>
         <span class="hz-notif__empty-title">אין התראות חדשות</span>
       </div>`
    : `<div class="hz-notif__scroll" aria-live="polite" aria-relevant="additions">${
        groupItems(items, opts.grouping).map(([label, arr]) => `
          <div class="hz-notif__group">
            <div class="hz-notif__group-label">${esc(label)}</div>
            ${arr.map((n) => renderRow(n, opts)).join("")}
          </div>`).join("")
      }</div>`;

  const foot = `
    <div class="hz-notif__foot">
      <a class="hz-notif__foot-link" href="${esc(links.historyHref || "#")}">כל ההתראות</a>
      <a class="hz-notif__settings" href="${esc(links.settingsHref || "#")}" aria-label="הגדרות התראות">
        <span class="material-symbols-outlined">settings</span>
      </a>
    </div>`;

  // Empty state: drop the footer ("כל ההתראות" + settings) — there's nothing to
  // browse and it reads as clutter on an empty tray.
  return head + body + (empty ? "" : foot);
}

// ── controller ─────────────────────────────────────────────────────────────
export function mountNotifications(config) {
  const {
    bell,
    fetchFeed,
    onMarkRead, onMarkAllRead, onClearInbox, onClaim, onDismiss,
    settingsHref, historyHref,
    options: userOptions,
  } = config;

  const opts = { ...DEFAULT_OPTIONS, ...userOptions };
  const links = { settingsHref, historyHref };

  let items = [];
  let open = false;
  let _trap = null;
  let _opener = null;

  // panel + scrim live at body level (fixed), like the other shell popovers
  const panel = document.createElement("div");
  panel.className = "hz-notif";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "התראות");
  panel.dataset.density = opts.density;
  panel.dataset.marker = opts.marker;

  const scrim = document.createElement("div");
  scrim.className = "hz-notif-scrim";

  document.body.append(panel, scrim);
  if (bell) {
    bell.setAttribute("aria-haspopup", "dialog");
    bell.setAttribute("aria-expanded", "false");
    bell.dataset.notifBell = "";
  }

  function paint() {
    panel.innerHTML = renderPanel(items, opts, links);
    panel.classList.toggle("hz-notif--empty", items.length === 0);
    const unread = items.filter((n) => n.unread).length;
    const dot = bell && bell.querySelector(".hz-shell__bell-dot");
    if (dot) dot.style.display = unread > 0 ? "block" : "none";
  }

  function place() {
    if (!bell) return;
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    if (mobile) { panel.style.top = panel.style.left = panel.style.right = ""; return; }
    const r = bell.getBoundingClientRect();
    const pw = panel.offsetWidth || 400;
    let left = Math.max(8, Math.min(r.left - 12, window.innerWidth - pw - 8));
    panel.style.top = `${r.bottom + 10}px`;
    panel.style.left = `${left}px`;
    panel.style.right = "auto";
  }

  // Never stack two overlays. The bell click stopPropagation()s (so the controller's
  // own outside-click doesn't instantly re-close the panel) — which also prevents the
  // shell's document-level handler from closing an open hamburger/profile menu. So
  // close the shell's other surfaces explicitly when the bell opens.
  function closeShellOverlays() {
    document.querySelectorAll("[data-hamburger-menu].is-open, [data-cat-more].is-open")
      .forEach((n) => n.classList.remove("is-open"));
    document.querySelectorAll("[data-hamburger-trigger], [data-cat-more-trigger]")
      .forEach((t) => t.setAttribute("aria-expanded", "false"));
    try {
      if (window.NaviOverlays?.close) window.NaviOverlays.close();
    } catch {}
  }

  function setOpen(next) {
    open = next;
    if (open) {
      closeShellOverlays();
      _opener = document.activeElement;
    }
    // ClientRouter soft-nav swaps <body>, detaching our appended panel+scrim
    // (they aren't transition:persist'd — the bell IS, so its listener survives
    // and still calls setOpen, but onto an off-DOM node → dead panel until a hard
    // refresh). Re-attach the SAME nodes (listeners survive detach) before showing.
    // See reference_clientrouter_script_lifecycle #3 (share-modal had this exact bug).
    if (open && !panel.isConnected) document.body.append(panel, scrim);
    panel.classList.toggle("is-open", open);
    scrim.classList.toggle("is-open", open);
    if (bell) bell.setAttribute("aria-expanded", String(open));
    if (open) {
      place();
      if (_trap) panel.removeEventListener("keydown", _trap);
      _trap = naviTrapTab(panel);
      panel.addEventListener("keydown", _trap);
      // move focus to the close button so SR announces the dialog
      const closeBtn = panel.querySelector("[data-notif-close]");
      if (closeBtn) closeBtn.focus();
    } else {
      if (_trap) { panel.removeEventListener("keydown", _trap); _trap = null; }
      if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
    }
  }

  // ── optimistic mutations ───────────────────────────────────────────────
  function markRead(id) {
    const it = items.find((n) => n.id === id);
    if (!it || !it.unread) return;
    it.unread = false; paint();
    onMarkRead?.(id);
  }
  function markAll() {
    if (!items.some((n) => n.unread)) return;
    const unreadIds = items.filter((n) => n.unread).map((n) => n.id);
    items.forEach((n) => { n.unread = false; }); paint();
    onMarkAllRead?.(unreadIds);
  }
  function clearInbox() {
    if (!items.length) return;
    const ids = items.map((n) => n.id);
    items.length = 0; paint(); // optimistic empty → empty state + dot clears
    onClearInbox?.(ids);
  }
  function dismiss(id) {
    const i = items.findIndex((n) => n.id === id);
    if (i === -1) return;
    items.splice(i, 1); paint(); // optimistic remove
    onDismiss?.(id);
  }
  function claim(id) {
    const it = items.find((n) => n.id === id);
    if (!it || it.claimed) return;
    if (it.claimMode === "action") {
      it.unread = false;
      paint();
      onClaim?.(id, it);
      setOpen(false);
      return;
    }
    it.claimed = true; it.unread = false; paint();
    onClaim?.(id, it);
  }

  // Row CTA — mark read, then act on the notification.
  // win/loss → open the result overlay IN PLACE (no navigation), like the other
  // client overlays. Everything else → navigate to the market/target. Rows with
  // neither (e.g. a streak row) just mark read.
  function activate(id) {
    markRead(id);
    const it = items.find((n) => n.id === id);
    if (!it) return;
    // ?focus so a child-of-event market lands on THAT child (its own view), not
    // the parent event ladder. Harmless on standalone markets (the market page
    // only honors focus when the market is a multi-child event).
    const marketHref = it.marketKey ? `/markets/${encodeURIComponent(it.marketKey)}?focus` : null;

    if ((it.type === "win" || it.type === "loss") && window.NaviResultOverlay) {
      setOpen(false);
      openResultOverlay(it);
      return;
    }

    if (it.action === "daily-streak") {
      setOpen(false);
      onClaim?.(id, it);
      return;
    }

    // Welcome → open the "how it works" walkthrough in place (no navigation).
    // welcome variant appends the post-signup streak teaser as a final card.
    if (it.action === "how-it-works") {
      setOpen(false);
      if (window.NaviHowItWorks && window.NaviHowItWorks.open) {
        window.NaviHowItWorks.open({ variant: "welcome" });
      }
      return;
    }

    const href = it.href || marketHref;
    if (!href) return;
    setOpen(false);
    window.location.assign(href);
  }

  // Build the result-overlay payload from a notification row and open it. Shared by
  // the row tap (activate) and the live auto-surface below, so both reveals are
  // identical (same claim wiring, same accuracy delta).
  function openResultOverlay(it) {
    if (!window.NaviResultOverlay) return;
    // ?focus so a child-of-event market lands on THAT child (its own view), not
    // the parent event ladder. Harmless on standalone markets (the market page
    // only honors focus when the market is a multi-child event).
    const marketHref = it.marketKey ? `/markets/${encodeURIComponent(it.marketKey)}?focus` : null;
    // Prefer backend plain text; keep html parsing only for older rows.
    const tmp = document.createElement("div");
    tmp.innerHTML = sanitizeNotifHtml(it.html);
    const q = tmp.querySelector(".hz-notif__q");
    window.NaviResultOverlay.open({
      outcome: it.type,
      outcomeLabel: it.outcomeLabel || null,
      amount: it.amount,
      market: it.marketTitle || (q ? q.textContent : (tmp.textContent || "")),
      marketHref: marketHref || "#",
      nextHref: "/",
      accFrom: it.accFrom,
      accTo: it.accTo,
      streak: it.streak,
      // Claim wiring: the win overlay's primary button claims the payout. The
      // notification carries marketKey (and maybe a claimId); the overlay resolves
      // the pending claim from /api/portfolio/claims when only the market is known.
      marketKey: it.marketKey || null,
      claimId: it.claimId || null,
      claimed: !!it.claimed,
    });
  }

  function markClaimSettled(detail) {
    const claimId = detail?.claimId ? String(detail.claimId) : "";
    const marketKey = detail?.marketKey ? String(detail.marketKey) : "";
    let changed = false;
    items.forEach((n) => {
      const sameClaim = claimId && String(n.claimId || "") === claimId;
      const sameMarket = marketKey && String(n.marketKey || "") === marketKey && n.type === "win";
      if (!sameClaim && !sameMarket) return;
      if (!n.claimed) {
        n.claimed = true;
        changed = true;
      }
      if (n.unread) {
        n.unread = false;
        changed = true;
      }
    });
    if (changed) paint();
  }

  // ── live win auto-surface (gated) ────────────────────────────────────────
  // When a WIN resolution lands over the live channel (header-session's notification
  // stream → refresh()), pop the celebration reveal the moment it arrives — the win
  // feels like the sequel to the bet. LOSSES never auto-pop (rubbing it in violates
  // the calm-on-loss posture); they stay in the bell, pull-not-push.
  //
  // Two hard rules:
  //  1. PRIME, don't pop history. The first refresh is the page's existing inbox —
  //     unread wins there are old, not "just landed". We record them as seen and only
  //     ever auto-pop ids that appear AFTER priming. (Mount-once + transition:persist
  //     means `primed` survives soft-nav, so navigation never re-pops history.)
  //  2. NEVER interrupt. If the screen is busy — another overlay open (auth/trade
  //     sheet/share/bell/result), mid-input, or the tab backgrounded — queue the win
  //     and flush it the instant the screen frees (a body MutationObserver, live only
  //     while something is queued, so it costs nothing at rest).
  const seenNotifIds = new Set();
  const winQueue = [];
  let primed = false;
  let busyObserver = null;

  function screenBusy() {
    if (document.hidden) return true;                                   // backgrounded tab → wait
    if (document.body.classList.contains("overlay-open")) return true;  // auth/page-overlay/trade-sheet/share
    // any rendered modal dialog (bell, result overlay, etc.) — same convention the
    // Layout inert observer trusts; getClientRects() is empty for display:none.
    const dlgs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (let i = 0; i < dlgs.length; i++) {
      const d = dlgs[i];
      if (!d.hasAttribute("hidden") && d.getClientRects().length) return true;
    }
    const ae = document.activeElement;                                  // mid-input → don't steal focus
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return true;
    return false;
  }

  function startBusyWatch() {
    if (busyObserver) return;
    let scheduled = false;
    busyObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; flushWins(); });
    });
    busyObserver.observe(document.body, {
      attributes: true, childList: true, subtree: true,
      attributeFilter: ["class", "style", "hidden", "aria-modal", "role"],
    });
  }
  function stopBusyWatch() {
    if (busyObserver) { busyObserver.disconnect(); busyObserver = null; }
  }

  function flushWins() {
    if (!winQueue.length) { stopBusyWatch(); return; }
    if (screenBusy()) { startBusyWatch(); return; } // still blocked → keep watching for the screen to free
    const it = winQueue.shift();
    markRead(it.id);          // they're about to see it — match the tap behavior (row stays, just read)
    openResultOverlay(it);    // POP. the reveal is now the busy modal; queued siblings flush on its close
    if (winQueue.length) startBusyWatch();
    else stopBusyWatch();
  }

  // Inspect the freshly-refreshed inbox for live-arrived unread wins. Called at the
  // tail of refresh(), so it sees the same `items` the bell just painted.
  function detectIncomingWins() {
    if (!primed) {
      items.forEach((n) => seenNotifIds.add(n.id)); // record history; never pop it
      primed = true;
      return;
    }
    items.forEach((n) => {
      if (seenNotifIds.has(n.id)) return;
      seenNotifIds.add(n.id);
      if (n.type === "win" && n.unread && !winQueue.some((q) => q.id === n.id)) {
        winQueue.push(n);
      }
    });
    if (winQueue.length) flushWins();
  }

  // Backgrounded when a win queued? Flush on return.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flushWins(); });
  window.addEventListener("navi:portfolio-claim-settled", (event) => {
    markClaimSettled(event.detail || {});
  });

  // ── events (delegated) ──────────────────────────────────────────────────
  panel.addEventListener("click", (e) => {
    const claimBtn = e.target.closest("[data-notif-claim]");
    if (claimBtn) { e.stopPropagation(); claim(claimBtn.dataset.notifClaim); return; }
    const dismissBtn = e.target.closest("[data-notif-dismiss]");
    if (dismissBtn) { e.stopPropagation(); dismiss(dismissBtn.dataset.notifDismiss); return; }
    if (e.target.closest("[data-notif-markall]")) { markAll(); return; }
    if (e.target.closest("[data-notif-clear]")) { clearInbox(); return; }
    if (e.target.closest("[data-notif-close]")) { setOpen(false); return; }
    const row = e.target.closest("[data-notif-row]");
    if (row) activate(row.dataset.notifRow);
  });
  // Enter/Space on .hz-notif__row are now handled natively (button element fires click).

  bell?.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!open); });
  scrim.addEventListener("click", () => setOpen(false));

  document.addEventListener("click", (e) => {
    if (!open) return;
    if (e.target.closest(".hz-notif") || e.target.closest("[data-notif-bell]")) return;
    setOpen(false);
  });
  // Reverse exclusivity: opening another shell surface (hamburger/profile, "+ עוד")
  // closes the bell. Those triggers stopPropagation() in the bubble phase, so the
  // outside-click above never sees them — a CAPTURE-phase listener runs first and does.
  document.addEventListener("click", (e) => {
    if (open && e.target.closest("[data-hamburger-trigger], [data-cat-more-trigger]")) setOpen(false);
  }, true);
  document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") setOpen(false); });
  window.addEventListener("resize", () => open && place());
  window.addEventListener("scroll", () => open && place(), true);

  // ── load ────────────────────────────────────────────────────────────────
  async function refresh() {
    if (fetchFeed) { try { items = (await fetchFeed()) || []; } catch { items = []; } }
    paint();
    detectIncomingWins(); // first call primes (records history); later calls auto-pop live wins
  }
  refresh();

  return {
    refresh,
    open: () => setOpen(true),
    close: () => setOpen(false),
    setItems(next) { items = next || []; paint(); },
    setOption(key, value) { opts[key] = value; if (key === "density") panel.dataset.density = value; if (key === "marker") panel.dataset.marker = value; paint(); },
    el: panel,
  };
}
