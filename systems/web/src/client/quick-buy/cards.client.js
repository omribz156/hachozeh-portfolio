const MOBILE = '(max-width: 960px)';

function cardHref(card) {
  const link = card?.querySelector?.('.hz-card__link');
  return card?.dataset?.marketHref || link?.href || '';
}

function cardTitle(button, card) {
  return (
    button.dataset.quickbuyTitle
    || card?.querySelector?.('.hz-card__title')?.textContent?.trim()
    || ''
  );
}

function openQuickBuy(button, card) {
  const marketKey = button.dataset.quickbuyMarketKey || card?.dataset?.marketKey;
  const ticket = window.NaviTradeTicket;
  if (!marketKey || typeof ticket?.open !== 'function') return false;
  ticket.open({
    marketKey,
    outcomeId: button.dataset.quickbuyOutcomeId || undefined,
    side: button.dataset.quickbuySide || 'yes',
    title: cardTitle(button, card),
  });
  return true;
}

function installQuickBuyCards() {
  if (window.__hachozehQuickBuyCardsInstalled) return;
  window.__hachozehQuickBuyCardsInstalled = true;
  const mobileQuery = window.matchMedia(MOBILE);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-quickbuy]');
    if (!(button instanceof HTMLElement)) return;
    const card = button.closest('.hz-card');
    const href = cardHref(card);

    if (!mobileQuery.matches) {
      // Respect modifier-clicks (open in new tab/window) and non-primary mouse
      // buttons (middle-click) — same guard as the shell's same-URL handler
      // (header-session.client.js bindSameLinkClicks). Without this, a
      // ctrl/cmd-click on a quick-buy pill hijacked the modified click into a
      // same-tab navigation instead of falling through to default browser behavior.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      if (href) window.location.assign(href);
      return;
    }

    if (!openQuickBuy(button, card)) {
      if (href) window.location.assign(href);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  });
}

installQuickBuyCards();

// ── card bookmark (save) ─────────────────────────────────────────────────────
// The bookmark glyph on every market card toggles the same per-user save seam
// the market-detail page uses (POST/DELETE /api/markets/:key/save). Saved cards
// surface in the results-page "saved" view. Delegated + guarded so it survives
// ClientRouter soft-nav; saved state is painted from /api/markets/saved on load.
function paintCardBookmark(button, on) {
  button.classList.toggle('is-saved', on);
  button.setAttribute('aria-pressed', String(on));
  button.title = on ? 'שמור' : 'שמירה';
}

function openSignupForSave() {
  if (window.NaviOverlays && typeof window.NaviOverlays.open === 'function') window.NaviOverlays.open('signup');
  else window.location.assign('?overlay=signup');
}

// Reach the backend directly (same seam the header/follow use), falling back to
// a relative path when the base isn't published yet.
function saveBackendBase() {
  const s = window.NaviAuthSession;
  return (s && typeof s.getBackendBaseUrl === 'function' && s.getBackendBaseUrl()) || '';
}

async function refreshSavedCardState() {
  // Only authed viewers have saves; skip the fetch for guests.
  if (document.documentElement.dataset.authHint !== 'user') return;
  let keys;
  try {
    const res = await fetch(saveBackendBase() + '/api/markets/saved', { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    keys = new Set((data && Array.isArray(data.markets) ? data.markets : []).map((m) => m.id));
  } catch {
    return;
  }
  document.querySelectorAll('.hz-card__bookmark').forEach((button) => {
    const card = button.closest('[data-market-key]');
    const key = card && card.dataset.marketKey;
    if (key) paintCardBookmark(button, keys.has(key));
  });
}

function installCardBookmarks() {
  if (window.__hachozehCardBookmarksInstalled) return;
  window.__hachozehCardBookmarksInstalled = true;

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.hz-card__bookmark');
    if (!(button instanceof HTMLElement)) return;
    // The card link overlays the card; keep the tap on the bookmark itself.
    event.preventDefault();
    event.stopPropagation();
    if (document.documentElement.dataset.authHint !== 'user') { openSignupForSave(); return; }
    const card = button.closest('[data-market-key]');
    const key = card && card.dataset.marketKey;
    if (!key || button.dataset.busy === '1') return;
    const was = button.classList.contains('is-saved');
    const next = !was;
    button.dataset.busy = '1';
    paintCardBookmark(button, next); // optimistic
    try {
      const res = await fetch(`${saveBackendBase()}/api/markets/${encodeURIComponent(key)}/save`, {
        method: next ? 'POST' : 'DELETE',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (res.status === 401) { paintCardBookmark(button, was); openSignupForSave(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json().catch(() => null);
      if (payload && typeof payload.saved === 'boolean') paintCardBookmark(button, payload.saved);
    } catch {
      paintCardBookmark(button, was); // revert
    } finally {
      button.dataset.busy = '';
    }
  });

  // Paint initial saved state, and re-paint after each soft-nav (new cards).
  refreshSavedCardState();
  document.addEventListener('astro:page-load', refreshSavedCardState);
}

installCardBookmarks();
