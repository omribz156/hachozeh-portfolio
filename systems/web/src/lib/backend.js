// Single source of truth for the SSR → backend URL.
// All server-side lib modules must import from here instead of re-defining.
//
// A non-empty BACKEND_INTERNAL_URL must be an absolute http(s) URL: callers
// pass it as the base of `new URL(path, BACKEND_INTERNAL_URL)`, where a
// relative value throws TypeError on every data-bearing SSR page. Fail at
// module load with a named error instead of 500ing per request.
function resolveBackendInternalUrl() {
  const raw = process.env.BACKEND_INTERNAL_URL;
  const host = process.env.BACKEND_INTERNAL_HOST;
  const port = process.env.BACKEND_INTERNAL_PORT;
  if ((!raw || !raw.trim()) && host && port) {
    return `http://${host.trim()}:${port.trim()}`;
  }
  if (!raw || !raw.trim()) {
    return 'http://127.0.0.1:3001';
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `BACKEND_INTERNAL_URL must be an absolute http(s) URL, got: "${raw}"`
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `BACKEND_INTERNAL_URL must use http or https, got: "${raw}"`
    );
  }
  return raw.trim();
}

export const BACKEND_INTERNAL_URL = resolveBackendInternalUrl();
