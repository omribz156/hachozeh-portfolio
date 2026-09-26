import { createHash } from 'node:crypto';

function isContendingEventChild(child) {
  const status = String(child?.status || '').toLowerCase();
  return status !== 'resolved' && status !== 'voided';
}

function childFingerprint(child) {
  return {
    marketId: child?.marketId || '',
    label: child?.label || '',
    status: child?.status || '',
    winner: child?.winner || '',
    outcomes: (Array.isArray(child?.outcomes) ? child.outcomes : []).map((outcome) => ({
      id: outcome?.outcomeId || outcome?.id || outcome?.outcomeKey || outcome?.key || '',
      side: outcome?.side || '',
      price: Number(outcome?.price ?? 0),
    })),
  };
}

// Event cards describe the live field, not the historical bracket. Resolved and
// voided children remain in the event snapshot for the market page's audit trail,
// but they must not reappear as contenders in a share image.
export function selectShareMarketCardRows(snapshot, useEventChildren) {
  const current = snapshot.current || {};
  const eventChildren = Array.isArray(snapshot.children) ? snapshot.children : [];

  if (useEventChildren && eventChildren.length > 1) {
    return eventChildren
      .filter(isContendingEventChild)
      .slice(0, 4)
      .map((child) => {
        const yes = child.outcomes?.find((outcome) => outcome.side === 'yes') || child.outcomes?.[0];
        return {
          label: child.label,
          probability: Number(yes?.price ?? 0),
        };
      });
  }

  const outcomes = Array.isArray(snapshot.outcomes) ? snapshot.outcomes : [];
  return outcomes.slice(0, 4).map((outcome) => ({
    label: outcome.shortLabel || outcome.label,
    probability: Number(current[outcome.id] ?? current[outcome.key] ?? 0),
  }));
}

export function selectResolvedEventWinner(snapshot, useEventChildren) {
  if (!useEventChildren) return '';

  const eventChildren = Array.isArray(snapshot.children) ? snapshot.children : [];
  if (eventChildren.some(isContendingEventChild)) return '';

  const winner = eventChildren.find((child) => (
    String(child?.status || '').toLowerCase() === 'resolved'
      && String(child?.winner || '').toLowerCase() === 'yes'
  ));

  return String(winner?.label || '').trim();
}

export function shareMarketCardVersion(snapshot, useEventChildren) {
  const payload = useEventChildren
    ? {
        eventStatus: snapshot.event?.status || '',
        children: (Array.isArray(snapshot.children) ? snapshot.children : []).map(childFingerprint),
      }
    : {
        marketStatus: snapshot.marketStatus || '',
        marketStateVersion: Number(snapshot.marketStateVersion ?? 0),
        current: Object.entries(snapshot.current || {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, Number(value ?? 0)]),
        winner: snapshot.winner || null,
      };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12);
}
