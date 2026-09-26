import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

const RUNTIME_WAIT_ATTEMPTS = 50;
const RUNTIME_WAIT_MS = 30;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getAuthState() {
  return window.NaviAuthSession?.getState?.() || null;
}

function resolvePortfolioAuthCacheKey(auth = getAuthState()) {
  if (!auth || auth.enabled !== true) return "auth-disabled";
  if (auth.loading || auth.initialized !== true) return "auth-pending";
  if (auth.authenticated !== true) return "auth-signed-out";

  const userId = auth?.user?.userId || auth?.actor?.userId || auth?.actor?.id;
  return userId ? `user:${userId}` : "auth-without-identity";
}

function serializePortfolioError(error, source) {
  return {
    source,
    name: error?.name || 'Error',
    message: error?.message || 'Portfolio content failed to load.',
    code: error?.code || 'portfolio_content_error',
    status: error?.status || null,
  };
}

function emitPortfolioContentError(error, source) {
  if (typeof window === 'undefined') return;
  const detail = serializePortfolioError(error, source);
  window.dispatchEvent(new CustomEvent('navi:portfolio-content-error', { detail }));
}

async function waitForPortfolioRuntime() {
  for (let attempt = 0; attempt <= RUNTIME_WAIT_ATTEMPTS; attempt += 1) {
    const ds = window.NaviPortfolioDataSource;
    const vm = window.NaviPortfolioViewModel;
    if (ds?.readPortfolioRecord && vm?.buildFromBackend) {
      return { ds, vm };
    }
    if (attempt < RUNTIME_WAIT_ATTEMPTS) {
      await sleep(RUNTIME_WAIT_MS);
    }
  }

  const error = new Error('Portfolio runtime helpers are unavailable.');
  error.code = 'portfolio_runtime_unavailable';
  throw error;
}

// Shared hook: model + auth logic, consumed by every portfolio card island so
// they don't duplicate the data read + subscriptions.
//
// Returns { model, refresh }
//   model — null until first successful load; cleared on sign-out
//   refresh — idempotent: clears on signed-out, replaces only on success
//
// (There's no portfolio/personal view here anymore — the toggle + personal zone
// moved to a dedicated page, so the islands always render once a model loads.)

// True unless auth is enabled AND the user is initialized-but-not-authenticated.
export function isAuthed() {
  const auth = getAuthState();
  if (!auth || auth.enabled !== true) return true; // auth disabled → visible
  return auth.initialized === true && auth.authenticated === true;
}

// Pull the current model from the shared vanilla data layer. No fetch of our
// own — the data-source caches the record the orchestrator already loaded.
async function readModel() {
  const { ds, vm } = await waitForPortfolioRuntime();
  const record = await ds.readPortfolioRecord();
  if (!record) {
    const error = ds.getLastError?.() || new Error('Portfolio backend record is unavailable.');
    error.code = error.code || 'portfolio_record_unavailable';
    throw error;
  }
  return vm.buildFromBackend(record.payload);
}

export default function usePortfolioModel() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const modelRef = useRef(null);
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const authKey = resolvePortfolioAuthCacheKey();
    const requestGeneration = ++refreshGenerationRef.current;
    // Signed out → clear so a previous user's data never lingers.
    if (!isAuthed()) {
      modelRef.current = null;
      setModel(null);
      setError(null);
      return null;
    }
    let m = null;
    try {
      m = await readModel();
    } catch (error) {
      if (refreshGenerationRef.current !== requestGeneration) {
        return null;
      }
      if (resolvePortfolioAuthCacheKey() !== authKey) {
        return null;
      }
      setError(error);
      if (!modelRef.current) {
        emitPortfolioContentError(error, 'usePortfolioModel');
      } else {
        console.warn('[portfolio] refresh failed; keeping previous model', error);
      }
      return null;
    }
    if (refreshGenerationRef.current !== requestGeneration) {
      return null;
    }
    if (resolvePortfolioAuthCacheKey() !== authKey) {
      return null;
    }
    // Authed: only replace on success — no flash on a transient null.
    if (m) {
      modelRef.current = m;
      setModel(m);
      setError(null);
    }
    return m;
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('navi:portfolio-snapshot-updated', refresh);
    window.addEventListener('navi:auth-state', refresh);
    return () => {
      refreshGenerationRef.current += 1;
      window.removeEventListener('navi:portfolio-snapshot-updated', refresh);
      window.removeEventListener('navi:auth-state', refresh);
    };
  }, [refresh]);

  return { model, refresh, error };
}
