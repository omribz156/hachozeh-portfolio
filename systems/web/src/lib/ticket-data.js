// Single source of truth for the trade-ticket's props, derived from a market-detail
// record (the shape returned by fetchMarketDetail). Consumed by BOTH the
// market-detail page SSR and the /api/markets/:key/ticket endpoint (quick-buy pop),
// so the popped ticket and the detail-page ticket can never drift apart.

// On-color (text) for a SOLID kit-colored CTA. The snapshot carries colorPrimary
// but no colorOn yet, so derive black/white from the kit color's luminance so the
// submit button text stays readable on any team color (e.g. Maccabi yellow → dark).
export function ctaOnColor(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = hex.replace('#', '').trim();
  if (m.length < 6) return null;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0b0b0c' : '#ffffff';
}

// Canonical (yes) outcome + the opposing (no) outcome + their prices, straight off
// the snapshot. Binary: the "כן"/yes side is canonical; for named-opponent duels
// (team-vs-team) the first outcome is canonical. Shared so the hero, chart, ticket,
// and the quick-buy endpoint all resolve the same canonical/opposing pair.
export function deriveBinaryOutcomes(outcomes, current) {
  const list = outcomes || [];
  const cur = current || {};
  const yes = list.find((o) => /^(yes|כן)$/i.test(String(o.label || '').trim())) || list[0] || null;
  const noOutcome = list.find((o) => o.id !== yes?.id) || null;
  const yesPrice = yes ? (cur[yes.id] ?? 0) : 0;
  const noPrice = noOutcome ? (cur[noOutcome.id] ?? 0) : Math.max(0, 1 - yesPrice);
  return { yes, noOutcome, yesPrice, noPrice };
}

// Build the TradeTicket props for a market record. Returns a discriminated shape
// — { kind: 'binary' | 'multi' | 'resolved', ...props } — whose prop names match
// TradeTicketIsland exactly. `marketKey` is passed explicitly (route param / card
// key) rather than dug out of the record. Event parents are NOT handled here: they
// only render the EventLadder on the detail page, never a single buy-able card.
export function buildTicketProps(marketKey, record) {
  const ctx = record?.context || {};
  const snap = record?.snapshot || {};
  const outcomes = snap.outcomes || [];
  const current = snap.current || {};
  const title = ctx.marketLabel || snap.contract?.measurement || '';
  const marketCrest = ctx.brandPhotoUrl || ctx.brandImageUrl || null;
  const marketStatus = snap.marketStatus;

  if (marketStatus === 'resolved') {
    return { kind: 'resolved', marketKey, marketStatus, winnerLabel: snap.winner?.label || null };
  }

  if (outcomes.length === 2) {
    const { yes, noOutcome, yesPrice, noPrice } = deriveBinaryOutcomes(outcomes, current);
    return {
      kind: 'binary',
      mode: 'binary',
      marketKey,
      title,
      canonicalOutcomeId: yes?.id || null,
      noOutcomeId: noOutcome?.id || null,
      yesLabel: yes?.label || 'כן',
      noLabel: noOutcome?.label || 'לא',
      yesPrice,
      noPrice,
      yesColor: yes?.colorPrimary || null,
      noColor: noOutcome?.colorPrimary || null,
      yesColorOn: ctaOnColor(yes?.colorPrimary),
      noColorOn: ctaOnColor(noOutcome?.colorPrimary),
      yesCrest: yes?.crestPath || null,
      noCrest: noOutcome?.crestPath || null,
      marketCrest,
      marketStatus,
    };
  }

  return {
    kind: 'multi',
    mode: 'multi',
    marketKey,
    title,
    outcomes,
    current,
    marketCrest,
    marketStatus,
  };
}
