import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createTrafficMonitor } from '../../../shared/security-traffic';
import { BACKEND_INTERNAL_URL } from './backend.js';
import { createAccessLogBudget, securityFingerprint, securityLog } from '../../../shared/security-log';

const requestHeaders = new AsyncLocalStorage<Headers>();
const secret = process.env.HACHOZEH_PROXY_SECRET || '';

export function trustedRequestHeaders(request: Request): Headers {
  const headers = new Headers({ accept: 'application/json' });
  const supplied = request.headers.get('x-hachozeh-proxy-secret') || '';
  const trusted = secret && timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(supplied).digest());
  if (trusted) {
    headers.set('x-hachozeh-proxy-secret', secret);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    if (isIP(ip)) headers.set('x-forwarded-for', ip);
    headers.set('user-agent', (request.headers.get('user-agent') || 'unknown').slice(0, 512));
  }
  const requestId = trusted && /^[a-f0-9-]{36}$/.test(request.headers.get('x-request-id') || '') ? request.headers.get('x-request-id')! : randomUUID();
  headers.set('x-request-id', requestId);
  return headers;
}

export function withBackendRequest<T>(request: Request, run: () => T): T {
  return requestHeaders.run(trustedRequestHeaders(request), run);
}

export function backendFetch(input: string | URL, init: RequestInit = {}) {
  const url = new URL(input, BACKEND_INTERNAL_URL);
  if (url.origin !== new URL(BACKEND_INTERNAL_URL).origin) throw new Error('Unexpected backend origin');
  const headers = new Headers(requestHeaders.getStore());
  new Headers(init.headers).forEach((value, key) => {
    if (!['x-hachozeh-proxy-secret', 'x-forwarded-for'].includes(key)) headers.set(key, value);
  });
  return fetch(url, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(5_000) });
}

export const webTraffic = createTrafficMonitor({ source: 'web', send: async (signal) => {
  console.info(JSON.stringify({ event: 'security.traffic', ...signal }));
  if (!secret) return false;
  try {
    const response = await fetch(new URL('/internal/security-traffic', BACKEND_INTERNAL_URL), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hachozeh-proxy-secret': secret },
      body: JSON.stringify(signal), signal: AbortSignal.timeout(6_000),
    });
    const body = await response.json();
    return response.ok && body.delivered === true;
  } catch { return false; }
} });
const accessLogs = createAccessLogBudget('web');
export function recordWebResponse(request: Request, status: number, durationMs: number, route: string) {
  webTraffic.observe(status);
  if (!accessLogs.allow()) return;
  const headers = requestHeaders.getStore();
  securityLog('security.web.request', { requestId: headers?.get('x-request-id') || '', method: request.method, route,
    pathHash: securityFingerprint(new URL(request.url).pathname), sourceHash: securityFingerprint(headers?.get('x-forwarded-for') || 'unknown'),
    sourceTrust: headers?.has('x-hachozeh-proxy-secret') ? 'gateway' : 'unknown', status, durationMs });
}
const timer = setInterval(() => { webTraffic.tick(); accessLogs.flush(); }, 30_000);
timer.unref();
