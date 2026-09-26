// Community surface — Preact island.
//
// Lazy-paint contract preserved: the section waits for IntersectionObserver
// (200px rootMargin) OR requestIdleCallback before arming — same dual-trigger
// as the old community.client.js. client:visible in the .astro wrapper is an
// *additional* Astro-level gate (hydration only fires near viewport), so the
// component mounts idle/near-view and never blocks chart/sidebar hydration.

import { Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { createCommunityAdapter } from './community-adapter.js';
import * as format from './community-format.js';
import { VShekelText } from '../currency/VShekel.jsx';

// ─── Dropdown (mirrors community-dropdown.js markup + wiring in JSX) ───────

function Dropdown({ name, items, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = items.find((i) => i.value === selected) || items[0];

  // click-outside close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  return (
    <div class="hz-community-dropdown" data-dropdown={name} ref={rootRef}>
      <button
        class="hz-community-dropdown__button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={String(open)}
        data-dropdown-toggle
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <span data-dropdown-current>{current ? current.label : ''}</span>
        <span class="material-symbols-outlined text-sm">arrow_drop_down</span>
      </button>
      <div
        class="hz-community-dropdown__menu"
        role="listbox"
        hidden={!open}
        onKeyDown={(e) => {
          if (!open) return;
          const idx = items.findIndex((i) => i.value === selected);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = items[(idx + 1) % items.length];
            onSelect(next.value);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = items[(idx - 1 + items.length) % items.length];
            onSelect(prev.value);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.value}
            class={`hz-community-dropdown__item${item.value === selected ? ' is-active' : ''}`}
            type="button"
            role="option"
            aria-selected={String(item.value === selected)}
            data-dropdown-value={item.value}
            onClick={() => { setOpen(false); onSelect(item.value); }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Comments tab ───────────────────────────────────────────────────────────

const DEFAULT_AVATAR_URL = '/assets/brand/default-avatar-96.webp';

function currentAuthUser() {
  const auth = window.NaviAuthSession?.getState?.();
  if (auth?.enabled === true && auth.initialized === true && auth.authenticated !== true) return null;
  return auth?.user || null;
}

function isCommentGuest() {
  const auth = window.NaviAuthSession?.getState?.();
  return auth?.enabled === true && auth.initialized === true && auth.authenticated !== true;
}

function shellAvatarUrl() {
  const image = document.querySelector('[data-shell-user-avatar-img]:not([hidden])');
  return image?.getAttribute('src') || '';
}

// Guests who try to report are sent to signup (mirrors the TradeTicket auth-gate precedent:
// prefer the NaviOverlays API, fall back to a synthetic data-overlay-open click).
function openSignupOverlay() {
  if (window.NaviOverlays?.open) { window.NaviOverlays.open('signup'); return; }
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.dataset.overlayOpen = 'signup';
  trigger.style.display = 'none';
  document.body.appendChild(trigger);
  trigger.click();
  trigger.remove();
}

// Per-comment kebab (⋯): "delete" on your own comment, "report" on anyone else's.
function CommentMenu({ comment, onReport, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="hz-comment-menu" ref={rootRef}>
      <button
        class="hz-comment-action hz-comment-menu__trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={String(open)}
        aria-label="פעולות תגובה"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <span class="material-symbols-outlined text-sm">more_vert</span>
      </button>
      <div class="hz-comment-menu__list" role="menu" hidden={!open}>
        {comment.isMine ? (
          <button
            class="hz-comment-menu__item hz-comment-menu__item--danger"
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onDelete(comment.id); }}
          >
            <span class="material-symbols-outlined text-sm">delete</span> מחיקה
          </button>
        ) : (
          <button
            class="hz-comment-menu__item"
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onReport(comment.id); }}
          >
            <span class="material-symbols-outlined text-sm">flag</span> דיווח
          </button>
        )}
      </div>
    </div>
  );
}

function AvatarImg({ url, className, label, useDefault = true }) {
  const imageUrl = url || (useDefault ? DEFAULT_AVATAR_URL : '');
  if (imageUrl) {
    const isDefault = imageUrl === DEFAULT_AVATAR_URL;
    return (
      <div class={`hz-avatar ${className}`} aria-hidden="true">
        <img
          class="hz-avatar__img"
          src={imageUrl}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          {...(isDefault ? { 'data-default-avatar': true } : {})}
        />
      </div>
    );
  }
  if (!label) return null;
  return <div class={`hz-avatar ${className}`} aria-hidden="true">{label}</div>;
}

function userProfileHref(handle) {
  const key = String(handle || '').trim().replace(/^@/, '');
  return key ? `/@${encodeURIComponent(key)}` : '';
}

function profileHref(comment) {
  return userProfileHref(comment?.authorHandle);
}

function AuthorAvatar({ comment, className }) {
  const avatar = <AvatarImg className={className} label={comment.avatarLabel} url={comment.avatarUrl || ''} />;
  const href = profileHref(comment);
  if (!href) return avatar;
  return (
    <a
      class="hz-community-profile-link hz-community-profile-link--avatar"
      href={href}
      aria-label={`לפרופיל של ${comment.author}`}
    >
      {avatar}
    </a>
  );
}

function AuthorName({ comment }) {
  const href = profileHref(comment);
  if (!href) return <span class="hz-community-name">{comment.author}</span>;
  return <a class="hz-community-name hz-community-profile-link" href={href}>{comment.author}</a>;
}

function PublicUserAvatar({ user, className }) {
  const avatar = (
    <AvatarImg
      className={className}
      label={user.avatarLabel}
      url={user.avatarUrl || ''}
      useDefault={false}
    />
  );
  const href = userProfileHref(user.userHandle);
  if (!href) return avatar;
  return (
    <a
      class="hz-community-profile-link hz-community-profile-link--avatar"
      href={href}
      aria-label={`לפרופיל של ${user.userLabel}`}
    >
      {avatar}
    </a>
  );
}

function PublicUserName({ user }) {
  const href = userProfileHref(user.userHandle);
  if (!href) return <span class="hz-community-name">{user.userLabel}</span>;
  return <a class="hz-community-name hz-community-profile-link" href={href}>{user.userLabel}</a>;
}

function ComposerAvatar() {
  const user = currentAuthUser();
  if (!user) return null;
  const url = user.avatarUrl || shellAvatarUrl() || DEFAULT_AVATAR_URL;
  return <AvatarImg className="hz-avatar--composer" url={url} />;
}

function ReplyMarkup({ comment, onLike, onReport, onDelete }) {
  return (
    <div class="hz-community-comment hz-community-comment--reply" data-comment-id={comment.id}>
      <div class="hz-community-comment-layout">
        <AuthorAvatar comment={comment} className="hz-avatar--reply" />
        <div class="hz-community-comment-main">
          <div class="hz-community-comment-meta">
            <AuthorName comment={comment} />
            <span class="hz-community-time">{format.relativeTime(comment.createdAt) || comment.postedAt}</span>
            <CommentMenu comment={comment} onReport={onReport} onDelete={onDelete} />
          </div>
          <p class="hz-community-comment-body">{comment.body}</p>
          <div class="hz-community-actions">
            <button
              class={`hz-comment-action hz-comment-action--sm${comment.likedByViewer ? ' is-active' : ''}`}
              type="button"
              data-comments-like
              data-comment-id={comment.id}
              onClick={() => onLike(comment.id)}
            >
              <span class="material-symbols-outlined text-sm">favorite</span> {format.count(comment.likes)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentMarkup({ comment, onLike, onReplyPost, onReport, onDelete }) {
  const [replying, setReplying] = useState(false);
  const replyInputRef = useRef(null);

  const handleReplyToggle = () => {
    setReplying((v) => !v);
    if (!replying) setTimeout(() => replyInputRef.current?.focus(), 0);
  };

  return (
    <div class={`hz-community-comment${replying ? ' is-replying' : ''}`} data-comment-id={comment.id}>
      <div class="hz-community-comment-layout">
        <AuthorAvatar comment={comment} className="hz-avatar--comment" />
        <div class="hz-community-comment-main">
          <div class="hz-community-comment-meta">
            <AuthorName comment={comment} />
            <span class="hz-community-time">{format.relativeTime(comment.createdAt) || comment.postedAt}</span>
            <CommentMenu comment={comment} onReport={onReport} onDelete={onDelete} />
          </div>
          <p class="hz-community-comment-body">{comment.body}</p>
          <div class="hz-community-actions">
            <button
              class={`hz-comment-action hz-comment-action--sm${comment.likedByViewer ? ' is-active' : ''}`}
              type="button"
              data-comments-like
              data-comment-id={comment.id}
              onClick={() => onLike(comment.id)}
            >
              <span class="material-symbols-outlined text-sm">favorite</span> {format.count(comment.likes)}
            </button>
            <button
              class="hz-comment-action hz-comment-action--sm"
              type="button"
              data-comments-reply-toggle
              onClick={handleReplyToggle}
            >
              <span class="material-symbols-outlined text-sm">reply</span> הגב
            </button>
          </div>
          <div class="hz-comment-reply-form">
            <textarea
              class="hz-textarea"
              data-comments-reply-input
              placeholder="תגובה קצרה..."
              ref={replyInputRef}
            />
            <button
              class="hz-button-primary hz-button-primary--small"
              type="button"
              data-comments-reply-post
              onClick={() => onReplyPost(comment.id, replyInputRef.current?.value || '', () => {
                if (replyInputRef.current) replyInputRef.current.value = '';
                setReplying(false);
              })}
            >
              שלח
            </button>
          </div>
          {comment.replies && comment.replies.length > 0 && (
            <div class="hz-community-replies">
              {comment.replies.map((r) => <ReplyMarkup key={r.id} comment={r} onLike={onLike} onReport={onReport} onDelete={onDelete} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function sortComments(comments) {
  return [...(comments || [])].sort((a, b) => {
    const byTime = Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '');
    return byTime || String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function sortReplies(replies) {
  return [...(replies || [])].sort((a, b) => {
    const byTime = Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '');
    return byTime || String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function countThread(comments) {
  return {
    total: (comments || []).length,
    replies: (comments || []).reduce((sum, comment) => sum + (comment.replies || []).length, 0),
  };
}

function eventMatchesContext(detail, ctx) {
  if (!detail || !String(detail.type || '').startsWith('comment.')) return false;
  const comment = detail.payload?.comment;
  if (detail.marketKey && detail.marketKey !== ctx.marketKey && !ctx.eventId) return false;
  if (!comment) return true;
  const eventId = comment.eventId || null;
  return (ctx.eventId || null) === eventId;
}

function mergeCommentIntoData(data, incoming) {
  if (!incoming?.id) return data;
  const parentId = incoming.parentCommentId || null;
  const current = data || { comments: [], counts: { total: 0, replies: 0 } };
  let changed = false;

  if (!parentId) {
    const comments = [...(current.comments || [])];
    const index = comments.findIndex((comment) => comment.id === incoming.id);
    if (index >= 0) {
      comments[index] = {
        ...comments[index],
        ...incoming,
        replies: sortReplies(incoming.replies?.length ? incoming.replies : comments[index].replies),
      };
    } else {
      comments.unshift({ ...incoming, replies: sortReplies(incoming.replies || []) });
    }
    changed = true;
    const sorted = sortComments(comments);
    return { ...current, comments: sorted, counts: countThread(sorted) };
  }

  const comments = (current.comments || []).map((comment) => {
    if (comment.id !== parentId) return comment;
    const replies = [...(comment.replies || [])];
    const index = replies.findIndex((reply) => reply.id === incoming.id);
    if (index >= 0) {
      replies[index] = { ...replies[index], ...incoming, replies: [] };
    } else {
      replies.push({ ...incoming, replies: [] });
    }
    changed = true;
    return { ...comment, replies: sortReplies(replies) };
  });

  if (!changed) return current;
  return { ...current, comments, counts: countThread(comments) };
}

function applyLikeToData(data, payload) {
  const commentId = payload?.commentId;
  if (!commentId) return data;
  const nextLikes = Number(payload.likes);
  // Only the viewer's own like POST carries likedByViewer; the SSE broadcast to
  // other viewers omits it, so we never clobber their own filled/empty state.
  const hasViewer = Object.prototype.hasOwnProperty.call(payload, 'likedByViewer');
  const patch = (comment) => {
    if (comment.id !== commentId) return comment;
    return {
      ...comment,
      likes: Number.isFinite(nextLikes) ? nextLikes : comment.likes,
      likedByViewer: hasViewer ? !!payload.likedByViewer : comment.likedByViewer,
    };
  };
  const comments = (data.comments || []).map((comment) => ({
    ...patch(comment),
    replies: (comment.replies || []).map(patch),
  }));
  return { ...data, comments, counts: countThread(comments) };
}

function applyCommentEvent(data, detail) {
  const type = detail?.type || '';
  if (type === 'comment.like') return applyLikeToData(data, detail.payload || {});
  return mergeCommentIntoData(data, detail?.payload?.comment);
}

function CommentsPanel({ ctx, onCountChange }) {
  const [data, setData] = useState({ comments: [], counts: { total: 0, replies: 0 } });
  const [notice, setNotice] = useState('');
  const [, forceUpdate] = useState(0);
  const inputRef = useRef(null);
  const [posting, setPosting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await ctx.adapter.comments.list({ eventId: ctx.eventId });
      const buffered = window.NaviMarketLiveEvents?.recent?.() || [];
      setData(buffered.filter((detail) => eventMatchesContext(detail, ctx)).reduce(applyCommentEvent, d));
    } catch {
      // keep current data
    }
  }, [ctx]);

  useEffect(() => {
    const onLive = (event) => {
      if (!eventMatchesContext(event.detail, ctx)) return;
      setData((current) => applyCommentEvent(current, event.detail));
    };
    window.addEventListener('hz:market-live-fetch', onLive);
    reload();
    const onAuth = () => forceUpdate((n) => n + 1);
    window.addEventListener('navi:auth-state', onAuth);
    return () => {
      window.removeEventListener('hz:market-live-fetch', onLive);
      window.removeEventListener('navi:auth-state', onAuth);
    };
  }, [ctx, reload]);

  useEffect(() => {
    onCountChange?.((data.counts?.total || 0) + (data.counts?.replies || 0));
  }, [data, onCountChange]);

  const handlePost = async () => {
    if (isCommentGuest()) { setNotice('צריך להתחבר כדי לפרסם תגובה.'); return; }
    const body = (inputRef.current?.value || '').trim();
    if (!body) return;
    setPosting(true);
    try {
      const payload = await ctx.adapter.comments.post({ body, eventId: ctx.eventId });
      if (payload?.comment) {
        setData((current) => mergeCommentIntoData(current, payload.comment));
      }
      if (inputRef.current) inputRef.current.value = '';
      setNotice('פורסם.');
    } catch {
      setNotice('לא הצלחנו לפרסם כרגע. נסה שוב בעוד רגע.');
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (commentId) => {
    try {
      const payload = await ctx.adapter.comments.like({ commentId, eventId: ctx.eventId });
      setData((current) => applyLikeToData(current, payload));
    } catch {
      setNotice('לא הצלחנו לסמן לייק כרגע.');
    }
  };

  const handleReport = async (commentId) => {
    if (isCommentGuest()) { openSignupOverlay(); return; }
    const reason = window.prompt('מה הבעיה בתגובה? אפשר להשאיר ריק ולשלוח דיווח קצר.');
    if (reason === null) return;
    try {
      await ctx.adapter.comments.report({ commentId, reason: reason.trim().slice(0, 280) || null });
      setNotice('הדיווח התקבל, תודה. אחד מנציגנו יבדוק.');
    } catch {
      setNotice('לא הצלחנו לשלוח דיווח כרגע. נסה שוב בעוד רגע.');
    }
  };

  const handleDelete = async (commentId) => {
    try {
      await ctx.adapter.comments.remove({ commentId });
      setData((current) => {
        const comments = (current.comments || [])
          .filter((c) => c.id !== commentId)
          .map((c) => ({ ...c, replies: (c.replies || []).filter((r) => r.id !== commentId) }));
        return { ...current, comments, counts: countThread(comments) };
      });
      setNotice('התגובה נמחקה.');
    } catch {
      setNotice('לא הצלחנו למחוק כרגע. נסה שוב בעוד רגע.');
    }
  };

  const handleReplyPost = async (commentId, body, onDone) => {
    if (isCommentGuest()) { setNotice('צריך להתחבר כדי לפרסם תגובה.'); return; }
    const trimmed = body.trim();
    if (!trimmed || !commentId) return;
    try {
      const payload = await ctx.adapter.comments.reply({ commentId, body: trimmed, eventId: ctx.eventId });
      if (payload?.comment) {
        setData((current) => mergeCommentIntoData(current, payload.comment));
      }
      onDone?.();
      setNotice('תגובה נוספה.');
    } catch {
      setNotice('לא הצלחנו להגיב כרגע.');
    }
  };

  const comments = data.comments || [];
  const chips = [['all', 'תגובות', data.counts?.total ?? comments.length]];

  return (
    <div class="hz-social-panel hz-social-panel--comments">
      <div class="hz-comment-form">
        <div class="hz-comment-form__avatar-slot" data-comments-composer-avatar>
          <ComposerAvatar />
        </div>
        <textarea
          class="hz-textarea"
          data-comments-input
          placeholder="הוסף מחשבה על השוק..."
          ref={inputRef}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handlePost();
            }
          }}
        />
        <button
          class="hz-button-primary hz-button-primary--small"
          data-comments-post
          type="button"
          disabled={posting}
          onClick={handlePost}
        >
          פרסם
        </button>
      </div>
      <p class="hz-social-subtitle" data-comments-notice role="status" aria-live="polite">
        {notice}
      </p>
      <div class="hz-community-toolbar">
        <div class="hz-community-filter-group">
          {chips.map(([id, label, n]) => (
            <button
              key={id}
              class="hz-community-chip hz-community-chip--active"
              data-comments-filter={id}
              type="button"
            >
              {label}
              <span class="hz-community-chip-count">{format.count(n)}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="hz-community-stream" data-comments-stream>
        {comments.length === 0
          ? <div class="market-detail-copy-block hz-community-empty">היו הראשונים לקרוא את השוק הזה.</div>
          : comments.map((c) => (
              <CommentMarkup
                key={c.id}
                comment={c}
                onLike={handleLike}
                onReplyPost={handleReplyPost}
                onReport={handleReport}
                onDelete={handleDelete}
              />
            ))
        }
      </div>
    </div>
  );
}

// ─── Board tab (holders + positions) ────────────────────────────────────────

const SIZE_FILTERS = [
  { value: 'all', label: 'הכל', min: 0 },
  { value: '1', label: '≥1', min: 1 },
  { value: '100', label: '≥100', min: 100 },
  { value: '1000', label: '≥1K', min: 1000 },
];

function sideTitle(label, kind) {
  return kind === 'holders' ? `מחזיקי ${label}` : label;
}

function preparePositions(entries, kind, state) {
  if (kind !== 'positions') return entries;
  const min = (SIZE_FILTERS.find((f) => f.value === (state.positionsFilter || 'all')) || SIZE_FILTERS[0]).min;
  const filtered = min > 0 ? entries.filter((e) => Math.abs(Number(e.positionValue) || 0) >= min) : entries;
  const sign = (state.positionsSort || 'desc') === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => sign * ((Number(a.pnl) || 0) - (Number(b.pnl) || 0)));
}

function BoardRow({ entry, kind, side }) {
  const value =
    kind === 'holders' ? (
      <span class={`hz-community-value ${side === 'no' ? 'hz-community-value--shares-no' : 'hz-community-value--shares'}`}>
        {format.count(entry.shares)}
      </span>
    ) : (
      <span class={`hz-community-value ${Number(entry.pnl) >= 0 ? 'hz-community-value--positive' : 'hz-community-value--negative'}`}>
        <VShekelText text={format.signedMoney(entry.pnl)} />
      </span>
    );
  return (
    <div class="hz-community-row">
      <div class="hz-community-row-copy">
        <PublicUserAvatar user={entry} className="hz-avatar--comment hz-avatar--compact" />
        <div class="hz-community-row-id">
          <PublicUserName user={entry} />
          {/* positions: avg sits inline with the name. holders: no meta — the
              "open shares" caption duplicates the חוזים column + value. */}
          {kind === 'positions' && (
            <span class="hz-community-row-meta">ממוצע <VShekelText text={format.price(entry.averageCost)} /></span>
          )}
        </div>
      </div>
      {value}
    </div>
  );
}

function BoardColumn({ title, rightHead, entries, kind, side }) {
  return (
    <div class="hz-community-column">
      <div class="hz-community-column-head">
        <span>{title}</span>
        <span>{rightHead}</span>
      </div>
      <div class="hz-community-list">
        {entries.length === 0
          ? <div class="hz-community-empty hz-community-empty--column">אף אחד עדיין לא מחזיק כאן. אפשר להיות הראשונים.</div>
          : entries.map((entry, i) => <BoardRow key={entry.userId || i} entry={entry} kind={kind} side={side} />)}
      </div>
    </div>
  );
}

function BoardPanel({ ctx, kind, refreshToken = 0 }) {
  const isEvent = !!(ctx.children && ctx.children.length);
  const isMulti = !isEvent && ctx.outcomes.length > 2;

  // Local copies of the shared-state fields this panel reads/writes
  const [childKey, setChildKey] = useState(ctx.state.communityChildKey);
  const [outcomeId, setOutcomeId] = useState(ctx.state.communityOutcomeId);
  const [posFilter, setPosFilter] = useState(ctx.state.positionsFilter || 'all');
  const [posSort, setPosSort] = useState(ctx.state.positionsSort || 'desc');
  const fetchKey = isEvent ? childKey : undefined;
  const cacheKey = fetchKey != null ? fetchKey : ctx.marketKey;

  // Cache boards on ctx.state (survives the panel remount that a tab switch causes).
  // Seeding from it means re-entering holders/positions — or a live refreshToken bump —
  // shows data instantly instead of collapsing to "טוען…" and reflowing the page.
  // holders + positions share one fetch, so switching between them is a pure cache hit.
  const [boards, setBoards] = useState(() => ctx.state.boardCache?.[cacheKey] ?? null);
  const [error, setError] = useState(false);

  useEffect(() => {
    ctx.state.boardCache = ctx.state.boardCache || {};
    const cached = ctx.state.boardCache[cacheKey] ?? null;
    setBoards(cached); // show cache (or null only on a genuine first load); never blank a loaded panel
    setError(false);
    ctx.adapter.fetchBoards(cacheKey)
      .then((data) => { ctx.state.boardCache[cacheKey] = data; setBoards(data); })
      .catch(() => { if (!cached) setError(true); });
  }, [cacheKey, ctx, refreshToken]);

  const onChildChange = (v) => { ctx.state.communityChildKey = v; setChildKey(v); };
  const onOutcomeChange = (v) => { ctx.state.communityOutcomeId = v; setOutcomeId(v); };
  const onFilterChange = (v) => { ctx.state.positionsFilter = v; setPosFilter(v); };
  const onSortChange = (v) => { ctx.state.positionsSort = v; setPosSort(v); };

  if (error) {
    return (
      <div class="hz-social-panel hz-social-panel--board">
        <div class="market-detail-copy-block hz-community-empty">לא ניתן לטעון נתונים כרגע.</div>
      </div>
    );
  }

  if (!boards) {
    return (
      <div class="hz-social-panel hz-social-panel--board">
        <div class="market-detail-copy-block hz-community-empty">טוען…</div>
      </div>
    );
  }

  const boardsData = (kind === 'holders' ? boards.holdersByOutcome : boards.positionsByOutcome) || {};
  const boardKeys = Object.keys(boardsData);
  const rightHead = kind === 'holders' ? 'חוזים' : 'רווח/הפסד';

  let columns;
  let selectorEl = null;

  if (isEvent) {
    const [k0, k1] = boardKeys;
    columns = [
      { side: 'yes', title: sideTitle('כן', kind), entries: boardsData[k0]?.yes || [] },
      { side: 'no', title: sideTitle('לא', kind), entries: boardsData[k1]?.yes || [] },
    ];
    selectorEl = (
      <Dropdown
        name="child"
        items={ctx.children.map((c) => ({ value: c.key, label: c.label }))}
        selected={childKey}
        onSelect={onChildChange}
      />
    );
  } else if (isMulti) {
    const effectiveOutcome = boardsData[outcomeId] ? outcomeId : (boardKeys[0] ?? ctx.outcomes[0]?.key ?? null);
    const board = boardsData[effectiveOutcome] || { yes: [], no: [] };
    columns = [
      { side: 'yes', title: sideTitle('כן', kind), entries: board.yes || [] },
      { side: 'no', title: sideTitle('לא', kind), entries: board.no || [] },
    ];
    selectorEl = (
      <Dropdown
        name="outcome"
        items={ctx.outcomes.map((o) => ({ value: o.key, label: o.label }))}
        selected={effectiveOutcome}
        onSelect={onOutcomeChange}
      />
    );
  } else {
    const [o0, o1] = ctx.outcomes;
    columns = [
      { side: 'yes', title: sideTitle(o0?.label ?? 'כן', kind), entries: boardsData[o0?.key]?.yes || [] },
      { side: 'no', title: sideTitle(o1?.label ?? 'לא', kind), entries: boardsData[o1?.key]?.yes || [] },
    ];
  }

  const controlsEl = kind === 'positions' ? (
    <Fragment>
      <Dropdown
        name="filter"
        items={SIZE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        selected={posFilter}
        onSelect={onFilterChange}
      />
      <Dropdown
        name="sort"
        items={[{ value: 'desc', label: 'יורד' }, { value: 'asc', label: 'עולה' }]}
        selected={posSort}
        onSelect={onSortChange}
      />
    </Fragment>
  ) : null;

  const hasToolbar = selectorEl || controlsEl;

  return (
    <div class="hz-social-panel hz-social-panel--board">
      {hasToolbar && (
        <div class="hz-community-toolbar hz-community-toolbar--between">
          <div class="hz-community-toolbar-left">{selectorEl}</div>
          <div class="hz-community-toolbar-right">{controlsEl}</div>
        </div>
      )}
      <div class="hz-community-grid">
        {columns.map((col) => {
          const entries = preparePositions(col.entries || [], kind, { positionsFilter: posFilter, positionsSort: posSort });
          return (
            <BoardColumn
              key={col.side}
              title={col.title}
              rightHead={rightHead}
              entries={entries}
              kind={kind}
              side={col.side}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity tab ────────────────────────────────────────────────────────────

// Slow reconcile only. A trade already push-refetches the feed via the
// hz:market-live-fetch → market.trade handler (setDataRefreshToken, ~120ms), and
// visibilitychange reloads on tab-return — so this poll is just a safety net for a
// dropped SSE, not the live path. (Demoted from 20s.)
const POLL_MS = 60000;
const FEED_CAP = 25;
// "Live" pill gate: only show it when a trade actually landed within this window.
// A quiet market with an always-on "Live" label is manufactured urgency, not earned.
const LIVE_WINDOW_MS = 5 * 60 * 1000;

function ActivityFeedRow({ item }) {
  const isBuy = item.side === 'buy';
  const actionLabel = isBuy ? 'קנה' : 'מכר';
  const actionClass = isBuy ? 'hz-community-trade--buy' : 'hz-community-trade--sell';
  // The side the trader is on IS the outcome. For a yes/no outcome (binary), the
  // label already encodes the side ("כן"/"לא") — show it as-is. Only a NAMED
  // outcome (multi) needs a "לא <outcome>" prefix for a no-bet. (contractSide is
  // mechanics, not display: binary "no" trades still carry outcomeLabel כן/לא, so
  // prefixing produced "לא לא"/"לא כן".) The "סל משלים (n)" basket hint — internal
  // complement-leg mechanics — is dropped; it read as noise.
  const isYesNoOutcome = /^(כן|לא|yes|no)$/i.test(String(item.outcomeLabel || '').trim());
  const outcomeDisplay = (!isYesNoOutcome && item.contractSide === 'no')
    ? `לא ${item.outcomeLabel || ''}`
    : (item.outcomeLabel || '');

  return (
    <div class="hz-community-feed-row">
      <div class="hz-community-row-copy">
        <PublicUserAvatar user={item} className="hz-avatar--comment hz-avatar--compact" />
        <div class="hz-community-trade-copy">
          <PublicUserName user={item} />
          <span class={actionClass}>{actionLabel}</span>
          <span class="hz-community-trade-strong">{format.count(item.shareAmount)}</span>
          <span class="hz-community-trade-strong">{outcomeDisplay}</span>
          {item.__childLabel && <span class="hz-community-trade-strong">· {item.__childLabel}</span>}
          <span>· <VShekelText text={format.price(item.avgPrice)} /></span>
          <span class="hz-community-time">(<VShekelText text={format.money(item.cashAmount)} />)</span>
        </div>
      </div>
      <div class="hz-community-time">{format.relativeTime(item.createdAt)}</div>
    </div>
  );
}

function ActivityPanel({ ctx, refreshToken = 0 }) {
  const isEvent = !!(ctx.children && ctx.children.length);
  const [activityKey, setActivityKey] = useState(
    isEvent ? (ctx.state.communityActivityKey ?? 'all') : null
  );
  // Seed from the ctx.state cache (survives the tab-switch remount) so re-entering
  // activity shows rows instantly instead of flashing "טוען…" and reflowing the page.
  const [trades, setTrades] = useState(() => {
    const k = isEvent ? (ctx.state.communityActivityKey ?? 'all') : 'default';
    return ctx.state.activityCache?.[k] ?? null;
  });
  const [loadError, setLoadError] = useState(false);
  const stoppedRef = useRef(false);
  const tokenRef = useRef(0);

  const fetchTrades = useCallback(async (key) => {
    if (!isEvent) {
      const data = await ctx.adapter.fetchActivity();
      return data.trades || [];
    }
    if (key === 'all') {
      const results = await Promise.all(
        ctx.children.map((child) =>
          ctx.adapter
            .fetchActivity(child.key)
            .then((data) => (data.trades || []).map((t) => ({ ...t, __childLabel: child.label })))
            .catch(() => [])
        )
      );
      return results
        .flat()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, FEED_CAP);
    }
    const child = ctx.children.find((c) => c.key === key);
    const data = await ctx.adapter.fetchActivity(key);
    return (data.trades || []).map((t) => ({ ...t, __childLabel: child?.label }));
  }, [ctx, isEvent]);

  const load = useCallback(async (key) => {
    const mine = ++tokenRef.current;
    try {
      const result = await fetchTrades(key);
      if (stoppedRef.current || mine !== tokenRef.current) return;
      ctx.state.activityCache = ctx.state.activityCache || {};
      ctx.state.activityCache[key ?? 'default'] = result;
      setTrades(result);
      setLoadError(false);
    } catch {
      if (stoppedRef.current || mine !== tokenRef.current) return;
      setLoadError(true);
    }
  }, [fetchTrades]);

  useEffect(() => {
    stoppedRef.current = false;
    load(activityKey);
    const timer = setInterval(() => {
      if (!document.hidden) load(activityKey);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load(activityKey);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activityKey, load, refreshToken]);

  // Live append: market.trade carries its renderable row, so prepend it (dedup +
  // cap) and the feed moves with no refetch. Only the simple non-event case appends
  // (the page SSE == the shown market); events/multi-child, or a row-less push, fall
  // back to a reload. The 60s poll + visibility-regain still self-heal any drift.
  useEffect(() => {
    const onLive = (event) => {
      const detail = event.detail;
      if (!detail || detail.type !== 'market.trade') return;
      const row = detail.payload?.row;
      if (!isEvent && row && row.tradeId) {
        setTrades((current) => {
          if (!current) return current;
          if (current.some((t) => t.tradeId === row.tradeId)) return current;
          return [row, ...current].slice(0, FEED_CAP);
        });
        return;
      }
      load(activityKey);
    };
    window.addEventListener('hz:market-live-fetch', onLive);
    return () => window.removeEventListener('hz:market-live-fetch', onLive);
  }, [isEvent, activityKey, load]);

  const onActivityKeyChange = (v) => {
    ctx.state.communityActivityKey = v;
    setActivityKey(v);
  };

  const selectorEl = isEvent ? (
    <Dropdown
      name="activity"
      items={[{ value: 'all', label: 'הכל' }, ...ctx.children.map((c) => ({ value: c.key, label: c.label }))]}
      selected={activityKey}
      onSelect={onActivityKeyChange}
    />
  ) : (
    <span class="hz-community-select-pill">הכל</span>
  );

  let bodyEl;
  if (loadError && trades === null) {
    bodyEl = <div class="market-detail-copy-block hz-community-empty">לא ניתן לטעון פעילות כרגע.</div>;
  } else if (trades === null) {
    bodyEl = <div class="market-detail-copy-block hz-community-empty">טוען…</div>;
  } else if (trades.length === 0) {
    bodyEl = <div class="market-detail-copy-block hz-community-empty">עוד אין מסחר בשוק הזה. העסקה הראשונה תופיע כאן.</div>;
  } else {
    bodyEl = (
      <div class="hz-community-feed">
        {trades.map((item, i) => <ActivityFeedRow key={item.tradeId || item.id || i} item={item} />)}
      </div>
    );
  }

  // Live only means something if a trade actually landed recently — gate on the
  // newest row's timestamp rather than always-on. Earned urgency, not decoration
  // (voice.md: aliveness comes from real movement, never manufactured). Don't
  // assume feed order (the merged multi-child "all" fetch sorts descending, but
  // the single-market fetch doesn't guarantee it), so take the actual max.
  const newestTradeAt = trades && trades.length
    ? Math.max(...trades.map((t) => Date.parse(t.createdAt || 0) || 0))
    : 0;
  const isLive = newestTradeAt > 0 && Date.now() - newestTradeAt < LIVE_WINDOW_MS;

  return (
    <div class="hz-social-panel hz-social-panel--activity">
      <div class="hz-community-toolbar hz-community-toolbar--between">
        <div class="hz-community-outcome-summary">
          {selectorEl}
        </div>
        {isLive && (
          <div class="hz-community-live-pill">
            <span class="hz-community-live-dot"></span>Live
          </div>
        )}
      </div>
      {bodyEl}
    </div>
  );
}

// ─── Top-level Community component ──────────────────────────────────────────

const TABS = [
  { id: 'comments',  label: 'תגובות'  },
  { id: 'holders',   label: 'מחזיקים' },
  { id: 'positions', label: 'פוזיציות' },
  { id: 'activity',  label: 'פעילות'  },
];

export default function Community({ marketKey, outcomes, marketStatus, eventChildren, defaultChildKey, eventId }) {
  // Parse props (arrive as strings when forwarded from Astro data-* attributes)
  const parsedOutcomes = typeof outcomes === 'string' ? JSON.parse(outcomes) : (outcomes || []);
  const parsedChildren = typeof eventChildren === 'string' ? JSON.parse(eventChildren) : (eventChildren || []);

  // Shared mutable state object mirrors community.client.js `state`.
  const stateRef = useRef({
    activeTab: 'comments',
    communityOutcomeId: parsedOutcomes[0]?.key ?? null,
    communityChildKey: defaultChildKey || null,
    communityActivityKey: parsedChildren.length ? 'all' : null,
    positionsFilter: 'all',
    positionsSort: 'desc',
  });

  const adapterRef = useRef(null);
  if (!adapterRef.current) {
    adapterRef.current = createCommunityAdapter(marketKey);
  }

  // Hide the SSR comment preview once this interactive island boots — the preview is
  // the crawler / first-paint fallback; the live thread supersedes it here.
  useEffect(() => {
    const el = document.querySelector('[data-comment-preview]');
    if (el) el.style.display = 'none';
  }, []);

  const ctx = {
    marketKey,
    outcomes: parsedOutcomes,
    children: parsedChildren,
    defaultChildKey: defaultChildKey || null,
    eventId: eventId || null,
    marketStatus: marketStatus || '',
    state: stateRef.current,
    adapter: adapterRef.current,
    format,
  };

  const [activeTab, setActiveTab] = useState('comments');
  const [commentCount, setCommentCount] = useState(0);
  const [dataRefreshToken, setDataRefreshToken] = useState(0);
  const rootRef = useRef(null);
  const [armed, setArmed] = useState(false);

  // Lazy-arm: IntersectionObserver (early) + requestIdleCallback (guaranteed).
  // Mirrors the exact dual-trigger strategy in community.client.js.
  useEffect(() => {
    if (armed) return;
    const arm = () => setArmed(true);
    const idle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
      : (fn) => setTimeout(fn, 200);
    idle(arm);
    if ('IntersectionObserver' in window && rootRef.current) {
      const io = new IntersectionObserver(
        (entries, obs) => {
          if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); arm(); }
        },
        { rootMargin: '200px' }
      );
      io.observe(rootRef.current);
      return () => io.disconnect();
    }
  }, [armed]);

  // Live-fetch invalidation + refresh (mirrors community.client.js hz:market-live-fetch handler).
  useEffect(() => {
    const handler = (event) => {
      const type = event.detail?.type || '';
      if (!['market.snapshot', 'market.trade', 'market.lifecycle'].includes(type)) return;
      ctx.adapter.invalidateBoards?.();
      // Activity drives itself now (ActivityPanel appends the pushed trade row); only
      // holders/positions still refetch via the shared token on snapshot/trade.
      if (['holders', 'positions'].includes(activeTab)) {
        const delay = type === 'market.trade' ? 120 : 300;
        setTimeout(() => {
          setDataRefreshToken((value) => value + 1);
        }, delay);
      }
    };
    window.addEventListener('hz:market-live-fetch', handler);
    return () => window.removeEventListener('hz:market-live-fetch', handler);
  }, [activeTab, ctx.adapter]);

  // ARIA keyboard nav — RTL: ArrowLeft = next, ArrowRight = prev.
  const handleKeyDown = (e) => {
    if (!e.target.closest('[role="tablist"]')) return;
    const i = TABS.findIndex((t) => t.id === activeTab);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowLeft')  next = TABS[(i + 1) % TABS.length].id;
    else if (e.key === 'ArrowRight') next = TABS[(i - 1 + TABS.length) % TABS.length].id;
    else if (e.key === 'Home')  next = TABS[0].id;
    else if (e.key === 'End')   next = TABS[TABS.length - 1].id;
    if (next) { e.preventDefault(); activateTab(next); }
  };

  const activateTab = (tab) => {
    stateRef.current.activeTab = tab;
    setActiveTab(tab);
  };

  // Panel content — only render after armed (lazy-paint contract).
  let panelContent;
  if (!armed) {
    panelContent = (
      <div class="hz-social-panel hz-social-panel--comments">
        <div class="hz-comment-form">
          <div class="hz-comment-form__avatar-slot" data-comments-composer-avatar></div>
          <textarea class="hz-textarea" placeholder="הוסף מחשבה על השוק..."></textarea>
          <button class="hz-button-primary hz-button-primary--small" type="button">פרסם</button>
        </div>
        <div class="hz-community-toolbar">
          <div class="hz-community-filter-group">
            <button class="hz-community-chip hz-community-chip--active" type="button">
              מחזיקים<span class="hz-community-chip-count">0</span>
            </button>
            <button class="hz-community-chip" type="button">
              ללא פוזיציה<span class="hz-community-chip-count">0</span>
            </button>
          </div>
        </div>
        <div class="hz-community-stream">
          <div class="market-detail-copy-block hz-community-empty">היו הראשונים לקרוא את השוק הזה.</div>
        </div>
      </div>
    );
  } else if (activeTab === 'comments') {
    panelContent = <CommentsPanel key="comments" ctx={ctx} onCountChange={setCommentCount} />;
  } else if (activeTab === 'holders') {
    panelContent = <BoardPanel key="holders" ctx={ctx} kind="holders" refreshToken={dataRefreshToken} />;
  } else if (activeTab === 'positions') {
    panelContent = <BoardPanel key="positions" ctx={ctx} kind="positions" refreshToken={dataRefreshToken} />;
  } else if (activeTab === 'activity') {
    panelContent = <ActivityPanel key="activity" ctx={ctx} refreshToken={dataRefreshToken} />;
  }

  return (
    <section
      class="hz-social-shell"
      id="comments-section"
      data-hz-community-section
      data-market-key={marketKey}
      data-market-status={marketStatus}
      data-outcomes={JSON.stringify(parsedOutcomes)}
      data-event-children={JSON.stringify(parsedChildren)}
      data-default-child-key={defaultChildKey || ''}
      data-event-id={eventId || ''}
      ref={rootRef}
      onKeyDown={handleKeyDown}
    >
      <div class="hz-social-head">
        <div>
          <h2 class="hz-social-title">שיחת השוק</h2>
        </div>
        <div class="hz-comment-tabs" role="tablist" aria-label="שיחת השוק">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                id={`hz-community-tab-${tab.id}`}
                class={`hz-comment-tab${isActive ? ' hz-comment-tab--active' : ''}`}
                type="button"
                role="tab"
                aria-selected={String(isActive)}
                aria-controls="hz-community-panel"
                tabIndex={isActive ? 0 : -1}
                data-community-tab={tab.id}
                onClick={() => activateTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'comments' && <span class="hz-comment-tab-count">{format.count(commentCount)}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div id="hz-community-panel" class="hz-community-panel" data-community-panel role="tabpanel" aria-labelledby={`hz-community-tab-${activeTab}`}>
        {panelContent}
      </div>
    </section>
  );
}
