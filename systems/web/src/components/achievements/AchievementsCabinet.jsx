/** Achievements cabinet (Preact island).
 *  Ships the REAL part — the verification tag-track (gray→gold→diamond ascent),
 *  wired to reputation.verification + the live purchase endpoint. Badges are a
 *  single "בקרוב" panel until the achievements backend lands
 *  (see workspace/tasks/queued/finish-achievements-integration.md).
 *  Faithful port of the drop's tag-track markup (systems/design/to-integrate/achievements). */
import { useState, useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import useDialog from '../overlay/useDialog.js';
import { VShekelAmount } from '../currency/VShekel.jsx';

const ORDER = ['gray', 'gold', 'diamond'];
const GEM = { gray: '1', gold: '2', diamond: '3' };
const tierName = (t) => (t === 'gray' ? 'אפור' : t === 'gold' ? 'זהב' : t === 'diamond' ? 'יהלום' : 'ללא רמה');
const tierNum = (t) => (t === 'gray' ? '1' : t === 'gold' ? '2' : t === 'diamond' ? '3' : '');
const pctOf = (np) => Math.max(0, Math.min(100, Math.round(((np?.progressSuccessfulReturns || 0) / (np?.requiredSuccessfulReturns || 1)) * 100)));

function backendBase() {
  const s = typeof window !== 'undefined' ? window.NaviAuthSession : null;
  return (s && typeof s.getBackendBaseUrl === 'function' && s.getBackendBaseUrl()) || '';
}

// Purchase confirmation is a "you earned it" moment — the tier medallion flips to
// ✓ and the CTA becomes a seal, but that read-diff alone is easy to miss ("nothing
// happened"). Fire the shared confetti engine from the button so the reward lands.
// Same window.HZStreakFX the trade ticket + daily streak use; reduced-motion skips it.
function firePurchaseFx(button) {
  if (typeof window === 'undefined') return;
  const FX = window.HZStreakFX;
  if (FX?.prefersReduced?.()) return;
  navigator.vibrate?.(12);
  if (!FX) return;
  const colors = FX.COLORS || {};
  const palette = [colors.amberStrong || '#f5c771', colors.amber || '#e8b257', colors.mint || '#5dd39e', colors.white || '#f6f4ef'].filter(Boolean);
  let canvas = document.querySelector('[data-hz-cabinet-fx]');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'hz-cabinet-fx';
    canvas.setAttribute('data-hz-cabinet-fx', '');
    document.body.appendChild(canvas);
  }
  const fx = FX.engine(canvas);
  const rect = button
    ? button.getBoundingClientRect()
    : { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  const y = rect.top + rect.height / 2;
  fx.confetti(rect.left + 6, y, { count: 46, power: 1.02, angle: -Math.PI * 0.72, spread: 0.92, hvel: 1.1, palette });
  fx.confetti(rect.right - 6, y, { count: 46, power: 1.02, angle: -Math.PI * 0.28, spread: 0.92, hvel: 1.1, palette });
}

function TrackRing({ tier, pct }) {
  const C = 2 * Math.PI * 44;
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const stroke = tier === 'diamond' ? '#7fd5ff' : tier === 'gold' ? 'var(--hz-brand)' : '#aeb6c4';
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,248,232,0.08)" stroke-width="6" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={stroke} stroke-width="6" stroke-linecap="round"
        stroke-dasharray={C.toFixed(1)} stroke-dashoffset={off.toFixed(1)} />
    </svg>
  );
}

export default function AchievementsCabinet({ verification: initial }) {
  const [v, setV] = useState(initial || null);
  const [stalled, setStalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [celebrate, setCelebrate] = useState(null); // { label } of just-purchased tier
  const cardRef = useRef(null);
  useDialog(cardRef, () => setOpen(false));

  // Adopt live verification from the session once hydrated (purchase elsewhere, refresh, etc.).
  // client:load can race NaviAuthSession's own init, so the first sync() may miss it and
  // there may be no later navi:auth-state event to catch it on (already-authed, no change).
  // Poll briefly for that race, then give up and show a real state instead of null forever.
  useEffect(() => {
    if (v) return;
    let tries = 0;
    const sync = () => {
      const ver = window.NaviAuthSession?.getState?.()?.currentUser?.reputation?.verification
        || window.NaviAuthSession?.getState?.()?.reputation?.verification;
      if (ver) { setV(ver); return true; }
      return false;
    };
    if (sync()) return;
    const timer = setInterval(() => {
      tries += 1;
      if (sync() || tries >= 8) {
        clearInterval(timer);
        if (tries >= 8) setStalled(true);
      }
    }, 400);
    window.addEventListener('navi:auth-state', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('navi:auth-state', sync);
    };
  }, [v]);

  // Body-scroll lock for the modal via the shared refcounter (NaviScrollLock), so
  // it composes with other overlays instead of fighting them over body.style.
  // Esc handled by useDialog above.
  useEffect(() => {
    if (!open) return undefined;
    // Resolve NaviScrollLock live off window (published by the always-mounted
    // PageOverlayHost). Not a static import: scroll-lock.js touches window at
    // module top-level, and this island is client:load (SSR'd) — importing it
    // would crash the server render.
    window.NaviScrollLock?.lock?.();
    return () => window.NaviScrollLock?.unlock?.();
  }, [open]);

  if (!v) {
    if (stalled) {
      return (
        <div class="hz-cabinet hz-cabinet--state">
          <div class="cab-state">
            <div class="cab-state-title">לא הצלחנו לטעון את ארון ההישגים</div>
            <p class="cab-state-body">אפשר לרענן את הדף ולנסות שוב.</p>
          </div>
        </div>
      );
    }
    return (
      <div class="hz-cabinet hz-cabinet--state">
        <div class="cab-state">
          <p class="cab-state-body">טוען את ארון ההישגים…</p>
        </div>
      </div>
    );
  }
  const cur = v.currentTier;
  const next = v.nextPurchase || null;
  const curIdx = ORDER.indexOf(cur);
  const headTier = next ? next.tier : cur;
  const headPct = next ? pctOf(next) : 100;

  function statusOf(tier) {
    if (next && tier === next.tier) return 'target';
    if (tier === cur) return 'current';
    if (ORDER.indexOf(tier) < curIdx) return 'done';
    return 'locked';
  }

  async function purchase(event) {
    if (!next || !next.eligible || busy) return;
    const button = event?.currentTarget || null;
    const purchasedLabel = next.label;
    setBusy(true); setErr('');
    try {
      const res = await fetch(backendBase() + '/api/me/verification-tier/purchase', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ tier: next.tier }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'purchase');
      // Endpoint returns the updated verification payload.
      const ver = data?.reputation?.verification || data?.verification || data;
      if (ver && ver.currentTier) setV(ver);
      if (window.NaviAuthSession?.refreshCurrentUser) window.NaviAuthSession.refreshCurrentUser().catch(() => {});
      // Land the reward: confetti + a transient success banner (the track re-render alone reads as "nothing happened").
      firePurchaseFx(button);
      setCelebrate({ label: purchasedLabel });
      window.setTimeout(() => setCelebrate(null), 3600);
    } catch {
      setErr('הרכישה נכשלה. נסו שוב בעוד רגע.');
    } finally {
      setBusy(false);
    }
  }

  const Medallion = ({ tier }) => {
    const st = statusOf(tier);
    let cls = 'medallion tier--' + tier;
    if (st === 'done' || st === 'current') {
      if (st === 'current') cls += ' is-now';
      return <div class={cls}><span class="gem">✓</span></div>;
    }
    if (st === 'target') {
      return <div class={cls + ' is-target'}><span class="gem">{GEM[tier]}</span><span class="lock"><span class="material-symbols-outlined">lock</span></span></div>;
    }
    return <div class={cls + ' is-locked'}><span class="gem">{GEM[tier]}</span></div>;
  };

  const Connector = ({ hi }) => {
    const st = statusOf(hi);
    if (st === 'done' || st === 'current') return <div class="ascent-link is-done" />;
    if (st === 'target' && next) {
      return (
        <div class={'ascent-link is-progress tier--' + hi}>
          <i style={`width:${pctOf(next)}%`} />
          <span class="pct-chip">{next.progressSuccessfulReturns} / {next.requiredSuccessfulReturns} הצלחות</span>
        </div>
      );
    }
    return <div class="ascent-link is-future" />;
  };

  const Label = ({ tier }) => {
    const st = statusOf(tier);
    const stat = st === 'current' ? <span class="here-tag">אתה כאן</span>
      : st === 'done' ? <span class="stat stat--done">הושלם</span>
      : st === 'target' ? <span class="stat stat--current">הדרגה הבאה</span>
      : <span class="stat stat--locked">נעול</span>;
    return <div class={'lab lab--' + tier + ' tier--' + tier}><span class="lvl">רמה {tierNum(tier)}</span><span class="nm">{tierName(tier)}</span>{stat}</div>;
  };

  const Cta = () => {
    if (!next) {
      return (
        <div class="cta is-complete tier--diamond">
          <div class="cta-copy"><div class="cta-title">השלמת את מסלול התגים</div><div class="cta-sub">רמה 3 (יהלום) היא הדרגה הגבוהה ביותר.</div></div>
          <span class="complete-seal"><span class="material-symbols-outlined">verified</span></span>
        </div>
      );
    }
    const eligible = !!next.eligible;
    return (
      <div class={'cta tier--' + next.tier + (eligible ? ' is-open' : '')}>
        <div class="cta-copy">
          <div class="cta-title">רכישת {next.label}</div>
          <div class="cta-sub">
            {eligible
              ? 'אופציית הרכישה פתוחה · השלמת את כל ההצלחות'
              : <>נפתח אחרי {next.requiredSuccessfulReturns} הצלחות · נשארו <b>{next.missingSuccessfulReturns}</b></>}
          </div>
          {err && <div class="cta-sub" style="color:var(--hz-action-sell-strong)">{err}</div>}
        </div>
        <button class="cta-btn" type="button" disabled={!eligible || busy} onClick={purchase}>
          <span class="material-symbols-outlined">{eligible ? 'shopping_bag' : 'lock'}</span>
          <span class="price">{busy ? 'רוכש…' : <VShekelAmount value={next.price} maximumFractionDigits={0} />}</span>
        </button>
      </div>
    );
  };

  return (
    <div class="hz-cabinet">
      <header class="cab-head">
        <h1 class="cab-title">ארון ההישגים</h1>
        <p class="cab-sub">המסע שלך — מסלול התגים, ובקרוב גם הישגים על דיוק עקבי.</p>
      </header>

      {/* REAL: verification tag-track */}
      <section class="tagtrack" id="cab-tagtrack">
        <button class="tagbadge" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <span class={'tagbadge-disc tier--' + headTier}>
            <TrackRing tier={headTier} pct={headPct} />
            <span class={'medallion tier--' + cur + ' tagbadge-med'}><span class="gem">✓</span></span>
          </span>
          <span class="tagbadge-body">
            <span class="tagbadge-kicker">מסלול התגים · דרגה {tierNum(cur)} / 3</span>
            <span class="tagbadge-title">הדרך לתג {tierName(headTier)}</span>
          </span>
          <span class="tagbadge-meta">
            <span class="tagbadge-count">{next ? <bdi>{next.progressSuccessfulReturns} / {next.requiredSuccessfulReturns}</bdi> : 'הושלם'}</span>
            <span class="tagbadge-go">פרטים<span class="material-symbols-outlined">chevron_left</span></span>
          </span>
        </button>
      </section>

      {/* COMING SOON: badges grid (no backend yet) */}
      <section class="cab-soon">
        <span class="material-symbols-outlined">redeem</span>
        <div class="cab-soon-body">
          <div class="cab-soon-title">הישגים — בקרוב</div>
          <p class="cab-soon-text">תגים על רצף, דיוק, היקף מסחר ועוד — בדרך. בינתיים אפשר לטפס במסלול התגים.</p>
        </div>
      </section>

      {/* Portaled to <body>: the cabinet island renders inside an <astro-island
          display:contents> wrapper, and a position:fixed descendant of a
          display:contents ancestor paints but is dropped from hit-testing in
          Chromium — every click (backdrop, card, ×) fell through to <body>, so the
          overlay could only be dismissed with Esc. Rendering at body level gives
          it a real box ancestor and restores click-to-close. */}
      {open && createPortal(
        <div class="cab-modal" onClick={(e) => { if (e.target.classList.contains('cab-modal')) setOpen(false); }}>
          <div ref={cardRef} class={'cab-modal-card cab-track-card' + (celebrate ? ' is-celebrating' : '')} role="dialog" aria-modal="true" aria-labelledby="cab-track-title">
            <button class="cab-modal-x" type="button" onClick={() => setOpen(false)} aria-label="סגור">×</button>
            <div class="track-modal-head"><span class="eyebrow">מסלול התגים</span><div id="cab-track-title" class="track-modal-title">הדרך לתג {tierName(headTier)}</div></div>
            {celebrate && (
              <div class="track-celebrate" role="status">
                <span class="material-symbols-outlined">verified</span>
                <span>קיבלת את תג {celebrate.label} — כל הכבוד!</span>
              </div>
            )}
            <div class="ascent">
              <div class="ascent-track"><Medallion tier="gray" /><Connector hi="gold" /><Medallion tier="gold" /><Connector hi="diamond" /><Medallion tier="diamond" /></div>
              <div class="ascent-labels"><Label tier="gray" /><Label tier="gold" /><Label tier="diamond" /></div>
              <Cta />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
