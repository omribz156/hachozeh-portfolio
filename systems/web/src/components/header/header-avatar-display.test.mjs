// Self-check for the flash-avoidance rule. Run: node header-avatar-display.test.mjs
import assert from 'node:assert/strict';
import { deriveFromAuth, pickDisplay } from './header-avatar-display.js';

const props = { initial: 'O', avatarUrl: '', tier: 'gold', name: 'Omri', sub: 'מסחר פעיל' };

// 1. Cold-cache loading window: authenticated seed but user/identity not yet loaded
//    → MUST keep SSR props (no flip to 'מ', no lost tier ring, no name/sub flip).
const loading = { enabled: true, initialized: true, authenticated: true, loading: true, user: null, identity: null };
assert.deepEqual(pickDisplay(loading, props), { initial: 'O', avatarUrl: '', tier: 'gold', name: 'Omri', sub: 'מסחר פעיל' });

// 2. Settled + real identity → adopt live values.
const live = { enabled: true, initialized: true, authenticated: true, loading: false,
  user: { displayName: 'Omri', avatarUrl: '/a.png' }, reputation: { verification: { currentTier: 'diamond' } },
  capabilities: { canTrade: true } };
assert.deepEqual(pickDisplay(live, props), { initial: 'O', avatarUrl: '/a.png', tier: 'diamond', name: 'Omri', sub: 'מסחר פעיל' });

// 3. Authenticated+settled but currentUser fetch failed (no user/identity) → keep props.
const noUser = { enabled: true, initialized: true, authenticated: true, loading: false, user: null, identity: null };
assert.deepEqual(pickDisplay(noUser, props), { initial: 'O', avatarUrl: '', tier: 'gold', name: 'Omri', sub: 'מסחר פעיל' });

// 4. SSR / pre-hydration (auth null) → props verbatim.
assert.deepEqual(pickDisplay(null, props), { initial: 'O', avatarUrl: '', tier: 'gold', name: 'Omri', sub: 'מסחר פעיל' });

// 5. Loading window keeps prop name (the flash rule extended to text fields).
const loadingWithName = { enabled: true, initialized: true, authenticated: true, loading: true, user: { displayName: 'Live Name' }, identity: null };
assert.equal(pickDisplay(loadingWithName, props).name, 'Omri', 'loading window must keep prop name, not derive');

// 6. Settled session adopts derived name and sub.
const liveReadonly = { enabled: true, initialized: true, authenticated: true, loading: false,
  user: { displayName: 'Live Name', avatarUrl: '' }, capabilities: { canTrade: false } };
const settled = pickDisplay(liveReadonly, props);
assert.equal(settled.name, 'Live Name', 'settled session adopts derived name');
assert.equal(settled.sub, 'קריאה בלבד', 'settled session with canTrade=false uses read-only sub');

// 7. Raw actor ids are plumbing, not display identity.
const actorOnly = { enabled: true, initialized: true, authenticated: true, loading: false, actor: { id: 'user_secret_internal' } };
assert.equal(deriveFromAuth(actorOnly).name, 'משתמש', 'actor id must not become a visible display name');

console.log('ok — header-avatar-display flash rule holds (7 checks)');
