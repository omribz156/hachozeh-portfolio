// Pure avatar-display selection for the header island. Plain JS (no Preact) so it
// is reusable by future header islands (the menu-row avatar) and self-checkable
// with node:assert — see header-avatar-display.test.mjs.
//
// The load-bearing rule is the flash doctrine: the SSR-derived props are
// authoritative for first paint. We only override a field with a LIVE value once
// the auth session is fully settled (initialized, not loading) AND carries real
// identity. During the post-hydration loading window the seeded state is
// `authenticated: true` but user/identity are still null (auth-session.js seeds
// only `authenticated` from __NAVI_SSR_AUTH); deriving then would degrade the
// avatar to 'משתמש'/'מ' and flip the SSR-correct letter — the exact flash we kill.

const FALLBACK_INITIAL = 'ח';

// Derive display values from the live NaviAuthSession.getState() shape. getState()
// exposes user/identity/reputation/actor at the top level (no `.payload`).
export function deriveFromAuth(auth) {
  const name =
    auth?.user?.displayName ||
    auth?.user?.name ||
    auth?.user?.handle ||
    auth?.identity?.identifierHint ||
    'משתמש';
  const initial = (String(name).trim()[0] || FALLBACK_INITIAL).toLocaleUpperCase('he-IL');
  const avatarUrl = auth?.user?.avatarUrl || '';
  const tier = auth?.reputation?.verification?.currentTier || null;
  const sub = auth?.capabilities?.canTrade ? 'מסחר פעיל' : 'קריאה בלבד';
  return { initial, avatarUrl, tier, name, sub };
}

// True only when the live session is settled and really signed in with identity
// data — the only condition under which we may override the SSR props.
export function hasLiveIdentity(auth) {
  return Boolean(
    auth &&
      auth.enabled &&
      auth.initialized &&
      auth.authenticated &&
      !auth.loading &&
      (auth.user || auth.identity)
  );
}

// props = SSR-derived { initial, avatarUrl, tier, name, sub }. Returns the values to render.
export function pickDisplay(auth, props) {
  if (hasLiveIdentity(auth)) return deriveFromAuth(auth);
  return {
    initial: props.initial,
    avatarUrl: props.avatarUrl || '',
    tier: props.tier || null,
    name: props.name || 'משתמש',
    sub: props.sub || 'קריאה בלבד',
  };
}
