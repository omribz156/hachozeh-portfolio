// QuickBuyHost.jsx — shell-level island for the pop-anywhere trade ticket.
// Mounted once in Layout (like PageOverlayHost); idle until called. Exposes
//   window.NaviTradeTicket.open({ marketKey, side, outcomeId, title }) / .close()
// Any surface (cards) calls open(); the host fetches the ticket data, slides up the
// bottom sheet, and mounts the SAME TradeTicket in the SAME chrome. Mobile only —
// desktop cards navigate to detail (decision #5 in the quick-buy spec).
//
// TradeTicket is dynamically imported on first open, so the (large) ticket bundle
// is NOT shipped on every page — only when someone actually quick-buys.

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { fetchTicketData, toTicketProps } from '../../lib/quick-buy.js';
import { lock as lockScroll, unlock as unlockScroll } from '../../client/shell/scroll-lock.js';

const MOBILE = '(max-width: 960px)';
const SWIPE_CLOSE_PX = 110;

let TicketComponent = null; // module-level cache of the lazily-imported TradeTicket

export default function QuickBuyHost() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [props, setProps] = useState(null);
  const [pendingTitle, setPendingTitle] = useState('');
  const [, forceRender] = useState(0);
  const reqRef = useRef(0);
  const sheetRef = useRef(null);
  // heldRef: this island's own held/not-held bit for the shared scroll-lock
  // counter (window.NaviScrollLock). Needed because close() can be invoked
  // more than once for a single open (scrim click + Escape + trade-complete
  // timer all call it) and unmount must also release exactly once — heldRef
  // makes every path idempotent instead of relying on call-site discipline.
  const heldRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    if (heldRef.current) {
      heldRef.current = false;
      unlockScroll();
    }
    window.dispatchEvent(new CustomEvent('hz:trade-ticket-close')); // wipe the amount
    window.setTimeout(() => { setProps(null); setStatus('idle'); setPendingTitle(''); }, 320);
  }, []);

  const openTicket = useCallback(async (opts) => {
    if (!opts || !opts.marketKey) return;
    if (typeof window === 'undefined' || !window.matchMedia(MOBILE).matches) return; // mobile only
    const req = ++reqRef.current;
    setProps(null);
    setPendingTitle(opts.title || '');
    setStatus('loading');
    setOpen(true);
    if (!heldRef.current) {
      heldRef.current = true;
      lockScroll(); // scroll-lock, same convention as other overlays
    }
    try {
      // Load the ticket bundle + the data in parallel.
      const [mod, data] = await Promise.all([
        TicketComponent ? Promise.resolve({ default: TicketComponent }) : import('../market-detail/TradeTicket.jsx'),
        fetchTicketData(opts.marketKey),
      ]);
      if (req !== reqRef.current) return; // superseded by a newer open/close
      TicketComponent = mod.default;
      const full = toTicketProps(data, { side: opts.side, outcomeId: opts.outcomeId, title: opts.title });
      if (!full) { setStatus('error'); return; } // resolved / closed → nothing to buy
      setProps(full);
      setStatus('ready');
      forceRender((n) => n + 1);
    } catch {
      if (req !== reqRef.current) return;
      setStatus('error');
    }
  }, []);

  // Global API + lifecycle listeners (bound once).
  useEffect(() => {
    window.NaviTradeTicket = { open: openTicket, close };
    const onComplete = () => window.setTimeout(close, 1300); // close after the buy celebration
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('hz:trade-complete', onComplete);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hz:trade-complete', onComplete);
      document.removeEventListener('keydown', onKey);
      if (window.NaviTradeTicket?.open === openTicket) delete window.NaviTradeTicket;
      // Defensive: this island is mounted once for the page's life (client:only,
      // no remount expected outside a soft-nav that astro:before-swap already
      // releases), but if it ever does unmount while the sheet is open, don't
      // leave the shared counter holding a lock nothing will ever release.
      if (heldRef.current) {
        heldRef.current = false;
        unlockScroll();
      }
    };
  }, [openTicket, close]);

  // Swipe-down-to-dismiss — engages only at the sheet's scroll-top, on a downward drag.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !open) return;
    let startY = null;
    let dragging = false;
    const onStart = (e) => {
      // Keyboard is up (amount input focused, see TradeTicket.jsx) — never let a
      // drag-to-close fire mid-typing.
      if (document.body.dataset.kbOpen === 'true') return;
      if (sheet.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      dragging = false;
    };
    const onMove = (e) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && sheet.scrollTop <= 0) {
        dragging = true;
        sheet.classList.add('is-dragging');
        sheet.style.transform = `translateY(${dy}px)`;
      }
    };
    const onEnd = (e) => {
      if (!dragging) { startY = null; return; }
      const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
      sheet.classList.remove('is-dragging');
      sheet.style.transform = '';
      if (dy > SWIPE_CLOSE_PX) close();
      startY = null;
      dragging = false;
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: true });
    sheet.addEventListener('touchend', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
    };
  }, [open, close]);

  const Ticket = TicketComponent;
  return (
    <div class={`hz-quickbuy${open ? ' is-open' : ''}`}>
      <button type="button" class="hz-quickbuy__scrim" aria-label="סגור" onClick={close}></button>
      {/* role/aria-modal only while open, so the closed (off-screen) sheet never
          registers as a live dialog with the inert observer / auto-pop gate. */}
      <div
        class="hz-quickbuy__sheet market-detail-stage-order-widget"
        ref={sheetRef}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-label="טופס מסחר"
        aria-hidden={open ? undefined : 'true'}
      >
        {status === 'ready' && props && Ticket ? (
          <Ticket key={props.marketKey} {...props} />
        ) : (
          <div class="hz-quickbuy__status">
            {pendingTitle ? <span class="hz-quickbuy__status-title">{pendingTitle}</span> : null}
            <span>{status === 'error' ? 'לא ניתן לטעון את השוק. נסו שוב.' : 'טוען…'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
