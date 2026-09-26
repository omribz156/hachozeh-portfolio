import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const backendBase = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:3001';
export const astroBase = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';

// Cached storageState so we authenticate once across the whole suite — auth/start
// is rate-limited, so re-logging-in per spec would trip it. Delete the tmp file to
// force a fresh login (e.g. if the session cookie has expired between runs).
export const OMRIB_STATE = path.join(os.tmpdir(), 'navi-e2e-omrib-state.json');

// Parse a (possibly comma-merged) Set-Cookie header into Playwright cookie records.
// Node's fetch merges multiple Set-Cookie with ", " — split on comma-before-token.
function parseSetCookie(setCookie) {
  const cookies = [];
  for (const part of (setCookie || '').split(/,(?=[^ ])/)) {
    const [nameVal, ...attrs] = part.split(';').map((s) => s.trim());
    if (!nameVal || !nameVal.includes('=')) continue;
    const eq = nameVal.indexOf('=');
    const attrMap = Object.fromEntries(
      attrs.map((a) => {
        const i = a.indexOf('=');
        return i >= 0 ? [a.slice(0, i).toLowerCase(), a.slice(i + 1)] : [a.toLowerCase(), true];
      })
    );
    cookies.push({
      name: nameVal.slice(0, eq),
      value: nameVal.slice(eq + 1),
      // host-scoped (cookies ignore port) so :3001's session is sent to :6969
      domain: '127.0.0.1',
      path: attrMap.path || '/',
      expires: attrMap.expires ? Math.floor(new Date(attrMap.expires).getTime() / 1000) : -1,
      httpOnly: 'httponly' in attrMap,
      secure: 'secure' in attrMap,
      sameSite: attrMap.samesite
        ? attrMap.samesite[0].toUpperCase() + attrMap.samesite.slice(1).toLowerCase()
        : 'Lax',
    });
  }
  return cookies;
}

/** Mint (once, cached) a storageState file for the data-rich `omrib` account and
 *  return its path. AUTHED SPEC USAGE — top of file, then declare the option:
 *
 *    await ensureOmribStorageState();
 *    test.use({ storageState: OMRIB_STATE });
 *
 *  Must run at MODULE LOAD (top-level await), NOT in `beforeAll`: Playwright 1.60's
 *  `test.use({ storageState })` resolves the file before any fixture (incl. beforeAll's
 *  `browser`/`request`) is built, so the file has to exist at import time. We auth with
 *  Node's native fetch (no Playwright fixture needed) to sidestep that. Delete OMRIB_STATE
 *  to force a fresh login if the cookie has expired. */
export async function ensureOmribStorageState({ identifier = 'omrib@navi.local' } = {}) {
  if (fs.existsSync(OMRIB_STATE)) return OMRIB_STATE;

  const startRes = await fetch(`${backendBase}/api/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, purpose: 'login' }),
  });
  const start = await startRes.json();
  if (!startRes.ok) throw new Error(`auth/start failed: ${JSON.stringify(start)}`);

  const verifyRes = await fetch(`${backendBase}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: start.challengeId, code: start.devCode || '111111' }),
  });
  const verify = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(`auth/verify failed: ${JSON.stringify(verify)}`);

  const cookies = parseSetCookie(verifyRes.headers.get('set-cookie'));
  if (!cookies.length) throw new Error('auth/verify returned no Set-Cookie');
  await fsp.writeFile(OMRIB_STATE, JSON.stringify({ cookies, origins: [] }, null, 2));
  return OMRIB_STATE;
}

// Guest = the default context (no storageState). Admin context is added when the
// admin spec lands — needs an admin-roled identifier confirmed first.
