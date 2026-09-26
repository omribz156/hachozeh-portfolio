import { PUBLIC_CATEGORY_HUBS, categoryHubPath } from '../lib/category-hubs.js';
import { SITE_ORIGIN } from '../lib/seo.js';

function link(label, pathOrUrl) {
  const href = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${SITE_ORIGIN}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  return `[${label}](${href})`;
}

export function GET() {
  const categoryLines = PUBLIC_CATEGORY_HUBS
    .map((category) => `- ${link(category.label, categoryHubPath(category.key))}: ${category.description}`)
    .join('\n');
  const body = [
    '# החוזה / Hachozeh',
    '',
    '> Hachozeh is a Hebrew-first prediction market platform for Israeli users. People forecast future events using V₪, an internal virtual currency that cannot be bought, withdrawn, or converted to real money.',
    '',
    '## Product',
    '',
    '- Product name: Hachozeh / החוזה',
    '- Language and market: Hebrew-first, Israel-focused',
    '- Currency model: V₪ is virtual only; no deposits, withdrawals, or cash prizes',
    '- Core use: browse markets, read probabilities, take virtual positions, and review resolved outcomes',
    '',
    '## Public Pages',
    '',
    `- ${link('Home / trending markets', '/')}: current public market discovery page`,
    `- ${link('Closing soon markets', '/closing-markets')}: markets ending in the next 24 hours`,
    `- ${link('Breaking markets', '/breaking-markets')}: markets with recent movement`,
    `- ${link('All markets', '/markets')}: browse every open and resolved market in one place`,
    `- ${link('Forecasters directory', '/traders')}: public profiles of the community's forecasters`,
    `- ${link('Community', '/community')}: public discussions, live market activity, and forecasters to follow`,
    `- ${link('Help center', '/help')}: product explanations and user support`,
    `- ${link('Platform accuracy', '/graphs-and-accuracy')}: public transparency and accuracy surface`,
    `- ${link('Terms', '/terms')}: terms of use`,
    `- ${link('Privacy', '/privacy')}: privacy policy`,
    `- ${link('Cookies', '/cookies')}: cookie policy`,
    `- ${link('Accessibility', '/accessibility')}: accessibility statement`,
    '',
    '## Markets And Profiles',
    '',
    `- Market pages use ${link('/markets/{marketKey}', '/markets/{marketKey}')} or ${link('/event/{eventSlug}', '/event/{eventSlug}')}`,
    `- Recurring-series hubs use ${link('/series/{familyKey}', '/series/{familyKey}')}: an evergreen page per recurring series (e.g. Bank of Israel rate decisions) linking the current market and past instances`,
    `- Entity topic hubs use ${link('/t/{slug}', '/t/{slug}')}: an indexable page clustering every market about one entity (e.g. bank-of-israel, world-cup-2026, knesset, eurovision)`,
    `- Public profiles use ${link('/@{handle}', '/@{handle}')}`,
    `- XML sitemap: ${link('/sitemap.xml', '/sitemap.xml')}`,
    `- RSS feed: ${link('/feeds/trending.xml', '/feeds/trending.xml')}`,
    `- Closing-soon RSS feed: ${link('/feeds/closing.xml', '/feeds/closing.xml')}`,
    `- Expanded assistant guide: ${link('/llms-full.txt', '/llms-full.txt')}`,
    '',
    '## Categories',
    '',
    categoryLines,
    '',
    '## Boundaries',
    '',
    '- Public pages may be crawled and cited.',
    '- Do not treat admin, settings, portfolio, fallback, or authenticated-only pages as public source material.',
    '- Hachozeh is not a real-money gambling or investment platform.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
