// quick-buy.js — client helper for the pop-anywhere trade ticket. Single chokepoint
// for the endpoint URL so it can move to a backend /api/markets/:key/ticket (edge-
// cached) later without touching callers, and the one place the endpoint's multi
// shape (raw outcomes + current price map) is mapped to TradeTicket's prop shape.

export async function fetchTicketData(marketKey) {
  const res = await fetch(`/quickbuy/${encodeURIComponent(marketKey)}.json`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = new Error(`quickbuy ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Map an endpoint payload → TradeTicket props, preselecting the tapped side/outcome.
// Returns null for resolved/closed markets (nothing to buy → caller bails).
export function toTicketProps(data, { side, outcomeId, title } = {}) {
  if (!data || data.kind === 'resolved') return null;
  // Binary two-named-outcome cards (team-vs-team) can't rely on the tapped
  // button's `side` attribute alone — a matchup card's two pills both mean
  // "buy this side" and are wired data-quickbuy-side="yes" on both (there is
  // no real yes/no semantic between two teams). Ground truth is which
  // outcome id was actually tapped, so if it resolves to the "no" side of the
  // binary pair, honor that over `side`.
  const initialContractSide = (data.kind === 'binary' && outcomeId && outcomeId === data.noOutcomeId)
    ? 'no'
    : (side === 'no' ? 'no' : 'yes');
  const ticketTitle = title || data.title;

  if (data.kind === 'multi') {
    const current = data.current || {};
    const outcomes = (data.outcomes || []).map((o) => ({
      id: o.id,
      label: o.label || o.id,
      price: Number(current[o.id] ?? 0),
      color: o.colorPrimary ?? null,
      crestPath: o.crestPath ?? null,
    }));
    return {
      mode: 'multi',
      marketKey: data.marketKey,
      title: ticketTitle,
      outcomes,
      selectedOutcome: outcomeId || outcomes[0]?.id || '',
      marketCrest: data.marketCrest || null,
      marketStatus: data.marketStatus,
      initialContractSide,
    };
  }

  // binary — endpoint props already match TradeTicket 1:1
  return {
    mode: 'binary',
    marketKey: data.marketKey,
    title: ticketTitle,
    canonicalOutcomeId: data.canonicalOutcomeId,
    noOutcomeId: data.noOutcomeId,
    yesLabel: data.yesLabel,
    noLabel: data.noLabel,
    yesPrice: data.yesPrice,
    noPrice: data.noPrice,
    yesColor: data.yesColor,
    noColor: data.noColor,
    yesColorOn: data.yesColorOn,
    noColorOn: data.noColorOn,
    yesCrest: data.yesCrest,
    noCrest: data.noCrest,
    marketCrest: data.marketCrest,
    marketStatus: data.marketStatus,
    initialContractSide,
  };
}
