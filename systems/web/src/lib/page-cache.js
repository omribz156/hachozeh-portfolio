// Cache only explicitly public, anonymous documents; never auth or attribution.
export function applyPageCache(headers, request, url, status) {
  if (!headers.get('content-type')?.includes('text/html')) return;
  const publicPage = url.pathname === '/' || url.pathname === '/closing-markets'
    || /^\/markets\/[^/]+\/?$/.test(url.pathname);
  const cacheable = publicPage && ['GET', 'HEAD'].includes(request.method)
    && status === 200 && !url.search && !request.headers.has('cookie')
    && !request.headers.has('authorization') && !headers.has('set-cookie');
  headers.set('Cache-Control', cacheable
    ? 'public, max-age=0, s-maxage=60, must-revalidate'
    : 'private, no-store');
}
