/* ============================================================
   Daily Streak — init island (vanilla, global shell scope)
   Wires the ported HZDailyStreak ticket overlay to the real faucet API.

   Flow: on load, for a signed-in user, once per Asia/Jerusalem day, read
   GET /api/wallet/faucets → map the dailyLogin / emergency faucet state to the
   overlay's `state` shape → open the ticket. The CTA POSTs the real claim; the
   wallet update is decoupled — the overlay dispatches `wallet:credited` and the
   shell header listens (header-session.client.js) and reconciles the balance.

   Gating (per the contract): show once per local day. Eligibility is the
   BACKEND's `canClaim` (not a client clock); the Jerusalem date is used only as
   a cheap "already handled today" skip so we don't re-fetch on every navigation.
   ============================================================ */
(function () {
  "use strict";
  if (!window.HZDailyStreak || typeof window.HZDailyStreak.create !== "function") return;

  var SEEN_KEY = "navi_streak_seen"; // value = Asia/Jerusalem YYYY-MM-DD last handled
  var PENDING_KEY = "navi_streak_pending"; // cached daily gift for bell recovery
  var REMINDER_CHECK_KEY = "navi_streak_reminder_checked"; // value = date when seen-day fallback checked backend
  var REMINDER_READ_KEY = "navi_streak_reminder_read"; // value = date when bell reminder was read
  var REMINDER_DISMISSED_KEY = "navi_streak_reminder_dismissed"; // value = date when bell reminder was dismissed

  function jerusalemDate() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()); }
    catch { return ""; }
  }
  function streakLsGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
  function streakLsSet(k, v) { try { window.localStorage.setItem(k, v); } catch {} }
  function streakLsRemove(k) { try { window.localStorage.removeItem(k); } catch {} }

  function isAuthed() {
    // Hint stamped by Layout (SSR) + header-session (client). Reliable for "is this a user page".
    return document.documentElement.dataset.authHint === "user";
  }
  function anotherOverlayOpen() {
    // Don't pile onto a new-user How It Works one-shot or an open auth overlay;
    // a later navigation re-checks (we don't mark seen in this case).
    return !!(document.querySelector(".hzhiw-scrim") ||
              document.querySelector('.navi-overlay-root[data-active="true"]') ||
              document.querySelector(".hz-streak-scrim:not([hidden])"));
  }
  function backendBase() {
    var s = window.NaviAuthSession;
    return (s && typeof s.getBackendBaseUrl === "function" && s.getBackendBaseUrl()) || "";
  }
  function num(v) { var n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

  var streak = null;
  var pendingState = null;

  function isDailyReward(state) {
    // "claimed" (openCurrent-only; see mapCurrentState) describes an already-
    // collected reward, not something pending — never cache/replay it as one.
    return !!state && state.kind !== "emergency" && state.kind !== "claimed";
  }

  function reminderState(state) {
    if (!state) return null;
    var clean = Object.assign({}, state);
    delete clean.copy;
    return clean;
  }

  function readPending(today) {
    var raw = streakLsGet(PENDING_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.date !== today || !isDailyReward(parsed.state)) return null;
      return reminderState(parsed.state);
    } catch {
      return null;
    }
  }

  function keyIsToday(key, today) {
    return !!(today && streakLsGet(key) === today);
  }

  function markReminderRead(today) {
    if (today) streakLsSet(REMINDER_READ_KEY, today);
  }

  function markReminderUnread() {
    streakLsRemove(REMINDER_READ_KEY);
  }

  function reminderDismissed(today) {
    return keyIsToday(REMINDER_DISMISSED_KEY, today);
  }

  function dispatchReminder(active) {
    window.dispatchEvent(new CustomEvent("hz:daily-streak-reminder", {
      detail: active && pendingState ? { active: true, state: pendingState } : { active: false },
    }));
  }

  function setPending(today, state) {
    if (!today || !isDailyReward(state)) return;
    pendingState = reminderState(state);
    try { streakLsSet(PENDING_KEY, JSON.stringify({ date: today, state: pendingState })); } catch {}
    dispatchReminder(!reminderDismissed(today));
  }

  function clearPending() {
    pendingState = null;
    streakLsRemove(PENDING_KEY);
    streakLsRemove(REMINDER_READ_KEY);
    streakLsRemove(REMINDER_DISMISSED_KEY);
    dispatchReminder(false);
  }

  function dismissReminder() {
    var today = jerusalemDate();
    if (today) streakLsSet(REMINDER_DISMISSED_KEY, today);
    dispatchReminder(false);
  }

  function ensureStreak() {
    if (streak) return streak;
    var claimed = false;
    streak = window.HZDailyStreak.create({
      onClaim: function (st) {
        return postClaim(st).then(function (payload) {
          claimed = true;
          clearPending();
          return payload;
        });
      },
      onSecondary: function () { window.location.href = "/"; },
      onClose: function (st) {
        if (!claimed && isDailyReward(st)) setPending(jerusalemDate(), st);
        else if (claimed) streakLsSet(REMINDER_CHECK_KEY, jerusalemDate());
        claimed = false;
      },
    });
    return streak;
  }

  window.HZDailyStreakReminder = {
    open: function () {
      var today = jerusalemDate();
      if (reminderDismissed(today)) return false;
      pendingState = pendingState || readPending(today);
      if (!pendingState) return false;
      markReminderRead(today);
      ensureStreak().open(pendingState);
      dispatchReminder(true);
      return true;
    },
    getState: function () {
      var today = jerusalemDate();
      if (reminderDismissed(today)) return null;
      pendingState = pendingState || readPending(today);
      return pendingState;
    },
    isUnread: function () {
      var today = jerusalemDate();
      return !!(pendingState || readPending(today)) && !keyIsToday(REMINDER_READ_KEY, today);
    },
    markRead: function () {
      markReminderRead(jerusalemDate());
      dispatchReminder(true);
    },
    markUnread: function () {
      markReminderUnread();
      dispatchReminder(true);
    },
    dismiss: dismissReminder,
    clear: clearPending,
    // The hamburger menu's "live, ask-for-the-truth" entry point. Unlike `open()`
    // (which only replays an already-cached pending reward), this always fetches
    // GET /api/wallet/faucets fresh — the account may have traded, claimed, or
    // rolled to a new local day since the pending cache was last written — and
    // opens the ticket with the real state + the real claim callbacks wired via
    // the same instance `ensureStreak()` holds (so soft-nav re-mount and the
    // single-scrim guard in hz-daily-streak.js's mount() apply here too).
    openCurrent: function () {
      return fetch(backendBase() + "/api/wallet/faucets", { credentials: "include", cache: "no-store" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data) return false;
          var state = mapCurrentState(data);
          var today = jerusalemDate();
          if (!state) {
            // Nothing pending and nothing claimed-today on record — clear any
            // stale cached pending reward so a later reminder open() doesn't
            // resurrect it, then say "no state to show" (caller decides UX).
            clearPending();
            return false;
          }
          // Keep the pending cache in sync with the freshly-fetched truth: a
          // real pending reward refreshes it (covers the "claimed on page A,
          // stale-pending survives to page B" case); a "claimed" or emergency
          // state is not pending, so drop any stale cached pending reward.
          if (isDailyReward(state)) setPending(today, state);
          else clearPending();
          markReminderRead(today);
          ensureStreak().open(state);
          return true;
        })
        .catch(function () { return false; });
    },
  };

  // Map GET /api/wallet/faucets → the overlay's normalized `state`, or null if
  // there's nothing to claim right now.
  function mapState(data) {
    var f = (data && data.faucets) || {};
    var daily = f.dailyLogin || {};
    var emerg = f.emergency || {};
    var balanceFrom = num(data && data.liquidBalance);

    if (emerg.canClaim) {
      return { kind: "emergency", reward: num(emerg.rewardAmount) || 100, balanceFrom: balanceFrom };
    }
    if (daily.canClaim) {
      var reward = num(daily.rewardAmount);
      if (data && data.hasActivePosition && daily.nextStreakDay) {
        var day = daily.nextStreakDay; // the streak day being claimed, 1..7
        if (day >= 7) return { kind: "complete", day: 7, reward: reward, balanceFrom: balanceFrom };
        return { kind: "position", day: day, reward: reward, balanceFrom: balanceFrom };
      }
      // no open position → streak held, flat baseline (25)
      return { kind: "noposition", day: daily.currentStreakDay || 0, reward: reward || 25, balanceFrom: balanceFrom };
    }
    return null;
  }

  // Same as mapState, but for the menu's "show me the real thing right now" path
  // (openCurrent): when there's nothing left to claim because it was already
  // claimed today, surface a "claimed" ticket instead of null so the menu entry
  // always reflects the account's real state rather than silently no-op'ing.
  function mapCurrentState(data) {
    var already = mapState(data);
    if (already) return already;
    var daily = ((data && data.faucets) || {}).dailyLogin || {};
    if (daily.reason === "already_claimed") {
      // daily.rewardAmount here describes the NEXT eligible claim, not what was
      // already collected today — leave reward unset so normalize() derives it
      // from the ladder at currentStreakDay (the day just claimed).
      return {
        kind: "claimed",
        day: daily.currentStreakDay || 1,
        balanceFrom: num(data && data.liquidBalance),
      };
    }
    return null;
  }

  async function postClaim(state) {
    var path = state.kind === "emergency"
      ? "/api/wallet/faucets/emergency/claim"
      : "/api/wallet/faucets/daily-login/claim";
    var res = await fetch(backendBase() + path, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error("faucet claim failed: " + res.status);
    return res.json();
  }

  // Synchronous in-flight guard. On the initial load BOTH boot triggers fire — the
  // immediate/DOMContentLoaded call AND the astro:page-load that also fires on first
  // load — each queuing run() ~600ms later. The seen-key gate alone can't dedupe them:
  // it's only set AFTER the await, so under real network latency the second run()
  // passes the gate before the first sets the key → the overlay (and its faucet fetch)
  // fired twice. `busy` short-circuits the second run synchronously, before the await.
  var busy = false;
  async function run() {
    if (!isAuthed()) return;
    var today = jerusalemDate();
    var seenToday = !!(today && streakLsGet(SEEN_KEY) === today);
    var shouldAutoOpen = !seenToday;
    if (seenToday) {
      pendingState = readPending(today);
      dispatchReminder(!!pendingState && !reminderDismissed(today));
      if (streakLsGet(REMINDER_CHECK_KEY) === today) return;
    }
    if (busy) return;                               // a concurrent run from this load's other boot
    if (anotherOverlayOpen()) return;               // don't pile on; retry on next load (not marked seen)

    busy = true;
    try {
      var data;
      try {
        var res = await fetch(backendBase() + "/api/wallet/faucets", { credentials: "include", cache: "no-store" });
        if (!res.ok) return;
        data = await res.json();
      } catch { return; }

      var state = mapState(data);
      // Mark handled for today either way (nothing-to-claim OR shown), so we don't
      // re-fetch/re-pop on every navigation. A new local day clears the gate.
      if (today) streakLsSet(SEEN_KEY, today);
      if (!state) {
        clearPending();
        if (seenToday && today) streakLsSet(REMINDER_CHECK_KEY, today);
        return;
      }

      if (isDailyReward(state)) setPending(today, state);
      if (isDailyReward(state) && reminderDismissed(today)) {
        if (today) streakLsSet(REMINDER_CHECK_KEY, today);
        return;
      }
      if (!shouldAutoOpen) {
        if (today) streakLsSet(REMINDER_CHECK_KEY, today);
        return;
      }
      ensureStreak().open(state);
    } finally {
      busy = false;
    }
  }

  function boot() { setTimeout(run, 600); } // let the auth hint + chrome settle first

  // On the initial load, fire via DOMContentLoaded (or immediately if already
  // past it). On ClientRouter soft-navs the document is never re-loaded so
  // DOMContentLoaded never fires again — astro:page-load covers those.
  // Guard: both events may fire on the first load (DCL then astro:page-load);
  // `run` already gates on the Jerusalem-date seen-key so the second call is a
  // cheap early-return — no double-popup risk.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  document.addEventListener("astro:page-load", boot);
})();
