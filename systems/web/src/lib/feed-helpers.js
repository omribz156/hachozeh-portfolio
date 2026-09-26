export const CATEGORY_LOOK = {
  economy: { emoji: '📈', tone: 'amber' },
  fx: { emoji: '💱', tone: 'amber' },
  commodities: { emoji: '🛢️', tone: 'amber' },
  awards: { emoji: '🏆', tone: 'amber' },
  crypto: { emoji: '₿', tone: 'warn' },
  business: { emoji: '🏢', tone: 'warn' },
  entertainment: { emoji: '🎭', tone: 'warn' },
  travel: { emoji: '✈️', tone: 'warn' },
  weather: { emoji: '🌤️', tone: 'warn' },
  climate: { emoji: '🌤️', tone: 'warn' },
  transportation: { emoji: '🚌', tone: 'warn' },
  politics: { emoji: '🗳️', tone: 'info' },
  world: { emoji: '🌍', tone: 'info' },
  international: { emoji: '🌍', tone: 'info' },
  news: { emoji: '📰', tone: 'info' },
  technology: { emoji: '💻', tone: 'info' },
  tech: { emoji: '💻', tone: 'info' },
  ai: { emoji: '🤖', tone: 'info' },
  science: { emoji: '🔬', tone: 'info' },
  sports: { emoji: '🏀', tone: 'buy' },
  esports: { emoji: '🎮', tone: 'buy' },
  social: { emoji: '💬', tone: 'buy' },
  health: { emoji: '🩺', tone: 'buy' },
  education: { emoji: '🎓', tone: 'buy' },
  energy: { emoji: '⛽', tone: 'amber' },
  legislation: { emoji: '⚖️', tone: 'sell' },
  security: { emoji: '🛡️', tone: 'sell' },
  general: { emoji: '📊', tone: 'mono' },
  default: { emoji: '📊', tone: 'mono' },
};

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function getProb(outcome) {
  if (typeof outcome?.probability === 'number') return clamp(outcome.probability, 0, 100);
  const parsed = Number.parseFloat(String(outcome?.displayProbability ?? '0').replace('%', ''));
  return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : 0;
}

export function sortByProb(market) {
  return [...(market?.outcomes || [])].sort((a, b) => getProb(b) - getProb(a));
}

export function volumeShort(market) {
  return String(market?.volume?.label || '').replace(/^נפח מסחר:\s*/, '');
}

export function closeLabel(market) {
  return market?.timeToCloseLabel || market?.closeLabel || '';
}

export function getSignal(market) {
  const signals = Array.isArray(market?.signals) ? market.signals : [];
  for (const type of ['live', 'hot', 'moved', 'breaking', 'closing', 'new']) {
    const signal = signals.find((entry) => entry?.type === type);
    if (signal) return { tone: signal.tone, label: signal.label };
  }
  return null;
}

export function categoryLook(categoryKey) {
  return CATEGORY_LOOK[categoryKey] || CATEGORY_LOOK.default;
}
