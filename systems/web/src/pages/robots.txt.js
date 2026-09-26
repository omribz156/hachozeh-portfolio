import { SITE_ORIGIN } from '../lib/seo.js';

export function GET() {
  const aiCrawlers = [
    'OAI-SearchBot',
    'GPTBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-User',
    'PerplexityBot',
    'Google-Extended',
    'Applebot',
    'Applebot-Extended',
    'CCBot',
  ];
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /fallback',
    '',
    ...aiCrawlers.flatMap((agent) => [
      `User-agent: ${agent}`,
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /fallback',
      '',
    ]),
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    `# AI assistant guide: ${SITE_ORIGIN}/llms.txt`,
    `# Expanded AI assistant guide: ${SITE_ORIGIN}/llms-full.txt`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
