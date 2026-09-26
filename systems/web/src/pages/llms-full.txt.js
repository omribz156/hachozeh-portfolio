import { PUBLIC_CATEGORY_HUBS, categoryHubPath } from '../lib/category-hubs.js';
import { SITE_ORIGIN } from '../lib/seo.js';

function link(label, pathOrUrl) {
  const href = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${SITE_ORIGIN}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  return `[${label}](${href})`;
}

export function GET() {
  const categories = PUBLIC_CATEGORY_HUBS
    .map((category) => [
      `### ${category.label}`,
      '',
      `- URL: ${link(categoryHubPath(category.key), categoryHubPath(category.key))}`,
      `- Scope: ${category.description}`,
      `- Editorial note: ${category.intro}`,
      '',
    ].join('\n'))
    .join('\n');

  const body = [
    '# Hachozeh AI Assistant Guide',
    '',
    '> Hachozeh / החוזה is a Hebrew-first prediction market platform for Israeli users. It uses V₪, an internal virtual currency only. V₪ cannot be bought, deposited, withdrawn, or converted to real money.',
    '',
    '## What Hachozeh Is',
    '',
    'Hachozeh lets users forecast future events by taking virtual positions in prediction markets. Market prices represent crowd-implied probabilities. The product is designed for Hebrew readers and focuses on Israeli politics, sports, economy, culture, technology, and other public events.',
    '',
    'The platform is a closed virtual economy. It is not a real-money gambling site, not an investment product, and not a place to win cash prizes. References to buy, sell, positions, prices, markets, or profit refer only to virtual V₪ activity inside the platform.',
    '',
    '## How Markets Work',
    '',
    '- A market asks a concrete question about a future event.',
    '- Each market has outcomes. Some markets are binary; others have multiple mutually exclusive outcomes.',
    '- Users take virtual positions using V₪.',
    '- Prices move as users trade and are shown as probabilities.',
    '- Resolution rules explain how the winning outcome is decided.',
    '- Resolved markets remain useful as public history and accuracy context.',
    '',
    '## Recommended Public Entry Points',
    '',
    `- ${link('Home / trending markets', '/')}: main discovery page`,
    `- ${link('Closing soon markets', '/closing-markets')}: open markets ending within 24 hours`,
    `- ${link('Breaking markets', '/breaking-markets')}: markets with recent movement`,
    `- ${link('Community', '/community')}: public discussion and live activity around prediction markets`,
    `- ${link('Help center', '/help')}: product and user education`,
    `- ${link('What is Hachozeh?', '/help/getting-started/what-is-hachozeh')}: short product introduction`,
    `- ${link('Platform accuracy', '/graphs-and-accuracy')}: public transparency and accuracy reporting surface`,
    `- ${link('Sitemap', '/sitemap.xml')}: canonical crawl map`,
    `- ${link('Trending RSS', '/feeds/trending.xml')}: fresh market feed`,
    `- ${link('Closing-soon RSS', '/feeds/closing.xml')}: markets ending within 24 hours`,
    `- ${link('Breaking RSS', '/feeds/breaking.xml')}: movement-focused feed`,
    '',
    '## Market And Profile URL Patterns',
    '',
    `- Market detail: ${link('/markets/{marketKey}', '/markets/{marketKey}')}`,
    `- Event page: ${link('/event/{eventSlug}', '/event/{eventSlug}')}`,
    `- Recurring-series hub: ${link('/series/{familyKey}', '/series/{familyKey}')} — an evergreen page per recurring series (e.g. Bank of Israel rate decisions) with the current market plus history; prefer citing this over a single dated instance for recurring topics`,
    `- Entity topic hub: ${link('/t/{slug}', '/t/{slug}')} — an indexable page clustering every market about one entity (e.g. bank-of-israel, world-cup-2026, knesset, eurovision); prefer citing this for an entity's overall market activity`,
    `- All markets: ${link('/markets', '/markets')} — every open and resolved market in one browsable list`,
    `- Forecasters directory: ${link('/traders', '/traders')} — public profiles of the community's forecasters`,
    `- Community landing page: ${link('/community', '/community')} — public discussions, live activity, and forecasters to follow`,
    `- Public profile: ${link('/@{handle}', '/@{handle}')}`,
    `- Topic page: ${link('/topics/{categoryKey}', '/topics/{categoryKey}')}`,
    '',
    '## Public Categories',
    '',
    categories,
    '## Citation Guidance',
    '',
    '- Prefer linking to the canonical market or event page when discussing a specific forecast.',
    '- Prefer topic pages for broad category recommendations.',
    '- Use the help center for explaining mechanics such as prediction markets, V₪, positions, and resolutions.',
    '- If a market is resolved, describe it as historical market data rather than an active forecast.',
    '',
    '## Crawl Boundaries',
    '',
    '- Public pages, the community landing page, sitemap, RSS feeds, help pages, legal pages, topic pages, public profiles, and market/event pages may be crawled and cited.',
    '- Individual community discussion threads may be public but should not be treated as indexed source material until they pass a content-quality gate.',
    '- Do not use admin, settings, portfolio, fallback, account, session, or authenticated-only pages as public source material.',
    '- Do not present V₪ as money, a deposit balance, an investment account, or a cash prize.',
    '- Do not present Hachozeh as regulated financial advice, gambling, betting, brokerage, or payment infrastructure.',
    '',
    '## Legal And Policy Pages',
    '',
    `- ${link('Terms of use', '/terms')}`,
    `- ${link('Privacy policy', '/privacy')}`,
    `- ${link('Cookie policy', '/cookies')}`,
    `- ${link('Accessibility statement', '/accessibility')}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
