/** Shared UI atoms for community islands (CommunityHome + CommunityThread).
 *  Maps to finish-community-integration.md — front-only, no fetch, no localStorage.
 *
 *  Exports:
 *   - Seg         — segment-array renderer
 *   - Avatar      — tinted initial avatar
 *   - Seal        — verified / premium icon
 *   - Stack       — overlapping avatar stack
 *   - useToggles  — in-memory like/follow toggle hook
 *   - Acts        — action bar (like + comment + share)
 *   - Follow      — follow/unfollow button
 *   - MarketRef   — inline market reference card
 */
import { useState } from 'preact/hooks';
import { VShekelSymbol, VShekelText } from '../currency/VShekel.jsx';
import { replaceBrokenAvatar } from '../header/avatar-image-fallback.js';
import { toggleCommunityLike } from './community-client.js';

// Same default-avatar asset the header/profile fall back to, so a missing
// picture looks identical across the platform.
const DEFAULT_AVATAR_URL = '/assets/brand/default-avatar-96.webp';

// ── segment-array renderer ────────────────────────────────────────────────────
// segment array: strings + {s,t} side / {b} bold / {em} / {mention}
export function Seg({ parts }) {
  return (parts || []).map((p, i) => {
    if (typeof p === 'string') return p;
    if (p.s) return <span key={i} class={p.s === 'buy' ? 'side-buy' : 'side-sell'}>{p.t}</span>;
    if (p.b != null) return <b key={i}><VShekelText text={p.b} /></b>;
    if (p.em != null) return <span key={i} class="em">{p.em}</span>;
    if (p.mention != null) return <span key={i} class="mention">{p.mention}</span>;
    return null;
  });
}

// ── Avatar ────────────────────────────────────────────────────────────────────
// Matches the header/profile treatment: an author WITH a profile picture renders
// it, falling back to the same default-avatar asset the header uses if the file
// is missing (replaceBrokenAvatar). Authors with no picture at all keep the
// tinted initial, which is how the platform renders other users elsewhere
// (search results) and keeps people distinguishable in a busy feed.
export const Avatar = ({ a, size }) =>
  a?.avatarUrl
    ? (
      <img
        class={`avatar av-img${size ? ' av-' + size : ''}`}
        src={a.avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => replaceBrokenAvatar(e, DEFAULT_AVATAR_URL)}
      />
    )
    : <span class={`avatar${size ? ' av-' + size : ''} ${a?.tint || 't-amber'}`}>{a?.initial || 'ח'}</span>;

// ── Seal ──────────────────────────────────────────────────────────────────────
export const Seal = ({ kind }) =>
  kind
    ? <span class={`cm-seal material-symbols-outlined${kind === 'workspace_premium' ? ' brand' : ''}`} style="font-size:13px;">{kind}</span>
    : null;

// ── Stack ─────────────────────────────────────────────────────────────────────
// Overlapping faces of the people talking in a discussion. Items are author-shaped
// ({name,tint,initial,avatarUrl}) so a real profile picture renders; the legacy
// {t,i} seed shape is still accepted.
export const Stack = ({ items }) =>
  <div class="co-stack">
    {(items || []).map((s, i) => (
      <Avatar key={i} a={s.tint || s.avatarUrl ? s : { tint: s.t, initial: s.i }} />
    ))}
  </div>;

// ── useToggles ────────────────────────────────────────────────────────────────
// Each island calls this once and owns its like/follow state. Likes are REAL:
// the button flips optimistically, then POSTs the toggle and reconciles against
// the server's authoritative { likes, liked } (reverting if the write fails).
// initialLikes: { [key]: { n: number, on: boolean, tid?: string } }
//   `key` is the map/UI key; `tid` is the real target id to toggle (defaults to
//   the key — they differ only for the opening post, whose key is 'op').
// initialFollows: string[]  — keys that start as followed (usually [])
export function useToggles(initialLikes = {}, initialFollows = []) {
  const [likes, setLikes] = useState(initialLikes);
  const [follows, setFollows] = useState(() => new Set(initialFollows));

  const toggleLike = (key) => {
    const cur = likes[key];
    if (!cur) return;
    const tid = cur.tid || key;
    const nextOn = !cur.on;
    // optimistic flip
    setLikes((m) => (m[key] ? { ...m, [key]: { ...m[key], n: nextOn ? m[key].n + 1 : m[key].n - 1, on: nextOn } } : m));
    // fire + reconcile against the authoritative count
    toggleCommunityLike(tid)
      .then((res) => {
        if (res && typeof res.likes === 'number') {
          setLikes((m) => (m[key] ? { ...m, [key]: { ...m[key], n: res.likes, on: !!res.liked } } : m));
        }
      })
      .catch(() => {
        setLikes((m) => (m[key] ? { ...m, [key]: { ...m[key], n: cur.n, on: cur.on } } : m));
      });
  };

  // Merge fresh like entries after a refetch (keeps the map in sync with new
  // feed/comment items). Server values are authoritative, so they overwrite.
  const seedLikes = (entries) =>
    setLikes((m) => {
      const next = { ...m };
      for (const [key, val] of Object.entries(entries || {})) {
        next[key] = { ...val, tid: val.tid || key };
      }
      return next;
    });

  const toggleFollow = (key) =>
    setFollows((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return { likes, follows, toggleLike, toggleFollow, seedLikes };
}

// ── Acts ──────────────────────────────────────────────────────────────────────
// likes map entry for `id` must exist; share=false hides the share button.
// onComment (optional): makes the comment button interactive (feed posts that
// support replies). When absent the comment button is a static count.
export const Acts = ({ id, comments, share = true, likes, onLike, onComment, commentOpen }) => (
  <div class="cm-acts">
    <button
      class={`cm-act like${likes[id]?.on ? ' on' : ''}`}
      type="button"
      onClick={() => onLike(id)}
    >
      <span class="material-symbols-outlined">favorite</span>
      <span class="n">{likes[id]?.n}</span>
    </button>
    <button
      class={`cm-act${commentOpen ? ' on' : ''}`}
      type="button"
      onClick={!onComment ? undefined : () => onComment(id)}
      aria-expanded={onComment ? (commentOpen ? 'true' : 'false') : undefined}
    >
      <span class="material-symbols-outlined">mode_comment</span>
      {comments != null && <span class="n">{comments}</span>}
    </button>
    {share && (
      <button class="cm-act" type="button">
        <span class="material-symbols-outlined">ios_share</span>
      </button>
    )}
  </div>
);

// ── MoreMenu (⋯) ──────────────────────────────────────────────────────────────
// Notice-and-action affordance, same shape as the market-comment menu: report
// someone else's content, delete your own. kind ∈ {discussion, comment, post}.
export function MoreMenu({ kind, id, isMine, authed, onDeleted, onNeedsAuth }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function report() {
    if (!authed) { setOpen(false); onNeedsAuth?.(); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/community/${kind}/${encodeURIComponent(id)}/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
      });
      setDone(res.ok ? 'הדיווח נשלח' : 'הדיווח נכשל');
    } catch {
      setDone('הדיווח נכשל');
    } finally {
      setBusy(false);
      setTimeout(() => { setOpen(false); setDone(null); }, 1400);
    }
  }

  async function remove() {
    if (!authed) { setOpen(false); onNeedsAuth?.(); return; }
    if (typeof window !== 'undefined' && !window.confirm('למחוק לצמיתות?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/community/${kind}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (res.ok) { setOpen(false); onDeleted?.(id); return; }
      setDone('המחיקה נכשלה');
    } catch {
      setDone('המחיקה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="cm-more-wrap">
      <button
        class={`cm-act cm-more-btn${open ? ' on' : ''}`}
        type="button"
        aria-label="עוד פעולות"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="material-symbols-outlined">more_horiz</span>
      </button>
      {open && (
        <>
          <div class="cm-more-scrim" onClick={() => setOpen(false)} />
          <div class="cm-more-pop" role="menu">
            {done ? (
              <div class="cm-more-done">{done}</div>
            ) : isMine ? (
              <button class="cm-more-opt is-danger" type="button" role="menuitem" disabled={busy} onClick={remove}>
                <span class="material-symbols-outlined">delete</span>מחיקה
              </button>
            ) : (
              <button class="cm-more-opt" type="button" role="menuitem" disabled={busy} onClick={report}>
                <span class="material-symbols-outlined">flag</span>דיווח
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Follow ────────────────────────────────────────────────────────────────────
export const Follow = ({ k, follows, onFollow }) => {
  const on = follows.has(k);
  return (
    <button
      class={`cm-follow${on ? ' is-following' : ''}`}
      type="button"
      aria-pressed={on ? 'true' : 'false'}
      onClick={() => onFollow(k)}
    >
      <span class="material-symbols-outlined">{on ? 'check' : 'add'}</span>
      {on ? 'עוקב' : 'עקוב'}
    </button>
  );
};

// ── MarketRef ─────────────────────────────────────────────────────────────────
export const MarketRef = ({ m }) => {
  const href = m.href || (m.marketKey ? `/markets/${m.marketKey}` : '#');
  return (
  <a class="cm-mref" href={href} onClick={href !== '#' ? undefined : (e) => e.preventDefault()}>
    <div class="cm-mref-body">
      <div class="cm-mref-cat">{m.cat}</div>
      <div class="cm-mref-t">{m.title}</div>
      {m.verdict && (
        <div class="cm-receipt" style="margin-top:var(--hz-space-3);">
          <span class={`verdict ${m.verdict.kind}`}>{m.verdict.label}</span>
          <span class="cm-dotlist"><span>נכנסה ב־<span class="mono">{m.entry}</span></span></span>
        </div>
      )}
    </div>
    {m.spark && <span class="cm-spark"></span>}
    {m.chip && <span class="cm-mvchip up">{m.chip}</span>}
    {m.pnl ? (
      <div class="cm-mref-prob">
        <div class={`cm-pnl ${/^[−-]/.test(String(m.pnl)) ? 'neg' : 'pos'}`} style="font-size:1.25rem;">{m.pnl}</div>
        <div class="mv flat" style="color:var(--hz-text-muted);"><VShekelSymbol /></div>
      </div>
    ) : m.prob != null ? (
      <div class="cm-mref-prob">
        <div class="p">{m.prob}<span class="pct">%</span></div>
        <div class={`mv ${m.mv.dir}`}>{m.mv.val}</div>
      </div>
    ) : (
      <div class="cm-mref-prob">
        <div class="cm-mref-ev"><span class="material-symbols-outlined">account_tree</span></div>
      </div>
    )}
  </a>
  );
};
