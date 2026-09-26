import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { VShekelAmount, VShekelProbabilityPrice, VShekelSymbol } from '../currency/VShekel.jsx';
import { fetchSnapshot } from './snapshot-fetch.js';
import { postJSON } from './trade-request.js';

// TradeTicket.jsx — 1:1 Preact port of trade-ticket.client.js.
// Same logic, same DOM shape, same data-* attributes.
// Manual state→DOM sync replaced with Preact state + effects.
// All behavior, guards, error codes, and edge cases are preserved exactly.

const QUOTE_DEBOUNCE_MS = 400;
const BUY_CHIPS = [10, 100, 1000];
const CHIP_PORTIONS = [0.25, 0.5, 0.75, 1];
const portionLabel = (portion) => (portion === 1 ? 'הכל' : `${Math.round(portion * 100)}%`);
const shares = (n) =>
  Number(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const ERROR_COPY = {
  quote_expired: 'המחיר זז. נסה שוב.',
  quote_not_found: 'המחיר זז. נסה שוב.',
  market_state_changed: 'השוק זז בינתיים. נסה שוב.',
  market_closed: 'השוק סגור למסחר.',
  outcome_not_found: 'אופציה לא נמצאה.',
  insufficient_cash: 'אין מספיק יתרה לביצוע הקנייה.',
  insufficient_shares: 'אין מספיק חוזים למכירה.',
  unauthorized: 'צריך להתחבר כדי לסחור.',
  forbidden: 'אין הרשאת מסחר בחשבון הזה.',
};
const errorText = (code) => ERROR_COPY[code] || 'משהו השתבש. נסה שוב.';

// Network-drop trust probe: a trade POST can fail with no structured error
// code from the backend in exactly two cases — the fetch itself threw
// (connection dropped, DNS blip, offline) or it was aborted by our own
// timeout. Both are "the request may never have reached the server, or its
// response never reached us" — never confuse this with a coded rejection
// (insufficient_cash, market_closed, etc.), which always carries err.code.
function isNetworkClassError(err) {
  return !err?.code;
}

const TRADE_STATUS_TIMEOUT_MS = 3000;
const QUOTE_REQUEST_TIMEOUT_MS = 8000;
const TRADE_REQUEST_TIMEOUT_MS = 12000;

// Definite-state copy for the moment right after a network-class trade
// failure. Calm, no drama — this is the scariest moment in the product, so
// it reads like a sharp desk stating what it knows, not apologizing.
const TRADE_STATUS_COPY = {
  notExecuted: 'לא בוצע. אפשר לנסות שוב.',
  checkFailed: 'לא הצלחנו לוודא. בדקו בתיק.',
};

// Queries the definite-state endpoint with the SAME idempotency key the
// trade was submitted with. Never retried automatically — this is a read,
// the caller decides what to do with the answer. Aborts after ~3s so an
// already-flaky connection doesn't leave the user staring at "שולח…"
// indefinitely; a timeout here reads the same as a check failure.
async function fetchTradeStatus(marketKey, idempotencyKey) {
  const r = await fetch(
    `/api/markets/${encodeURIComponent(marketKey)}/trades/status?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
    {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(TRADE_STATUS_TIMEOUT_MS),
    },
  );
  if (!r.ok) throw new Error(`status check failed (${r.status})`);
  return r.json();
}

function parseOutcomes(rawOutcomes, fallback) {
  try {
    const parsed = JSON.parse(rawOutcomes || '[]');
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map((outcome) => ({
          id: String(outcome?.id || ''),
          label: String(outcome?.label || outcome?.id || ''),
          price: Number(outcome?.price || 0),
          color: outcome?.color ?? outcome?.colorPrimary ?? null,
          crestPath: outcome?.crestPath ?? null,
        }))
        .filter((outcome) => outcome.id);
    }
  } catch {
    // Fall through to binary fallback.
  }
  return fallback ? [fallback] : [];
}

function makeIdempotencyKey(marketKey, contractSide, amount) {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID)
    return window.crypto.randomUUID();
  let h = 0;
  const s = marketKey + contractSide + amount + performance.now();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'idem-' + Math.abs(h);
}

function openSignupOverlay() {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.dataset.overlayOpen = 'signup';
  trigger.style.display = 'none';
  document.body.appendChild(trigger);
  trigger.click();
  trigger.remove();
}

function playTradeSuccessFx(button, side) {
  if (typeof window === 'undefined' || !button) return;
  const root = button.closest('[data-hz-ticket]');
  const FX = window.HZStreakFX;
  const reduced = FX?.prefersReduced?.()
    || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduced) return;

  // Same gate as the confetti below — a buy/sell confirmation is a "motion" cue,
  // so reduced-motion users skip both. One-shot, no pattern (10ms tick, not a buzz).
  navigator.vibrate?.(10);

  const rect = button.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const x = rect.left + rect.width / 2;
  const teamColor = root ? getComputedStyle(root).getPropertyValue('--cta-team').trim() : '';
  const colors = FX?.COLORS || {
    amber: '#e8b257',
    amberStrong: '#f5c771',
    mint: '#5dd39e',
    rose: '#e77a8a',
    white: '#f6f4ef',
  };
  const palette = [
    teamColor || (side === 'sell' ? colors.rose : colors.mint),
    colors.amber,
    colors.amberStrong,
    colors.white,
  ].filter(Boolean);

  if (!FX) {
    playTradeFallbackFx(rect, palette);
    return;
  }

  let canvas = document.querySelector('[data-hz-trade-fx]');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'hz-trade-fx';
    canvas.setAttribute('data-hz-trade-fx', '');
    document.body.appendChild(canvas);
  }
  const fx = FX.engine(canvas);
  fx.confetti(rect.right - 6, y, {
    count: 58,
    power: 1.08,
    angle: -Math.PI * 0.48,
    spread: 1.18,
    hvel: 0.88,
    palette,
  });
  fx.confetti(x, rect.top + 4, {
    count: 34,
    power: 0.96,
    angle: -Math.PI / 2,
    spread: 0.92,
    hvel: 0.7,
    palette,
  });
  window.setTimeout(() => fx.confetti(rect.left + rect.width * 0.34, rect.top + 6, {
    count: 26,
    power: 0.86,
    angle: -Math.PI * 0.62,
    spread: 0.78,
    hvel: 0.72,
    palette,
  }), 90);
  window.setTimeout(() => fx.burst(x, rect.top + rect.height * 0.28, {
    count: 26,
    speed: 3.7,
    palette,
  }), 120);
}

function playTradeFallbackFx(rect, palette) {
  const layer = document.createElement('div');
  layer.className = 'hz-trade-fallback-fx';
  const originX = rect.right - 8;
  const originY = rect.top + rect.height / 2;
  for (let i = 0; i < 42; i += 1) {
    const piece = document.createElement('span');
    const spread = -115 + Math.random() * 170;
    const lift = -78 - Math.random() * 138;
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.setProperty('--tx', `${spread}px`);
    piece.style.setProperty('--ty', `${lift}px`);
    piece.style.setProperty('--rot', `${-160 + Math.random() * 320}deg`);
    piece.style.setProperty('--c', palette[i % palette.length] || '#f5c771');
    piece.style.animationDelay = `${Math.random() * 90}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 950);
}

const sanitizeAmount = (raw) => {
  let s = String(raw).replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    const intPart = s.slice(0, dot);
    const decPart = s
      .slice(dot + 1)
      .replace(/\./g, '')
      .slice(0, 2);
    s = `${intPart}.${decPart}`;
  }
  return s;
};

function numericAmount(amount) {
  const n = parseFloat(String(amount).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function addHolding(holdings, side, position) {
  const sharesValue = Number(position?.shares || position?.quantity || 0);
  if (Number.isFinite(sharesValue) && sharesValue > 0) holdings[side] += sharesValue;
}

function ensureOutcomeHoldings(map, outcomeKey) {
  const key = String(outcomeKey || '');
  if (!map[key]) map[key] = { yes: 0, no: 0 };
  return map[key];
}

function readHoldings(snapshot, marketKey, canonical, noOutcome) {
  const holdings = { yes: 0, no: 0 };
  const holdingsByOutcome = {};
  for (const position of snapshot?.positions || []) {
    if (position.marketKey !== marketKey) continue;
    const outcomeHoldings = ensureOutcomeHoldings(holdingsByOutcome, position.outcomeKey);
    // FIX: bucket by position.contractSide (NOT hardcoded 'yes') — multi "no" positions
    addHolding(outcomeHoldings, position.contractSide === 'no' ? 'no' : 'yes', position);
    if (position.outcomeKey === canonical) addHolding(holdings, 'yes', position);
    else if (noOutcome && position.outcomeKey === noOutcome) addHolding(holdings, 'no', position);
  }
  return { holdings, holdingsByOutcome };
}

// ---- auth helpers (stateless, take auth arg) --------------------------------
const authEnabled = () =>
  typeof window !== 'undefined' && window.NaviAuthSession?.isEnabled?.() === true;

function getRestriction(auth) {
  const a = auth;
  if (!a) return null;
  if (authEnabled() && !a.loading && !a.authenticated) {
    return {
      title: 'צריך להתחבר בשביל מסחר חי',
      message: '',
      actionLabel: 'התחברות',
      actionOverlay: 'login',
    };
  }
  if (a.currentUserError) {
    return {
      title: 'לא הצלחנו לאמת את מצב החשבון',
      message:
        'החיבור קיים, אבל מצב המשתמש לא נטען. רענן את הדף או התחבר מחדש לפני מסחר חי.',
    };
  }
  if (!a.authenticated || a.capabilities?.canTrade === true) return null;
  if (a.user?.tradeAccessStatus === 'blocked') {
    return {
      title: 'המסחר חסום לחשבון הזה',
      message:
        'אפשר להמשיך לקרוא את השוק ולעקוב אחרי הפוזיציות, אבל אי אפשר לבצע כרגע קנייה או מכירה מהחשבון הזה.',
    };
  }
  if (a.user?.status && a.user.status !== 'active') {
    return {
      title: 'החשבון לא פתוח למסחר',
      message:
        'השוק נשאר קריא, אבל פעולות מסחר חדשות סגורות עד שהחשבון יחזור למצב פעיל.',
    };
  }
  return null;
}

function isCapabilityPending(auth) {
  return authEnabled() && auth?.loading === true;
}

function isTradeGuest(auth) {
  return authEnabled() && Boolean(auth) && !auth.loading && !auth.authenticated;
}

function blockingRestriction(auth) {
  return isTradeGuest(auth) ? null : getRestriction(auth);
}

function isGated(auth) {
  return Boolean(blockingRestriction(auth)) || isCapabilityPending(auth);
}

// ---- AccessNotice sub-component (replaces renderNotice DOM building) --------
function AccessNotice({ restriction, pending }) {
  if (!restriction && !pending) return null;
  if (restriction) {
    return (
      <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
        <div class="font-black text-amber-100 mb-1">{restriction.title}</div>
        {restriction.message && <div class="leading-7">{restriction.message}</div>}
        {restriction.actionOverlay && (
          <button
            type="button"
            class="mt-3 inline-flex items-center justify-center rounded-lg bg-black/20 px-3 py-2 text-[11px] font-black text-off-white transition hover:bg-black/30"
            data-overlay-open={restriction.actionOverlay}
          >
            {restriction.actionLabel || 'פתח'}
          </button>
        )}
      </div>
    );
  }
  // pending
  return (
    <div class="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
      <div class="font-black mb-1">בודק הרשאת מסחר</div>
    </div>
  );
}

// ---- QuickChips sub-component -----------------------------------------------
function QuickChips({ orderSide, amount, activeHolding, isOpen, gated, availableCash, onChipClick }) {
  const buy = orderSide === 'buy';
  if (!buy && activeHolding <= 0) return <div class="grid grid-cols-4 gap-2" data-order-quick-chips />;

  const numAmt = numericAmount(amount);
  const disabled = !isOpen || gated;

  const values = buy
    ? [
        // Increment chips: tapping ADDS to the amount (kind: 'inc'); rendered as "+V₪ N".
        ...BUY_CHIPS.map((value) => ({ value, kind: 'inc' })),
        // "All" sets the amount to the full available cash (kind: 'max').
        { value: Math.floor(availableCash), kind: 'max', label: 'הכל' },
      ]
    : CHIP_PORTIONS.map((portion) => ({
        value: activeHolding * portion,
        kind: 'portion',
        label: portionLabel(portion),
      }));

  return (
    <div class="grid grid-cols-4 gap-2" data-order-quick-chips>
      {values.map((item, i) => {
        const chipValue = buy ? String(item.value) : item.value.toFixed(6);
        const isInc = item.kind === 'inc';
        // 'max' / 'portion' are "set to" actions → can read as active when the
        // amount matches. Increment chips are momentary "+" buttons → never sticky.
        const active = !isInc && numAmt > 0 && Math.abs(item.value - numAmt) < 1e-6;
        return (
          <button
            key={`${item.kind}-${chipValue}-${i}`}
            type="button"
            class={`hz-quick-chip${active ? ' hz-quick-chip--active' : ''}${isInc ? ' hz-quick-chip--inc' : ''}`}
            data-quick-value={chipValue}
            data-quick-kind={item.kind}
            disabled={disabled}
            onClick={() => onChipClick(chipValue, item.kind)}
          >
            {isInc ? (
              <>
                <span class="hz-quick-chip__plus">+</span>
                <VShekelSymbol />
                <span class="hz-quick-chip__num">{item.value.toLocaleString('en-US')}</span>
              </>
            ) : (
              item.label
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Main component ---------------------------------------------------------
export default function TradeTicket({
  mode,
  marketKey: initMarketKey,
  canonicalOutcomeId: initCanonical,
  noOutcomeId: initNoOutcome,
  yesLabel,
  noLabel,
  yesPrice: initYesPrice,
  noPrice: initNoPrice,
  marketStatus: initMarketStatus,
  outcomes: initOutcomes,
  selectedOutcome: initSelectedOutcome,
  title: initTitle,
  yesColor = null,
  noColor = null,
  yesColorOn = null,
  noColorOn = null,
  yesCrest = null,
  noCrest = null,
  marketCrest = null,
  // Quick-buy: preselect the side the user tapped on the card (כן→'yes', לא→'no').
  // Defaults to 'yes' so the market-detail mount is unchanged.
  initialContractSide = 'yes',
}) {
  const isMulti = mode === 'multi';

  // --- cfg (mutable ref, mirrors legacy cfg object) -------------------------
  // Retarget mutates this without causing a re-render (same as legacy closure mutation).
  // State-derived renders pick up changes because state setters trigger the re-render.
  const cfgRef = useRef({
    mode: mode === 'multi' ? 'multi' : 'binary',
    marketKey: initMarketKey,
    canonical: initCanonical || '',
    noOutcome: initNoOutcome || '',
    yesLabel: yesLabel || 'כן',
    noLabel: noLabel || 'לא',
    yesPrice: Number(initYesPrice) || 0,
    noPrice: Number(initNoPrice) || 0,
    yesCrest: yesCrest || null,
    noCrest: noCrest || null,
    isOpen: (initMarketStatus || 'open') === 'open',
  });

  // Build initial outcomes exactly as legacy does
  const buildInitialOutcomes = () => {
    const cfg = cfgRef.current;
    return parseOutcomes(
      JSON.stringify(initOutcomes || []),
      { id: cfg.canonical, label: cfg.yesLabel, price: cfg.yesPrice },
    );
  };
  cfgRef.current.outcomes = buildInitialOutcomes();

  // --- component state ------------------------------------------------------
  const [orderSide, setOrderSide] = useState('buy');
  const [contractSide, setContractSide] = useState(initialContractSide === 'no' ? 'no' : 'yes');
  const [selectedOutcomeId, setSelectedOutcomeId] = useState(
    initSelectedOutcome || cfgRef.current.canonical || cfgRef.current.outcomes[0]?.id || '',
  );
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteStatus, setQuoteStatus] = useState('idle'); // idle|loading|success|error
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }
  const [tradeCelebration, setTradeCelebration] = useState(null); // buy|sell|null
  const [auth, setAuth] = useState(
    () => (typeof window !== 'undefined' && window.NaviAuthSession?.getState?.()) || null,
  );
  const [holdings, setHoldings] = useState({ yes: 0, no: 0 });
  const [holdingsByOutcome, setHoldingsByOutcome] = useState({});
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [availableCash, setAvailableCash] = useState(0);

  // Context title for retarget (binary only — shows in data-binary-context-title)
  const [contextTitle, setContextTitle] = useState(initTitle || '');

  // Pill prices (yesPrice / noPrice) track cfgRef but need a render trigger
  const [pillPrices, setPillPrices] = useState({
    yes: Number(initYesPrice) || 0,
    no: Number(initNoPrice) || 0,
  });

  // isOpen tracks cfgRef.isOpen but needs a render trigger
  const [isOpen, setIsOpen] = useState((initMarketStatus || 'open') === 'open');

  // outcomes needs a render trigger for multi price updates & retarget
  const [outcomes, setOutcomes] = useState(() => cfgRef.current.outcomes);

  // input DOM ref — needed for programmatic .value = '' and .focus()
  const inputRef = useRef(null);
  const submitButtonRef = useRef(null);
  // Stable per-instance id for the amount-requirement hint, wired via
  // aria-describedby on the submit button when it's enabled-but-empty (see
  // needsAmount below) — one TradeTicket instance mounts at a time in practice
  // (market-detail sidebar/sheet XOR quick-buy sheet), but useId-style
  // uniqueness costs nothing.
  const amountHintIdRef = useRef(`hz-trade-amount-hint-${Math.random().toString(36).slice(2)}`);
  const tradeCelebrationTimerRef = useRef(null);
  // root host ref — for _hzTicket retarget handle
  const hostRef = useRef(null);

  // quote timer and sequence refs (not state — don't cause re-renders)
  const quoteTimerRef = useRef(null);
  const quoteSeqRef = useRef(0);

  // --- derived helpers (need current state/cfg) ----------------------------
  const getActiveOutcome = useCallback(
    (outcomesList, outcomeId) => {
      const cfg = cfgRef.current;
      return (
        outcomesList.find((o) => o.id === outcomeId) ||
        outcomesList[0] ||
        { id: cfg.canonical, label: cfg.yesLabel, price: cfg.yesPrice }
      );
    },
    [],
  );

  const getActiveSidePrice = useCallback(
    (outcomesList, outcomeId, side) => {
      const cfg = cfgRef.current;
      if (cfg.mode === 'binary') return side === 'yes' ? cfg.yesPrice : cfg.noPrice;
      const outcome = getActiveOutcome(outcomesList, outcomeId);
      const price = Number(outcome.price || 0);
      return side === 'yes' ? price : Math.max(0, 1 - price);
    },
    [getActiveOutcome],
  );

  const getActiveHolding = useCallback(
    (outcomesList, outcomeId, side) => {
      const cfg = cfgRef.current;
      if (cfg.mode === 'binary') return Number(holdings[side] || 0);
      return Number(holdingsByOutcome[outcomeId]?.[side] || 0);
    },
    [holdings, holdingsByOutcome],
  );

  // --- holdings fetch -------------------------------------------------------
  const refreshHoldings = useCallback(async (options = {}) => {
    const a = typeof window !== 'undefined' && window.NaviAuthSession?.getState?.();
    if (authEnabled() && a?.initialized && !a.authenticated) {
      setHoldings({ yes: 0, no: 0 });
      return;
    }
    setHoldingsLoading(true);
    try {
      const snapshot = await fetchSnapshot(options);
      const cfg = cfgRef.current;
      const next = readHoldings(snapshot, cfg.marketKey, cfg.canonical, cfg.noOutcome);
      setHoldings(next.holdings);
      setHoldingsByOutcome(next.holdingsByOutcome);
      setAvailableCash(
        Number((snapshot?.snapshot || snapshot)?.summary?.availableCash) || 0,
      );
    } catch {
      setHoldings({ yes: 0, no: 0 });
      setHoldingsByOutcome({});
    } finally {
      setHoldingsLoading(false);
    }
  }, []);

  // --- quote scheduling (stale-guarded) ------------------------------------
  // We need refs to current state values for the async quote callbacks.
  const orderSideRef = useRef(orderSide);
  const contractSideRef = useRef(contractSide);
  const selectedOutcomeIdRef = useRef(selectedOutcomeId);
  const amountRef = useRef(amount);
  const outcomesRef = useRef(outcomes);

  useEffect(() => { orderSideRef.current = orderSide; }, [orderSide]);
  useEffect(() => { contractSideRef.current = contractSide; }, [contractSide]);
  useEffect(() => { selectedOutcomeIdRef.current = selectedOutcomeId; }, [selectedOutcomeId]);
  useEffect(() => { amountRef.current = amount; }, [amount]);
  // Size the amount input to its content so it can sit CENTERED next to the V₪
  // mark in the mobile sheet (where width is auto). No-op on desktop, where the
  // input is width:100% and `size` is ignored. `size` must be ≥1.
  useEffect(() => {
    if (inputRef.current) inputRef.current.size = Math.max(1, String(amount || '').length);
  }, [amount]);
  useEffect(() => { outcomesRef.current = outcomes; }, [outcomes]);

  const buildQuoteBody = useCallback(() => {
    const side = contractSideRef.current;
    const oSide = orderSideRef.current;
    const outcomeId =
      getActiveOutcome(outcomesRef.current, selectedOutcomeIdRef.current).id;
    const base = { outcomeKey: outcomeId, contractSide: side };
    const amt = numericAmount(amountRef.current);
    return oSide === 'buy'
      ? { side: 'buy', ...base, cashAmount: amt.toFixed(2) }
      : { side: 'sell', ...base, shareAmount: amt.toFixed(6) };
  }, [getActiveOutcome]);

  const buildGuestBuyQuote = useCallback(() => {
    const cashAmount = numericAmount(amountRef.current);
    const price = getActiveSidePrice(
      outcomesRef.current,
      selectedOutcomeIdRef.current,
      contractSideRef.current,
    );
    if (!Number.isFinite(cashAmount) || cashAmount <= 0 || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    return {
      quoteId: 'guest-preview',
      shareAmount: cashAmount / price,
      cashAmount,
      averagePrice: price,
      marketStateVersion: null,
    };
  }, [getActiveSidePrice]);

  const authRef = useRef(auth);
  useEffect(() => { authRef.current = auth; }, [auth]);

  const isSellOverHoldingNow = useCallback(
    (amt, outcomesList, outcomeId, side, oSide) => {
      return (
        oSide === 'sell' &&
        numericAmount(amt) > getActiveHolding(outcomesList, outcomeId, side)
      );
    },
    [getActiveHolding],
  );

  const runQuote = useCallback(async (seq) => {
    if (numericAmount(amountRef.current) <= 0) {
      if (seq !== quoteSeqRef.current) return;
      setQuote(null);
      setQuoteStatus('idle');
      return;
    }
    const cfg = cfgRef.current;
    const curAuth = authRef.current;
    if (isTradeGuest(curAuth) && orderSideRef.current === 'buy') {
      const q = buildGuestBuyQuote();
      if (seq !== quoteSeqRef.current) return;
      setQuote(q);
      setQuoteStatus(q ? 'success' : 'idle');
      setMessage(null);
      return;
    }
    try {
      const q = await postJSON(
        `/api/markets/${encodeURIComponent(cfg.marketKey)}/quote`,
        buildQuoteBody(),
        QUOTE_REQUEST_TIMEOUT_MS,
      );
      if (seq !== quoteSeqRef.current) return;
      setQuote(q);
      setQuoteStatus('success');
      setMessage(null);
    } catch (err) {
      if (seq !== quoteSeqRef.current) return;
      setQuote(null);
      setQuoteStatus('error');
      setMessage({ tone: 'error', text: errorText(err.code) });
    }
  }, [buildGuestBuyQuote, buildQuoteBody]);

  const scheduleQuote = useCallback(
    (curAmt, curOutcomes, curOutcomeId, curSide, curOrderSide, curAuth) => {
      clearTimeout(quoteTimerRef.current);
      const cfg = cfgRef.current;
      const amt = numericAmount(curAmt);
      const sellOver = isSellOverHoldingNow(curAmt, curOutcomes, curOutcomeId, curSide, curOrderSide);
      if (!cfg.isOpen || amt <= 0 || isGated(curAuth) || sellOver) {
        setQuote(null);
        setQuoteStatus('idle');
        return;
      }
      setQuoteStatus('loading');
      const seq = ++quoteSeqRef.current;
      quoteTimerRef.current = setTimeout(() => runQuote(seq), QUOTE_DEBOUNCE_MS);
    },
    [isSellOverHoldingNow, runQuote],
  );

  // Shared "this trade is confirmed executed" resolution — used by the happy
  // path (trade POST resolved normally) and by the network-drop recovery path
  // (trade POST was lost, but the status probe found the receipt). `quote` is
  // null in the recovery case (we only have the receipt, not a fresh quote),
  // so the summary total is skipped — the celebration + submit-button
  // confirmation is what carries the "definite, honest, executed" message.
  const resolveTradeExecuted = useCallback(async ({ trade, quote: q, oSide }) => {
    if (q) {
      setQuote(q);
      setQuoteStatus('success');
    }
    setMessage(null);
    clearTimeout(tradeCelebrationTimerRef.current);
    setTradeCelebration(oSide);
    try {
      playTradeSuccessFx(submitButtonRef.current, oSide);
    } catch (postTradeError) {
      console.warn('[trade-ticket] success effect failed after accepted trade', postTradeError);
    }
    tradeCelebrationTimerRef.current = window.setTimeout(() => {
      setTradeCelebration(null);
    }, 1250);
    setAmount('');
    amountRef.current = '';
    clearTimeout(quoteTimerRef.current);
    quoteSeqRef.current += 1;
    if (inputRef.current) inputRef.current.value = '';
    await refreshHoldings({ forceFresh: true });
    if (hostRef.current) {
      hostRef.current.dispatchEvent(
        new CustomEvent('hz:trade-complete', { bubbles: true, detail: { trade, quote: q } }),
      );
    }
    window.dispatchEvent(
      new CustomEvent('navi:portfolio-snapshot-updated', { detail: { reason: 'trade' } }),
    );
  }, [refreshHoldings]);

  // --- submit ---------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    const cfg = cfgRef.current;
    const curAuth = authRef.current;
    if (isTradeGuest(curAuth)) { openSignupOverlay(); return; }
    const amt = numericAmount(amountRef.current);
    const outcomesList = outcomesRef.current;
    const outcomeId = selectedOutcomeIdRef.current;
    const side = contractSideRef.current;
    const oSide = orderSideRef.current;
    if (
      submitting ||
      amt <= 0 ||
      !cfg.isOpen ||
      isGated(curAuth) ||
      isSellOverHoldingNow(amountRef.current, outcomesList, outcomeId, side, oSide)
    )
      return;
    setSubmitting(true);
    clearTimeout(quoteTimerRef.current);
    quoteSeqRef.current += 1;
    setMessage(null);
    let idempotencyKey = null;
    try {
      const body = buildQuoteBody();
      const q = await postJSON(
        `/api/markets/${encodeURIComponent(cfg.marketKey)}/quote`,
        body,
        QUOTE_REQUEST_TIMEOUT_MS,
      );
      idempotencyKey = makeIdempotencyKey(cfg.marketKey, side, amountRef.current);
      const trade = await postJSON(
        `/api/markets/${encodeURIComponent(cfg.marketKey)}/trades`,
        {
          ...body,
          idempotencyKey,
          quoteId: q.quoteId,
          quotedAt: q.quotedAt,
          quoteExpiresAt: q.expiresAt,
          expectedMarketStateVersion: q.marketStateVersion,
        },
        TRADE_REQUEST_TIMEOUT_MS,
      );
      await resolveTradeExecuted({ trade, quote: q, oSide });
    } catch (err) {
      // Same seq/timer invalidation as the happy path above (commit
      // e54478a55) — a stale in-flight quote timer must not race this catch
      // and stomp whatever message we're about to show. Belt-and-braces: the
      // guard already lives at the top of handleSubmit, this just protects
      // the network-status detour below (which awaits, giving more time for
      // a stale timer to have been scheduled — though none can post-dated
      // this point since scheduleQuote is only ever triggered by user input).
      clearTimeout(quoteTimerRef.current);
      quoteSeqRef.current += 1;

      if (isNetworkClassError(err) && idempotencyKey) {
        // The trade POST itself never confirmed success or failure — ask the
        // backend directly with the same key rather than guessing. Never
        // auto-retry the money POST; this is a read.
        try {
          const status = await fetchTradeStatus(cfg.marketKey, idempotencyKey);
          if (status?.status === 'executed') {
            await resolveTradeExecuted({ trade: status.receipt, quote: null, oSide });
          } else {
            setMessage({ tone: 'error', text: TRADE_STATUS_COPY.notExecuted });
          }
        } catch (statusErr) {
          console.warn('[trade-ticket] trade status check failed', statusErr);
          setMessage({
            tone: 'error',
            text: TRADE_STATUS_COPY.checkFailed,
            href: '/portfolio',
          });
        }
      } else {
        setMessage({ tone: 'error', text: errorText(err.code) });
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitting, buildQuoteBody, isSellOverHoldingNow, refreshHoldings, getActiveOutcome, resolveTradeExecuted]);

  useEffect(() => () => clearTimeout(tradeCelebrationTimerRef.current), []);

  // --- applyMarketSnapshot (live price updates) ----------------------------
  const applyMarketSnapshot = useCallback((payload) => {
    const prices = Array.isArray(payload?.prices) ? payload.prices : [];
    if (!prices.length) return false;
    const cfg = cfgRef.current;
    let changed = false;
    const priceByOutcome = new Map(
      prices.map((item) => [String(item.outcomeKey || item.outcomeId || ''), Number(item.price)]),
    );
    const readPrice = (key, fallback) => {
      const value = priceByOutcome.get(String(key || ''));
      return Number.isFinite(value) ? value : fallback;
    };

    if (cfg.mode === 'binary') {
      const nextYes = readPrice(cfg.canonical, cfg.yesPrice);
      const nextNo = cfg.noOutcome
        ? readPrice(cfg.noOutcome, cfg.noPrice)
        : Math.max(0, 1 - nextYes);
      changed =
        Math.abs(nextYes - cfg.yesPrice) > 1e-9 || Math.abs(nextNo - cfg.noPrice) > 1e-9;
      cfg.yesPrice = nextYes;
      cfg.noPrice = nextNo;
      if (hostRef.current) {
        hostRef.current.dataset.yesPrice = String(nextYes);
        hostRef.current.dataset.noPrice = String(nextNo);
      }
      setPillPrices({ yes: nextYes, no: nextNo });
    } else {
      const nextOutcomes = outcomesRef.current.map((outcome) => {
        const nextPrice = readPrice(outcome.id, outcome.price);
        if (Math.abs(nextPrice - Number(outcome.price || 0)) > 1e-9) changed = true;
        return { ...outcome, price: nextPrice };
      });
      cfg.outcomes = nextOutcomes;
      if (hostRef.current)
        hostRef.current.dataset.outcomes = JSON.stringify(nextOutcomes);
      setOutcomes(nextOutcomes);
    }

    if (payload?.marketStatus) {
      cfg.isOpen = payload.marketStatus === 'open';
      if (hostRef.current) hostRef.current.dataset.status = payload.marketStatus;
      setIsOpen(cfg.isOpen);
    }

    return changed;
  }, []);

  // --- window event listeners ----------------------------------------------
  useEffect(() => {
    function onAuthState(e) {
      const next = e.detail || window.NaviAuthSession?.getState?.() || null;
      setAuth(next);
      refreshHoldings();
    }
    function onSnapshotUpdated() {
      refreshHoldings();
    }
    function onMarketLiveFetch(event) {
      const cfg = cfgRef.current;
      if (
        event.detail?.marketKey !== cfg.marketKey ||
        event.detail?.type !== 'market.snapshot'
      )
        return;
      const changed = applyMarketSnapshot(event.detail.payload);
      refreshHoldings();
      if (changed && numericAmount(amountRef.current) > 0) {
        scheduleQuote(
          amountRef.current,
          outcomesRef.current,
          selectedOutcomeIdRef.current,
          contractSideRef.current,
          orderSideRef.current,
          authRef.current,
        );
      }
    }
    function onViewerPositionSell(event) {
      const side = event.detail?.contractSide === 'no' ? 'no' : 'yes';
      setOrderSide('sell');
      setContractSide(side);
      if (event.detail?.outcomeId) setSelectedOutcomeId(event.detail.outcomeId);
      setAmount('');
      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.focus();
      }
      setMessage(null);
      scheduleQuote(
        '',
        outcomesRef.current,
        event.detail?.outcomeId || selectedOutcomeIdRef.current,
        side,
        'sell',
        authRef.current,
      );
    }

    // Mobile sheet closed → wipe the amount so it reopens blank (no stale number).
    function onTicketClose() {
      clearTimeout(quoteTimerRef.current);
      setAmount('');
      if (inputRef.current) inputRef.current.value = '';
      setQuote(null);
      setQuoteStatus('idle');
      setMessage(null);
    }

    window.addEventListener('navi:auth-state', onAuthState);
    window.addEventListener('navi:portfolio-snapshot-updated', onSnapshotUpdated);
    window.addEventListener('hz:market-live-fetch', onMarketLiveFetch);
    window.addEventListener('hz:viewer-position-sell', onViewerPositionSell);
    window.addEventListener('hz:trade-ticket-close', onTicketClose);

    return () => {
      window.removeEventListener('navi:auth-state', onAuthState);
      window.removeEventListener('navi:portfolio-snapshot-updated', onSnapshotUpdated);
      window.removeEventListener('hz:market-live-fetch', onMarketLiveFetch);
      window.removeEventListener('hz:viewer-position-sell', onViewerPositionSell);
      window.removeEventListener('hz:trade-ticket-close', onTicketClose);
    };
  }, [refreshHoldings, applyMarketSnapshot, scheduleQuote]);

  // --- keyboard-avoidance (mobile bottom sheet only) ------------------------
  // While the amount input is focused, the on-screen keyboard can cover the
  // submit row (both sheet mounts put it at the very bottom of the flex order —
  // see trade-ticket.css). Pad the sheet's footer by the keyboard overlap so the
  // submit button rides above it. Guarded on visualViewport: desktop (and any
  // browser without it) is bit-identical, no listeners ever attach.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const input = inputRef.current;
    const host = hostRef.current;
    if (!input || !host) return;
    const vv = window.visualViewport;

    // Sheet ancestor is one of two mounts (market-detail sticky sheet or the
    // quick-buy host sheet) — desktop has neither, so `sheet` is null and the
    // whole handler stays a no-op (querySelector below never sets anything).
    const sheet = host.closest('.market-detail-stage-order-widget, .hz-quickbuy__sheet');

    let engaged = false;

    function applyOverlap() {
      if (!sheet) return;
      const overlap = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      sheet.style.setProperty('--hz-kb-overlap', `${overlap}px`);
    }

    function engage() {
      if (engaged) return;
      engaged = true;
      document.body.dataset.kbOpen = 'true'; // swipe-dismiss scripts check this and bail
      vv.addEventListener('resize', applyOverlap);
      vv.addEventListener('scroll', applyOverlap);
      applyOverlap();
    }

    function disengage() {
      if (!engaged) return;
      engaged = false;
      delete document.body.dataset.kbOpen;
      vv.removeEventListener('resize', applyOverlap);
      vv.removeEventListener('scroll', applyOverlap);
      if (sheet) sheet.style.setProperty('--hz-kb-overlap', '0px');
    }

    function onFocusIn(e) {
      if (e.target === input) engage();
    }
    function onFocusOut(e) {
      if (e.target === input) disengage();
    }

    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    return () => {
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
      disengage();
    };
  }, []);

  // document-level outcome-row click (multi ladder)
  useEffect(() => {
    function onDocClick(event) {
      const button = event.target.closest('[data-ticket-outcome-id]');
      if (!button || button.dataset.ticketMarketKey !== cfgRef.current.marketKey) return;
      const newOutcomeId = button.dataset.ticketOutcomeId;
      const newOrderSide = button.dataset.ticketOrderSide || orderSideRef.current;
      const newContractSide = button.dataset.ticketContractSide || contractSideRef.current;
      setSelectedOutcomeId(newOutcomeId);
      setOrderSide(newOrderSide);
      setContractSide(newContractSide);
      setAmount('');
      if (inputRef.current) inputRef.current.value = '';
      setMessage(null);
      scheduleQuote(
        '',
        outcomesRef.current,
        newOutcomeId,
        newContractSide,
        newOrderSide,
        authRef.current,
      );
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [scheduleQuote]);

  // --- initial load ---------------------------------------------------------
  useEffect(() => {
    refreshHoldings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- retarget handle (exposed on host element) ---------------------------
  // FIX: cfg.outcomes rebuilt from child's yes/no so quote posts correct outcomeKey
  useEffect(() => {
    if (!hostRef.current) return;
    function retarget(next) {
      const cfg = cfgRef.current;
      cfg.marketKey = next.marketKey;
      cfg.canonical = next.canonicalOutcomeId;
      cfg.noOutcome = next.noOutcomeId || '';
      cfg.yesPrice = Number(next.yesPrice) || 0;
      cfg.noPrice = Number(next.noPrice) || 0;
      cfg.isOpen = (next.marketStatus || 'open') === 'open';
      // Selected child's flag → yes side (the "no"/complement side has none); falls
      // back to the market icon via activeCrest when the child has no crest yet.
      cfg.yesCrest = next.crest || null;
      cfg.noCrest = null;
      // Rebuild outcomes from child yes/no — prevents stale outcomeKey in quote
      cfg.outcomes = [
        { id: cfg.canonical, label: cfg.yesLabel, price: cfg.yesPrice },
        ...(cfg.noOutcome ? [{ id: cfg.noOutcome, label: cfg.noLabel, price: cfg.noPrice }] : []),
      ].filter((o) => o.id);

      // Rewrite host data-* (so a future read/re-mount sees the current target)
      const host = hostRef.current;
      host.dataset.marketKey = next.marketKey;
      host.dataset.canonical = next.canonicalOutcomeId;
      host.dataset.noOutcome = next.noOutcomeId || '';
      host.dataset.yesPrice = String(next.yesPrice);
      host.dataset.noPrice = String(next.noPrice);
      host.dataset.status = next.marketStatus || 'open';

      const newSide = next.side === 'no' ? 'no' : 'yes';

      // Drive component state
      setOutcomes(cfg.outcomes);
      setPillPrices({ yes: cfg.yesPrice, no: cfg.noPrice });
      setIsOpen(cfg.isOpen);
      setSelectedOutcomeId(next.canonicalOutcomeId);
      setContractSide(newSide);
      setOrderSide('buy');
      setAmount('');
      setQuote(null);
      setQuoteStatus('idle');
      setMessage(null);
      setContextTitle(next.title || '');
      if (inputRef.current) inputRef.current.value = '';

      refreshHoldings();
    }
    hostRef.current._hzTicket = { retarget };
  });

  // --- derived render values -----------------------------------------------
  const buy = orderSide === 'buy';
  const curAuth = auth;
  const restriction = blockingRestriction(curAuth);
  const pending = isCapabilityPending(curAuth);
  const gated = Boolean(restriction) || pending;

  const activeOutcome = getActiveOutcome(outcomes, selectedOutcomeId);
  const activeHoldingVal = getActiveHolding(outcomes, selectedOutcomeId, contractSide);
  const sellOverHolding = orderSide === 'sell' && numericAmount(amount) > activeHoldingVal;

  const pillYesPrice =
    isMulti ? Number(activeOutcome.price || 0) : pillPrices.yes;
  const pillNoPrice =
    isMulti ? Math.max(0, 1 - Number(activeOutcome.price || 0)) : pillPrices.no;
  const yesHoldingVal = isMulti
    ? Number(holdingsByOutcome[selectedOutcomeId]?.yes || 0)
    : Number(holdings.yes || 0);
  const noHoldingVal = isMulti
    ? Number(holdingsByOutcome[selectedOutcomeId]?.no || 0)
    : Number(holdings.no || 0);

  const amt = numericAmount(amount);
  // Stale-while-revalidate: once a quote is showing, KEEP it visible while the next
  // one loads (the prior `quote` is retained across 'loading'). This stops the
  // wipe→flash→re-pop when the amount changes — the value just updates in place.
  const showSummary = !gated && quote && amt > 0 && (quoteStatus === 'success' || quoteStatus === 'loading');

  // Feedback line
  let feedbackTone = null;
  let feedbackText = '';
  let feedbackHref = null;
  if (restriction) {
    feedbackTone = 'error';
    feedbackText = restriction.message;
  } else if (pending) {
    feedbackTone = 'muted';
    feedbackText = 'בודק אם המסחר פתוח לחשבון הזה…';
  } else if (sellOverHolding) {
    feedbackTone = 'error';
    feedbackText = 'אי אפשר למכור יותר מהכמות הזמינה.';
  } else if (message) {
    feedbackTone = message.tone;
    feedbackText = message.text;
    feedbackHref = message.href || null;
  }
  // No "calculating price…" loading text — the quote just lands in place when it
  // resolves (quote latency to be optimized/cached separately).

  // Submit button label + disabled
  let submitLabel;
  let submitDisabled = false;
  // True only for the "amount is empty/zero, everything else is fine" case. This
  // button stays ENABLED and full-color (design ruling: don't fake a dead CTA) —
  // clicking it focuses the amount input instead of submitting. Every other
  // disabled reason below keeps the real `disabled` attribute (dimmed, inert).
  let needsAmount = false;
  const sideLabel = isMulti ? activeOutcome.label : contractSide === 'yes' ? cfgRef.current.yesLabel : cfgRef.current.noLabel;
  // The submit names yes/no for multi (the outcome is already named in the header),
  // and the team/outcome label for binary.
  const submitSideLabel = isMulti ? (contractSide === 'yes' ? 'כן' : 'לא') : sideLabel;
  if (!isOpen) {
    submitLabel = 'השוק סגור';
    submitDisabled = true;
  } else if (restriction) {
    submitLabel = 'מסחר חסום';
    submitDisabled = true;
  } else if (pending) {
    submitLabel = 'בודק…';
    submitDisabled = true;
  } else if (submitting) {
    submitLabel = 'שולח…';
    submitDisabled = true;
  } else if (!buy && activeHoldingVal <= 0) {
    submitLabel = 'אין פוזיציה למכירה';
    submitDisabled = true;
  } else if (sellOverHolding) {
    submitLabel = 'כמות גבוהה מדי';
    submitDisabled = true;
  } else if (amt <= 0) {
    // No amount yet: name the action + side ("קנה <side>") instead of a generic
    // "choose amount" — the CTA reads as what it'll do. Enabled + full color;
    // click focuses the amount input (see handleSubmitClick below).
    submitLabel = buy ? `קנה ${submitSideLabel}` : `מכור ${submitSideLabel}`;
    needsAmount = true;
  } else {
    // Keep the label stable once an amount is entered — just the action + side,
    // no appended amount/shares (the amount lives in the input + summary line).
    submitLabel = buy ? `קנה ${submitSideLabel}` : `מכור ${submitSideLabel}`;
  }

  // --- input handler -------------------------------------------------------
  function handleInput(e) {
    const cleaned = sanitizeAmount(e.target.value);
    if (cleaned !== e.target.value) {
      e.target.value = cleaned;
    }
    setAmount(cleaned);
    setMessage(null);
    scheduleQuote(cleaned, outcomesRef.current, selectedOutcomeIdRef.current, contractSideRef.current, orderSideRef.current, authRef.current);
  }

  // Enter on the amount input submits the trade — same path as the button click,
  // same disabled gate (never bypasses validation). Desktop keyboard users
  // currently have to tab/click to submit (audit F6); mobile gets it free via
  // enterkeyhint="done" on the numeric keyboard.
  // needsAmount (empty amount) also no-ops here — the button looks enabled but
  // there's nothing to submit yet; Enter on an empty field shouldn't submit.
  function handleAmountKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (submitDisabled || needsAmount) return;
    handleSubmit();
  }

  // Submit button click: the empty-amount state renders enabled/full-color (design
  // ruling — don't fake a dead CTA) but has nothing to submit, so clicking it is a
  // quiet nudge that focuses the amount input instead of hitting handleSubmit
  // (which would itself no-op on amt<=0 anyway — see the guard there).
  function handleSubmitClick() {
    if (needsAmount) {
      inputRef.current?.focus();
      return;
    }
    handleSubmit();
  }

  function handleChipClick(chipValue, kind) {
    let next = chipValue;
    if (kind === 'inc') {
      // Stack onto the current amount instead of replacing it — tapping +V₪10 then
      // +V₪100 lands on 110, matching Polymarket's increment-chip feel.
      const sum = numericAmount(amountRef.current) + numericAmount(chipValue);
      next = String(Math.round(sum * 100) / 100);
    }
    setAmount(next);
    if (inputRef.current) inputRef.current.value = next;
    setMessage(null);
    scheduleQuote(next, outcomesRef.current, selectedOutcomeIdRef.current, contractSideRef.current, orderSideRef.current, authRef.current);
  }

  function handleOrderSideClick(next) {
    if (orderSide === next) return;
    setOrderSide(next);
    setMessage(null);
    scheduleQuote(amountRef.current, outcomesRef.current, selectedOutcomeIdRef.current, contractSideRef.current, next, authRef.current);
  }

  function handlePillClick(next) {
    if (contractSide === next) return;
    setContractSide(next);
    setMessage(null);
    scheduleQuote(amountRef.current, outcomesRef.current, selectedOutcomeIdRef.current, next, orderSideRef.current, authRef.current);
  }

  // Team-colored ticket (sports/coloring markets). Binary: the side pills carry
  // their kit color AND the submit CTA takes the selected side's color. Multi: ONLY
  // the submit is colored — from the selected outcome's color (draw/uncolored falls
  // back to the default CTA). --cta-team tracks the active side/outcome so the
  // execute button always wears what you're about to trade.
  const ctaOn = (hex) => {
    const m = typeof hex === 'string' ? hex.replace('#', '') : '';
    if (m.length < 6) return '#ffffff';
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff';
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0b0b0c' : '#ffffff';
  };
  const activeTeam = isMulti
    ? (activeOutcome?.color || null)
    : (contractSide === 'yes' ? yesColor : noColor);
  const activeTeamOn = isMulti
    ? ctaOn(activeOutcome?.color)
    : (contractSide === 'yes' ? yesColorOn : noColorOn);
  const teamColored = isMulti ? !!activeTeam : !!(yesColor || noColor);
  const rootTeamStyle = teamColored && activeTeam
    ? { '--cta-team': activeTeam, '--cta-team-on': activeTeamOn || '#ffffff' }
    : undefined;
  // Flag/crest of the currently-targeted outcome — swaps with the binary side
  // (Brazil ⇄ Japan) or the selected multi outcome, so the ticket header mirrors
  // the ladder/hero. null → no flag slot (yes/no props, non-sports).
  const activeCrest = (isMulti
    ? (activeOutcome?.crestPath || null)
    : (contractSide === 'yes' ? cfgRef.current.yesCrest : cfgRef.current.noCrest))
    || marketCrest || null;
  // Every outcome's crest, so they can all be MOUNTED and just toggled by visibility
  // — swapping `src` on one img re-fetches under the dev `no-store` header (a visible
  // lag on a phone). Stacked + visibility-toggled = zero network on swap, ever.
  const crestList = (isMulti
    ? (outcomes || []).filter((o) => o?.crestPath).map((o) => ({ key: String(o.id), src: o.crestPath }))
    : [
        cfgRef.current.yesCrest ? { key: 'yes', src: cfgRef.current.yesCrest } : null,
        cfgRef.current.noCrest ? { key: 'no', src: cfgRef.current.noCrest } : null,
      ].filter(Boolean));
  const activeCrestKey = isMulti ? String(selectedOutcomeId) : contractSide;
  // Draw/tie selected → show the "=" glyph (same as the ladder) instead of a flag
  // or the market-icon fallback.
  const activeLabel = isMulti
    ? (activeOutcome?.label || '')
    : (contractSide === 'yes' ? cfgRef.current.yesLabel : cfgRef.current.noLabel);
  const isDrawActive = /^(תיקו|draw|tie)$/i.test(String(activeLabel).trim());

  return (
    <div
      ref={hostRef}
      class={`market-detail-panel hz-trade-ticket${isMulti ? ' hz-trade-ticket--multi' : ' hz-trade-ticket--binary'}${tradeCelebration ? ' is-trade-confirmed' : ''} space-y-5`}
      style={rootTeamStyle}
      data-hz-ticket
      data-market-detail-order-ticket
      data-team-colored={teamColored ? '' : undefined}
      data-order-side={orderSide}
      data-active-side={contractSide}
      data-ticket-mode={mode}
      data-market-key={cfgRef.current.marketKey}
      data-canonical={cfgRef.current.canonical}
      data-no-outcome={cfgRef.current.noOutcome}
      data-selected-outcome={selectedOutcomeId}
      data-outcomes={JSON.stringify(outcomes)}
      data-yes-label={cfgRef.current.yesLabel}
      data-no-label={cfgRef.current.noLabel}
      data-yes-price={isMulti ? Number(activeOutcome.price || 0) : pillPrices.yes}
      data-no-price={isMulti ? Math.max(0, 1 - Number(activeOutcome.price || 0)) : pillPrices.no}
      data-status={isOpen ? 'open' : 'closed'}
    >
      {/* Unified ticket header (binary + multi): market name on top, then a row of
          outcome (RTL-start / right) + yes·no (RTL-end / left). Binary has no
          separate yes/no — the side IS the outcome — so its left cell is empty. */}
      <div class="hz-trade-ticket__context-header">
        {(activeCrest || isDrawActive) && (
          <span class={`hz-trade-ticket__context-crest${isDrawActive ? ' hz-trade-ticket__context-crest--draw' : ''}`} aria-hidden="true">
            {isDrawActive ? (
              <svg class="hz-trade-ticket__context-crest-glyph" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="8.4" width="14" height="2.7" rx="1.35" />
                <rect x="5" y="12.9" width="14" height="2.7" rx="1.35" />
              </svg>
            ) : crestList.length > 1 ? (
              // All crests mounted; only the active one is visible. Switching sides
              // just flips the active flag — no src change, no re-fetch, instant.
              crestList.map((c) => (
                <img
                  key={c.key}
                  src={c.src}
                  alt=""
                  decoding="sync"
                  class="hz-trade-ticket__context-crest-img"
                  data-crest-active={c.key === activeCrestKey ? '' : undefined}
                />
              ))
            ) : (
              <img src={activeCrest} alt="" decoding="sync" />
            )}
          </span>
        )}
        <div class="hz-trade-ticket__context-text">
        <span class="hz-trade-ticket__context-title" data-binary-context-title>
          {contextTitle || cfgRef.current.yesLabel}
        </span>
        <div class="hz-trade-ticket__context-row">
          <span
            class={`hz-trade-ticket__context-side${
              !isMulti
                ? contractSide === 'yes'
                  ? ' hz-trade-ticket__context-side--yes'
                  : ' hz-trade-ticket__context-side--no'
                : ''
            }`}
            data-binary-context-side
            data-order-ticket-title
          >
            {isMulti
              ? activeOutcome.label || 'בחר תוצאה'
              : contractSide === 'yes'
                ? cfgRef.current.yesLabel
                : cfgRef.current.noLabel}
          </span>
          <span
            class={`hz-trade-ticket__context-yesno${
              isMulti
                ? contractSide === 'yes'
                  ? ' hz-trade-ticket__context-yesno--yes'
                  : ' hz-trade-ticket__context-yesno--no'
                : ''
            }`}
            data-order-intent-label
          >
            {isMulti ? (contractSide === 'yes' ? 'כן' : 'לא') : ''}
          </span>
        </div>
        </div>
      </div>

      <div class="hz-side-toggle hz-side-toggle--stage">
        <span class="market-detail-visually-hidden" data-order-side-summary>
          {buy ? 'קנייה' : 'מכירה'}
        </span>
        <button
          class={`hz-side-toggle__button${orderSide === 'buy' ? ' hz-side-toggle__button--active' : ''}`}
          data-order-side-toggle="buy"
          data-order-side-switch="buy"
          type="button"
          onClick={() => handleOrderSideClick('buy')}
        >
          קנייה
        </button>
        <button
          class={`hz-side-toggle__button${orderSide === 'sell' ? ' hz-side-toggle__button--active' : ''}`}
          data-order-side-toggle="sell"
          data-order-side-switch="sell"
          type="button"
          onClick={() => handleOrderSideClick('sell')}
        >
          מכירה
        </button>
      </div>

      {!isMulti && (
        <div class="hz-binary-pill-duo" data-binary-pill-duo>
          <div class={`hz-binary-choice${contractSide === 'yes' ? ' hz-binary-choice--active hz-binary-choice--yes' : ''}`}>
            <button
              class={`hz-binary-pill hz-binary-pill--yes${teamColored ? ' hz-binary-pill--team' : ''}${contractSide === 'yes' ? ' hz-binary-pill--active' : ''}`}
              style={teamColored && yesColor ? { '--pill-team': yesColor } : undefined}
              data-binary-pill-side="yes"
              type="button"
              onClick={() => handlePillClick('yes')}
            >
              <span class="hz-binary-pill__label">{cfgRef.current.yesLabel}</span>
              <span class="hz-binary-pill__price" data-pill-price-yes>
                <VShekelProbabilityPrice value={pillYesPrice} />
              </span>
            </button>
            {!buy && (
              <span class="hz-binary-choice__shares" data-sell-side-shares="yes">
                {holdingsLoading ? 'בודק...' : `${shares(yesHoldingVal)} חוזים`}
              </span>
            )}
          </div>
          <div class={`hz-binary-choice${contractSide === 'no' ? ' hz-binary-choice--active hz-binary-choice--no' : ''}`}>
            <button
              class={`hz-binary-pill hz-binary-pill--no${teamColored ? ' hz-binary-pill--team' : ''}${contractSide === 'no' ? ' hz-binary-pill--active' : ''}`}
              style={teamColored && noColor ? { '--pill-team': noColor } : undefined}
              data-binary-pill-side="no"
              type="button"
              onClick={() => handlePillClick('no')}
            >
              <span class="hz-binary-pill__label">{cfgRef.current.noLabel}</span>
              <span class="hz-binary-pill__price" data-pill-price-no>
                <VShekelProbabilityPrice value={pillNoPrice} />
              </span>
            </button>
            {!buy && (
              <span class="hz-binary-choice__shares" data-sell-side-shares="no">
                {holdingsLoading ? 'בודק...' : `${shares(noHoldingVal)} חוזים`}
              </span>
            )}
          </div>
        </div>
      )}

      {isMulti && (
        <div class="hz-binary-pill-duo" data-binary-pill-duo data-order-contract-switch>
          <div class={`hz-binary-choice${contractSide === 'yes' ? ' hz-binary-choice--active hz-binary-choice--yes' : ''}`}>
            <button
              class={`hz-binary-pill hz-binary-pill--yes${contractSide === 'yes' ? ' hz-binary-pill--active' : ''}`}
              data-binary-pill-side="yes"
              type="button"
              onClick={() => handlePillClick('yes')}
            >
              <span class="hz-binary-pill__label">כן</span>
              <span class="hz-binary-pill__price" data-pill-price-yes>
                <VShekelProbabilityPrice value={pillYesPrice} />
              </span>
            </button>
            {!buy && (
              <span class="hz-binary-choice__shares" data-sell-side-shares="yes">
                {holdingsLoading ? 'בודק...' : `${shares(yesHoldingVal)} חוזים`}
              </span>
            )}
          </div>
          <div class={`hz-binary-choice${contractSide === 'no' ? ' hz-binary-choice--active hz-binary-choice--no' : ''}`}>
            <button
              class={`hz-binary-pill hz-binary-pill--no${contractSide === 'no' ? ' hz-binary-pill--active' : ''}`}
              data-binary-pill-side="no"
              type="button"
              onClick={() => handlePillClick('no')}
            >
              <span class="hz-binary-pill__label">לא</span>
              <span class="hz-binary-pill__price" data-pill-price-no>
                <VShekelProbabilityPrice value={pillNoPrice} />
              </span>
            </button>
            {!buy && (
              <span class="hz-binary-choice__shares" data-sell-side-shares="no">
                {holdingsLoading ? 'בודק...' : `${shares(noHoldingVal)} חוזים`}
              </span>
            )}
          </div>
        </div>
      )}

      <div data-market-detail-trade-blocked-notice>
        <AccessNotice restriction={restriction} pending={pending} />
      </div>
      {isMulti && <div data-order-position-context />}
      {isMulti && <div data-order-position-impact />}

      <div class="space-y-3">
        {/* Buy: no "כמה להשקיע" caption — the input speaks for itself. Sell keeps
            the label + available-to-sell balance, which carry real information. */}
        {!buy && (
          <div class="flex justify-between items-end gap-3 text-xs font-bold">
            <label class="text-slate-300" data-order-amount-label>
              כמה חוזים למכור
            </label>
          </div>
        )}
        <div class="hz-amount-shell">
          <input
            ref={inputRef}
            id={amountHintIdRef.current}
            class="hz-amount-input hz-amount-input--stage"
            data-order-amount-input
            dir="ltr"
            inputmode="decimal"
            enterkeyhint="done"
            min="0"
            placeholder="0"
            step="0.01"
            type="text"
            defaultValue=""
            autocomplete="off"
            disabled={gated}
            onInput={handleInput}
            onKeyDown={handleAmountKeyDown}
          />
          <span
            class="hz-trade-ticket__unit-suffix"
            data-order-unit-suffix
            dir={buy ? 'ltr' : 'rtl'}
          >
            {buy ? <VShekelSymbol /> : 'חוזים'}
          </span>
        </div>
        {/* Wallet balance under the amount (Poly's "$X cash"). Sheet-only via CSS;
            sits between the amount and the outcome pills in the reordered sheet. */}
        {buy && (
          <div class="hz-trade-ticket__balance" data-order-balance>
            <span class="hz-trade-ticket__balance-label">בארנק</span>
            <VShekelAmount value={availableCash} />
          </div>
        )}
        <QuickChips
          orderSide={orderSide}
          amount={amount}
          activeHolding={activeHoldingVal}
          isOpen={isOpen}
          gated={gated}
          availableCash={availableCash}
          onChipClick={handleChipClick}
        />
      </div>

      <div class={`hz-trade-ticket__summary${showSummary ? '' : ' is-hidden'}`} data-order-summary>
        <div class="hz-trade-ticket__summary-divider" />
        <div class="hz-trade-ticket__total-row">
          <span class="hz-trade-ticket__total-label" data-order-summary-total-label>
            <span data-order-summary-total-text>{buy ? 'להרוויח' : 'תקבל'}</span>
            <span class="material-symbols-outlined text-xs text-success" data-order-summary-total-icon>
              payments
            </span>
          </span>
          <span class="hz-trade-ticket__total-value font-black" data-order-summary-total-value>
            {showSummary
              ? buy
                ? <VShekelAmount value={quote.shareAmount} />
                : <VShekelAmount value={quote.estimatedProceeds ?? quote.cashAmount ?? 0} />
              : '—'}
          </span>
        </div>
        {/* Price per share of the selected outcome — sheet-only (hidden on desktop
            via CSS). Sits under the "to win" so cost + return read as a pair. */}
        <div class="hz-trade-ticket__pershare" data-order-pershare>
          <span class="hz-trade-ticket__pershare-label">מחיר לחוזה</span>
          <span class="hz-trade-ticket__pershare-value">
            <VShekelProbabilityPrice
              value={isMulti ? Number(activeOutcome.price || 0) : contractSide === 'yes' ? pillYesPrice : pillNoPrice}
            />
          </span>
        </div>
      </div>

      <div
        class="text-xs leading-relaxed min-h-[1.25rem] text-slate-500"
        data-order-feedback
        hidden={!feedbackText}
        {...(feedbackText ? { 'data-tone': feedbackTone } : {})}
      >
        {feedbackText}
        {feedbackHref && (
          <>
            {' '}
            <a class="hz-trade-ticket__feedback-link" href={feedbackHref} data-order-feedback-link>
              לתיק
            </a>
          </>
        )}
      </div>

      <button
        ref={submitButtonRef}
        class="hz-button-primary hz-button-primary--large hz-trade-ticket__submit"
        data-order-submit-button
        data-needs-amount={needsAmount ? '' : undefined}
        type="button"
        disabled={submitDisabled}
        aria-describedby={needsAmount ? amountHintIdRef.current : undefined}
        onClick={handleSubmitClick}
      >
        {tradeCelebration ? (
          <>
            <span class="material-symbols-outlined hz-trade-ticket__submit-check" aria-hidden="true">check</span>
            <span data-order-submit-label>
              {tradeCelebration === 'buy' ? 'קנייה בוצעה' : 'מכירה בוצעה'}
            </span>
          </>
        ) : (
          <span data-order-submit-label>{submitLabel}</span>
        )}
      </button>
    </div>
  );
}
