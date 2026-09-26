// Legacy comparison server:
// python3 -m http.server 4173 --directory systems/front
//
// Astro app server:
// npm --prefix systems/web run dev

const ASTRO_BASE = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';
const LEGACY_BASE = process.env.LEGACY_BASE_URL || 'http://127.0.0.1:4173';

export const astroMigrationTargets = [
  {
    id: 'trending',
    status: 'ported',
    legacy: `${LEGACY_BASE}/pages/trending.html`,
    astro: `${ASTRO_BASE}/trending`,
    readySelector: '[data-trending-stage] [data-market-stream]',
    mustContain: ['החוזה', 'טרנדי'],
  },
  {
    id: 'market-detail-binary',
    status: 'ported',
    marketKey: 'disc-cm-image-bucket-boi-rate-august-20260831',
    legacy: `${LEGACY_BASE}/pages/market-detail.html?source=backend&market=disc-cm-image-bucket-boi-rate-august-20260831`,
    astro: `${ASTRO_BASE}/markets/disc-cm-image-bucket-boi-rate-august-20260831`,
    readySelector: '[data-market-detail-order-ticket]',
    mobileReadySelector: '.market-detail-page-title',
    mustContain: ['קנייה'],
  },
  {
    id: 'market-detail-multi',
    status: 'ported',
    marketKey: 'disc-cm-weather-tlv-tdmax-2026-06-04-5out-b25k',
    legacy: `${LEGACY_BASE}/pages/market-detail.html?source=backend&market=disc-cm-weather-tlv-tdmax-2026-06-04-5out-b25k`,
    astro: `${ASTRO_BASE}/markets/disc-cm-weather-tlv-tdmax-2026-06-04-5out-b25k`,
    readySelector: '[data-market-detail-order-ticket] [data-order-ticket-title]',
    mobileReadySelector: '.market-detail-page-title',
    mustContain: ['קנייה · כן', 'כמה להשקיע', 'כן', 'לא'],
  },
  {
    id: 'breaking-markets',
    status: 'ported',
    legacy: `${LEGACY_BASE}/pages/breaking-markets.html`,
    astro: `${ASTRO_BASE}/breaking-markets`,
    readySelector: '[data-breaking-stage] [data-breaking-rows]',
    mobileReadySelector: '[data-breaking-stage] [data-breaking-rows]',
    mustContain: ['חדשות מתפרצות'],
  },
  {
    id: 'new-markets',
    status: 'stub',
    legacy: `${LEGACY_BASE}/pages/new-markets.html`,
    astro: `${ASTRO_BASE}/new-markets`,
    readySelector: '[data-static-page="new-markets"]',
    mustContain: ['שווקים חדשים', 'בבנייה'],
  },
  {
    id: 'graphs-and-accuracy',
    status: 'stub',
    legacy: `${LEGACY_BASE}/pages/graphs-and-accuracy.html`,
    astro: `${ASTRO_BASE}/graphs-and-accuracy`,
    readySelector: '[data-static-page="graphs-and-accuracy"]',
    mustContain: ['דיוק תחזיות', 'בבנייה'],
  },
  {
    id: 'qanda',
    status: 'stub',
    legacy: `${LEGACY_BASE}/pages/qanda.html`,
    astro: `${ASTRO_BASE}/qanda`,
    readySelector: '[data-static-page="qanda"]',
    mustContain: ['שאלות ותשובות', 'בבנייה'],
  },
  {
    id: 'portfolio',
    status: 'ported',
    legacy: `${LEGACY_BASE}/pages/portfolio.html`,
    astro: `${ASTRO_BASE}/portfolio`,
    readySelector: '[data-portfolio-total]',
    mustContain: ['שווי תיק', 'פוזיציות'],
  },
  {
    id: 'fallback-login',
    status: 'redirect',
    legacy: `${LEGACY_BASE}/pages/fallback/login.html`,
    astro: `${ASTRO_BASE}/fallback/login`,
    readySelector: '[data-page-overlay-root][data-active="true"] .navi-overlay-panel',
    mustContain: ['ברוך הבא חזרה'],
  },
];

export function runnableAstroTargets(targets = astroMigrationTargets) {
  return targets.filter((target) => target.status !== 'missing');
}

export function resolveAstroTargets(rawTargets, targets = astroMigrationTargets) {
  const requestedTargets = (rawTargets || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const selectedTargets =
    requestedTargets.length > 0
      ? targets.filter((target) => requestedTargets.includes(target.id))
      : targets;

  return {
    requestedTargets,
    selectedTargets,
  };
}
