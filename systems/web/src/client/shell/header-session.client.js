import { mountNotifications } from './notifications.client.js';
// Registers window.NaviScrollLock as a side effect — imported here (not used
// directly in this file) so the refcounted body.overlay-open owner exists on
// every page, the same way NaviSharedSnapshotFetch below is guaranteed live.
import './scroll-lock.js';

const money = new Intl.NumberFormat('he-IL', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const formatMoneyText = (value) => `\u2066V₪ ${money.format(Number(value) || 0)}\u2069`;
const formatMoney = (value) => window.HZCurrency?.moneyHtml?.(value) || formatMoneyText(value);

// TIER_LABELS: kept for the upgrade-button path in renderVerificationStatus.
const TIER_LABELS = {
  gray: 'תג אפור',
  gold: 'תג זהב',
  diamond: 'תג יהלום',
};

// displayName, initialFor, avatarUrlFor, DEFAULT_AVATAR_URL, setText removed in Slice 2:
// avatar identity is now owned by Preact islands (HeaderAvatar + HeaderMenuIdentity).

function setHidden(selector, hidden) {
  document.querySelectorAll(selector).forEach((node) => {
    node.hidden = hidden;
  });
}

function closeMenus() {
  document.querySelectorAll('[data-hamburger-menu]').forEach((node) => {
    node.classList.remove('is-open');
  });
  document.querySelectorAll('[data-hamburger-trigger]').forEach((node) => {
    node.setAttribute('aria-expanded', 'false');
  });
}

function tierLabel(tier) {
  return TIER_LABELS[tier] || 'תג';
}

function backendPath(path) {
  const base = window.NaviAuthSession?.getBackendBaseUrl?.() || '';
  return `${base}${path}`;
}

// cleanAvatarTierClasses and the [data-shell-verification-avatar] / [data-shell-verification-badge]
// loops were removed in Slice 2: both avatar elements are now owned by Preact islands
// (HeaderAvatar + HeaderMenuIdentity) which manage their own tier classes reactively.
// Only the upgrade button path below remains vanilla.
function renderVerificationStatus(auth) {
  const verification = auth?.reputation?.verification || null;
  const nextPurchase = verification?.nextPurchase || null;
  const upgradeButton = document.querySelector('[data-shell-verification-upgrade]');
  const upgradeKicker = document.querySelector('[data-shell-verification-upgrade-kicker]');
  const upgradeLabel = document.querySelector('[data-shell-verification-upgrade-label]');

  if (!upgradeButton || !upgradeKicker || !upgradeLabel) return;

  if (!nextPurchase?.eligible) {
    upgradeButton.hidden = true;
    upgradeButton.removeAttribute('data-tier');
    return;
  }

  upgradeButton.hidden = false;
  upgradeButton.dataset.tier = nextPurchase.tier;
  upgradeKicker.textContent = 'נפתח';
  upgradeLabel.innerHTML = `${tierLabel(nextPurchase.tier)} · <span class="hz-shell__verification-upgrade-money">${formatMoney(nextPurchase.price)}</span>`;
}

// Shared snapshot seam: the header wallet AND the portfolio island both need
// /api/portfolio/snapshot at page load — without this, the same payload was
// fetched twice per portfolio view. One in-flight/3s-fresh promise serves
// both; failures are never cached. Exposed on window because the portfolio
// island lives in a separate classic-script bundle.
const SNAPSHOT_SHARE_MS = 3000;

window.NaviSharedSnapshotFetch = window.NaviSharedSnapshotFetch || (() => {
  const shared = { promise: null, at: 0 };

  return function sharedSnapshotFetch(options = {}) {
    const now = Date.now();
    const forceFresh = Boolean(options?.forceFresh);
    if (!forceFresh && shared.promise && now - shared.at < SNAPSHOT_SHARE_MS) {
      return shared.promise;
    }

    shared.at = now;
    const promise = fetch(backendPath('/api/portfolio/snapshot'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      return payload;
    });
    shared.promise = promise;
    promise.catch(() => {
      if (shared.promise === promise) shared.promise = null;
    });
    return promise;
  };
})();

async function refreshWallet() {
  // Two readouts share this hook: the desktop header chip and the mobile
  // bottom-tab balance (under the portfolio slot). Update ALL of them.
  const valueNodes = document.querySelectorAll('[data-shell-wallet-value]');
  if (!valueNodes.length) return;

  // Don't blank to 'בודק...' — keep the server-rendered balance (from the
  // navi_wallet cookie) so the header never flickers on load/navigation. Touch the
  // DOM only when the number actually changes, and persist the raw balance so the
  // next SSR render shows it on first paint.
  try {
    const payload = await window.NaviSharedSnapshotFetch();
    const cash = payload?.summary?.availableCash;
    const formatted = formatMoney(cash);
    const label = formatMoneyText(cash);
    valueNodes.forEach((node) => {
      if (node.dataset.hzMoneyRaw !== String(cash)) {
        node.innerHTML = formatted;
        node.dataset.hzMoneyRaw = String(cash);
      }
      node.setAttribute('aria-label', label);
    });
    if (cash != null && Number.isFinite(Number(cash))) {
      document.cookie = `navi_wallet=${encodeURIComponent(String(cash))}; path=/; max-age=3600; samesite=lax`;
    }
  } catch {
    valueNodes.forEach((node) => {
      if (!node.textContent || node.textContent === 'בודק...') {
        node.textContent = 'נדרש סשן';
      }
    });
  }
}

let portfolioStream = null;
let portfolioStreamUserId = null;

function closePortfolioStream() {
  if (portfolioStream) portfolioStream.close();
  portfolioStream = null;
  portfolioStreamUserId = null;
}

function portfolioStreamUserKey(auth) {
  return auth?.user?.userId || auth?.actor?.userId || auth?.actor?.id || null;
}

function dispatchPortfolioInvalidated(detail) {
  window.dispatchEvent(new CustomEvent('navi:portfolio-snapshot-updated', {
    detail: {
      reason: detail?.reason || 'stream',
      source: 'portfolio-stream',
      eventId: detail?.eventId || null,
    },
  }));
}

function updatePortfolioStream(auth) {
  const authenticated = auth?.enabled && auth?.initialized && auth?.authenticated;
  const userKey = authenticated ? portfolioStreamUserKey(auth) : null;
  const canStream = typeof window.EventSource === 'function' && authenticated && userKey;

  if (!canStream) {
    closePortfolioStream();
    return;
  }

  // Backgrounded tab: don't open (or keep) the socket. visibilitychange
  // reopens on return and replays the invalidation the tab missed.
  if (document.hidden) {
    closePortfolioStream();
    return;
  }

  if (portfolioStream && portfolioStreamUserId === userKey) return;

  closePortfolioStream();
  portfolioStreamUserId = userKey;
  portfolioStream = new EventSource(backendPath('/api/portfolio/stream'), { withCredentials: true });
  portfolioStream.addEventListener('portfolio.snapshot_invalidated', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch {
      payload = null;
    }
    dispatchPortfolioInvalidated(payload);
  });
}

// Bell push: the server emits 'notification.new' on this stream whenever ANY process
// inserts a notification for this user (Postgres LISTEN/NOTIFY → SSE). The feed API
// owns the data, so we just refetch — no polling. Mirrors the portfolio stream.
let notificationStream = null;
let notificationStreamUserId = null;

function closeNotificationStream() {
  if (notificationStream) notificationStream.close();
  notificationStream = null;
  notificationStreamUserId = null;
}

function updateNotificationStream(auth) {
  const authenticated = auth?.enabled && auth?.initialized && auth?.authenticated;
  const userKey = authenticated ? portfolioStreamUserKey(auth) : null;
  const canStream = typeof window.EventSource === 'function' && authenticated && userKey;

  if (!canStream) {
    closeNotificationStream();
    return;
  }

  // Backgrounded tab: don't open (or keep) the socket. visibilitychange
  // reopens on return and re-fetches the feed the tab missed.
  if (document.hidden) {
    closeNotificationStream();
    return;
  }

  if (notificationStream && notificationStreamUserId === userKey) return;

  closeNotificationStream();
  notificationStreamUserId = userKey;
  notificationStream = new EventSource(backendPath('/api/me/notifications/stream'), { withCredentials: true });
  notificationStream.addEventListener('notification.new', () => { notifications?.refresh(); });
}

// ── Bell notifications ──────────────────────────────────────────────────────
// The feed API owns unread state. Claim reuses the LIVE faucet route and reconciles
// the wallet via the shared `wallet:credited` event (same as the daily-streak overlay).
// Mount-once is safe: the shell header is transition:persist'd ("site-shell"), so the
// bell node and the body-appended panel survive soft-nav.
let notifications = null;
const DAILY_STREAK_REMINDER_ID = 'daily-streak-pending';

function dailyStreakReminderItem() {
  const reminder = window.HZDailyStreakReminder;
  const state = reminder?.getState?.();
  if (!state) return null;

  return {
    id: DAILY_STREAK_REMINDER_ID,
    type: 'streak',
    bucket: 'today',
    unread: reminder?.isUnread?.() !== false,
    html: '<b>עדיין לא מימשת את מתנת הרצף היומי שלך</b>',
    time: 'עכשיו',
    claim: 'daily-streak',
    claimLabel: 'עשה זאת עכשיו',
    claimMode: 'action',
    action: 'daily-streak',
    noMarker: true,
  };
}

async function notifFetchFeed() {
  const localReminder = dailyStreakReminderItem();
  try {
    const response = await fetch(backendPath('/api/me/notifications'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return localReminder ? [localReminder] : [];
    const payload = await response.json().catch(() => null);
    const items = payload?.items || [];
    return localReminder ? [localReminder, ...items.filter((item) => item?.id !== DAILY_STREAK_REMINDER_ID)] : items;
  } catch {
    return localReminder ? [localReminder] : [];
  }
}

function notifPost(path) {
  return fetch(backendPath(path), {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
    .then((response) => (response.ok ? response.json().catch(() => null) : null))
    .catch(() => null);
}

function mountNotificationsOnce() {
  if (notifications) return;
  const bell = document.querySelector('.hz-shell__bell');
  if (!bell) return;
  notifications = mountNotifications({
    bell,
    fetchFeed: notifFetchFeed,
    onMarkRead: (id) => {
      if (id === DAILY_STREAK_REMINDER_ID) {
        window.HZDailyStreakReminder?.markRead?.();
        return Promise.resolve(null);
      }
      return notifPost(`/api/me/notifications/${encodeURIComponent(id)}/read`);
    },
    onMarkAllRead: (ids = []) => {
      if (ids.includes(DAILY_STREAK_REMINDER_ID)) window.HZDailyStreakReminder?.markRead?.();
      return notifPost('/api/me/notifications/read-all');
    },
    onClearInbox: (ids = []) => {
      if (ids.includes(DAILY_STREAK_REMINDER_ID)) window.HZDailyStreakReminder?.dismiss?.();
      return notifPost('/api/me/notifications/dismiss-all');
    },
    onDismiss: (id) => {
      if (id === DAILY_STREAK_REMINDER_ID) {
        window.HZDailyStreakReminder?.dismiss?.();
        return Promise.resolve(null);
      }
      return notifPost(`/api/me/notifications/${encodeURIComponent(id)}/dismiss`);
    },
    onClaim: (id) => {
      if (id === DAILY_STREAK_REMINDER_ID) {
        window.HZDailyStreakReminder?.open?.();
        return Promise.resolve(null);
      }
      return notifPost('/api/wallet/faucets/daily-login/claim').then(() => {
        window.dispatchEvent(new CustomEvent('wallet:credited'));
      });
    },
    settingsHref: '/settings#notifications',
    historyHref: '/settings#notifications', // dedicated /notifications history page deferred (see inbox handoff)
    options: { grouping: 'unread', density: 'compact', thumbnails: true, marker: 'dot' },
  });
}

function renderAuthState(auth) {
  const shell = document.querySelector('[data-site-shell]');
  const authenticated = auth?.enabled && auth?.initialized && auth?.authenticated;
  // Keep the pre-paint hint (Layout.astro) truthful once real auth resolves, so a
  // stale cache can't leave the user chrome stuck on after a sign-out.
  document.documentElement.dataset.authHint = authenticated ? 'user' : 'guest';
  const portfolioTab = document.querySelector('[data-shell-tab-portfolio]');

  if (shell) {
    shell.dataset.shellVariant = authenticated ? 'landing-user' : 'landing-guest';
  }

  setHidden('[data-shell-guest-actions]', authenticated);
  setHidden('[data-shell-user-actions]', !authenticated);
  // Search is no longer auth-gated — guests get it too (market search is a
  // public endpoint). Visibility is now purely the ≥768px CSS rule; no JS toggle.
  setHidden('[data-hamburger-menu="guest"]', authenticated);
  setHidden('[data-hamburger-menu="user"]', !authenticated);
  closeMenus();

  if (portfolioTab) {
    portfolioTab.href = authenticated ? '/portfolio' : '?overlay=login';
    if (authenticated) {
      portfolioTab.removeAttribute('data-overlay-open');
    } else {
      portfolioTab.setAttribute('data-overlay-open', 'login');
    }
  }

  if (!authenticated) {
    renderVerificationStatus(null);
    updatePortfolioStream(auth);
    updateNotificationStream(auth);
    notifications?.close();
    notifications?.setItems([]); // clears the unread dot on sign-out
    return;
  }

  // Avatar identity fields (name, initial, sub, avatarUrl, tier classes, badge) are now
  // owned by Preact islands (HeaderAvatar + HeaderMenuIdentity) — no vanilla writes needed.
  renderVerificationStatus(auth);
  refreshWallet();
  updatePortfolioStream(auth);
  mountNotificationsOnce();
  updateNotificationStream(auth);
  notifications?.refresh();
}

function bindLogout() {
  if (document.documentElement.dataset.hzHeaderLogoutBound) return;
  document.documentElement.dataset.hzHeaderLogoutBound = '1';
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-auth-logout]');
    if (!button) return;
    button.disabled = true;
    try {
      await window.NaviAuthSession?.logout?.();
      window.location.href = new URL('/', window.location.origin).href;
    } finally {
      button.disabled = false;
    }
  });
}

// Same-URL click guard. Clicking a link whose destination is exactly the current
// URL (logo while already on /, the active nav tab, "my profile" from your
// own profile) would otherwise trigger a same-URL ClientRouter transition (the
// "refresh" feel). Short-circuit it to a smooth scroll-to-top. Ported from the retired
// systems/front shell (wireSameLinkClicks, lost in the Astro migration).
// CAPTURE PHASE (the `true` on the listener below): Astro's ClientRouter click
// interceptor is registered first (it's in <head>) and runs in the bubble phase, so a
// bubble-phase guard here LOSES — ClientRouter preventDefaults + starts the same-URL
// transition before we ever see the click. Binding in capture makes this run first; we
// preventDefault, and ClientRouter (which respects defaultPrevented) then skips it.
function bindSameLinkClicks() {
  if (document.documentElement.dataset.hzHeaderSameLinkBound) return;
  document.documentElement.dataset.hzHeaderSameLinkBound = '1';
  document.addEventListener('click', (event) => {
    // Respect modifier-clicks (open in new tab) and non-primary mouse buttons.
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    if (anchor.hasAttribute('download')) return;
    if (anchor.target && anchor.target !== '_self') return;
    let target;
    try { target = new URL(anchor.href, window.location.href); } catch { return; }
    if (target.origin !== window.location.origin) return;
    // Hash-only links should let the browser scroll to their anchor naturally.
    if (target.hash && target.pathname === window.location.pathname && target.search === window.location.search) return;
    // Only short-circuit when the destination is exactly the current URL.
    if (target.pathname !== window.location.pathname) return;
    if (target.search !== window.location.search) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, true); // capture — beat ClientRouter's bubble-phase click interceptor
}

// Background-tab pause: this shell runs once per hard load (transition:persist),
// so a single module-level handler is correct here (no astro:page-load re-init
// needed). Hidden → close both site-wide streams (battery/data on a backgrounded
// tab buys nothing). Visible → reopen and replay each stream's own catch-up path,
// so events missed while hidden aren't silently lost: the portfolio stream's
// message just triggers a snapshot refetch (dispatchPortfolioInvalidated), and the
// notification stream's message just triggers notifications.refresh() — invoking
// those directly on regain is equivalent to "assume we missed one".
document.addEventListener('visibilitychange', () => {
  const auth = window.NaviAuthSession?.getState?.();
  if (document.hidden) {
    closePortfolioStream();
    closeNotificationStream();
    return;
  }
  if (!auth?.enabled || !auth?.initialized || !auth?.authenticated) return;
  updatePortfolioStream(auth);
  dispatchPortfolioInvalidated({ reason: 'visibility-regain' });
  updateNotificationStream(auth);
  notifications?.refresh();
});

// Cross-tab auth sync (F18): auth-session.js mirrors a timestamp/nonce-only
// BEACON to localStorage on every committed auth transition (login, logout,
// signed-out, session refresh — see emitState() there). `storage` fires in
// OTHER tabs only (never the tab that wrote it), so this can't loop back on
// itself. The beacon carries no auth payload — it only tells this tab "auth
// state changed somewhere, go check" — so the fix is to re-run the SAME
// revalidation the app already trusts: NaviAuthSession.refreshSession() hits
// /api/session for real and, on success, emits 'navi:auth-state', which
// renderAuthState() below already listens for and uses to redraw the whole
// header (guest ↔ user chrome, wallet, streams). A tab-A logout is covered
// too: tab B's refreshSession() gets a 401/unauthenticated payload and
// applySignedOut() runs the normal guest render — no separate logout-only path
// needed. The state machine itself is untouched; this only ever *triggers* it.
window.addEventListener('storage', (event) => {
  if (event.key !== 'navi.auth-beacon.v1') return;
  window.NaviAuthSession?.refreshSession?.();
});

bindLogout();
bindSameLinkClicks();
renderAuthState(window.NaviAuthSession?.getState?.());
window.addEventListener('navi:auth-state', (event) => {
  renderAuthState(event.detail || window.NaviAuthSession?.getState?.());
});
window.addEventListener('navi:portfolio-snapshot-updated', () => {
  const auth = window.NaviAuthSession?.getState?.();
  if (auth?.authenticated) refreshWallet();
});
window.addEventListener('hz:daily-streak-reminder', () => {
  const auth = window.NaviAuthSession?.getState?.();
  if (auth?.authenticated) notifications?.refresh();
});
// Decoupled wallet credit (daily-streak claim, future payouts). The overlay owns
// the celebration; the shell just pops the wallet cell and reconciles the real
// balance. The claim has already committed (POST resolved) before this fires, so
// we force a FRESH snapshot — refreshWallet()'s shared fetch caches for
// SNAPSHOT_SHARE_MS and would return the pre-credit balance. See daily-streak/.
window.addEventListener('wallet:credited', async () => {
  const cell = document.querySelector('[data-shell-wallet]');
  if (cell) {
    cell.classList.add('is-pop');
    setTimeout(() => cell.classList.remove('is-pop'), 700);
  }
  notifications?.refresh();
  try {
    const response = await fetch(backendPath('/api/portfolio/snapshot'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    const cash = payload?.summary?.availableCash;
    const valueNodes = document.querySelectorAll('[data-shell-wallet-value]');
    if (valueNodes.length && cash != null && Number.isFinite(Number(cash))) {
      const formatted = formatMoney(cash);
      const label = formatMoneyText(cash);
      valueNodes.forEach((node) => {
        node.innerHTML = formatted;
        node.dataset.hzMoneyRaw = String(cash);
        node.setAttribute('aria-label', label);
      });
      document.cookie = `navi_wallet=${encodeURIComponent(String(cash))}; path=/; max-age=3600; samesite=lax`;
    }
  } catch {
    refreshWallet();
  }
});
