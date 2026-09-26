/** Community thread detail (Preact island) — slice 3 READ + slice 2 WRITE.
 *  Market context + opening post + comment tree + ThreadComposer (slice 2).
 *  All writes are in-memory only; every seam maps to finish-community-integration.md.
 *  ponytail: no fetch, no localStorage — pure front preview until the backend lands. */
import { useState } from 'preact/hooks';
import { Seg, Avatar, Seal, useToggles, Acts, Follow, MoreMenu } from './community-ui.jsx';
import { ThreadComposer } from './community-composers.jsx';
import { postCommunity } from './community-client.js';

const Pos = ({ chip }) => (chip ? <span class={`th-pos ${chip.side}`}>{chip.label}</span> : null);

// One comment (+ its one level of replies). Shares the like/follow toggle state
// owned by the thread island.
function Comment({ c, likes, onLike, authed, onNeedsAuth, onDeleted }) {
  const [showMore, setShowMore] = useState(true);
  return (
    <article class="th-c">
      <Avatar a={c.author} size="md" />
      <div class="th-c-main">
        <div class="th-c-head">
          <a class="nm" href="#" onClick={(e) => e.preventDefault()}>{c.author.name}</a>
          {c.author.seal && <Seal kind={c.author.seal} />}
          {c.posChip && <Pos chip={c.posChip} />}
          <span class="dot"></span>
          <span class="tm">{c.time}</span>
        </div>
        <p class="th-c-txt"><Seg parts={c.body} /></p>
        <div class="cm-acts-row">
          <Acts id={c.id} comments={c.comments} likes={likes} onLike={onLike} />
          <MoreMenu kind="comment" id={c.id} isMine={c.isMine} authed={authed} onNeedsAuth={onNeedsAuth} onDeleted={onDeleted} />
        </div>

        {c.replies?.length > 0 && (
          <div class="th-replies">
            {c.replies.map((r) => (
              <div class="th-reply" key={r.id}>
                <Avatar a={r.author} size="sm" />
                <div class="th-c-main">
                  <div class="th-c-head">
                    <a class="nm" href="#" onClick={(e) => e.preventDefault()}>{r.author.name}</a>
                    {r.opTag && <span class="th-op-tag">מחבר</span>}
                    {r.author.seal && <Seal kind={r.author.seal} />}
                    <span class="tm">{r.time}</span>
                  </div>
                  <p class="th-c-txt"><Seg parts={r.body} /></p>
                  <Acts id={r.id} share={false} likes={likes} onLike={onLike} />
                </div>
              </div>
            ))}
            {c.showMore && showMore && (
              <button class="th-showmore" type="button" onClick={() => setShowMore(false)}>{c.showMore}</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function openLoginT() {
  if (typeof window !== 'undefined' && window.NaviOverlays?.open) window.NaviOverlays.open('login');
  else if (typeof window !== 'undefined') window.location.href = '/?overlay=login';
}

export default function CommunityThread({ thread: t, viewer }) {
  const m = t.market;
  const authed = Boolean(viewer?.authenticated);
  const ME = { name: viewer?.name || 'אתה', tint: 't-amber', initial: (viewer?.name || 'א').trim()[0] || 'א', avatarUrl: viewer?.avatarUrl || null };
  const marketHref = m.href || (m.marketKey ? `/markets/${m.marketKey}` : null);

  // lift comments into state so ThreadComposer can prepend
  const [comments, setComments] = useState(t.comments);
  const [commentCount, setCommentCount] = useState(t.opening.comments);

  // Real like state for the opening post + every comment + every reply. The
  // opening's UI key is 'op' but its real like target is the opening id (tid).
  const initialLikes = (() => {
    const map = { op: { n: t.opening.likes, on: !!t.opening.liked, tid: t.opening.id } };
    t.comments.forEach((c) => {
      map[c.id] = { n: c.likes, on: !!c.liked };
      (c.replies || []).forEach((r) => { map[r.id] = { n: r.likes, on: !!r.liked }; });
    });
    return map;
  })();
  // Follow the opening author — real social seam, keyed by public handle.
  const opHandle = t.opening.author?.handle || null;
  const opFollowKey = opHandle ? `person:${opHandle}` : null;
  const initialFollows = opFollowKey && t.opening.viewerFollows ? [opFollowKey] : [];
  const { likes, follows, toggleLike, toggleFollow, seedLikes } = useToggles(initialLikes, initialFollows);

  function followAuthor() {
    if (!authed) { openLoginT(); return; }
    if (!opHandle || !opFollowKey) return;
    const on = follows.has(opFollowKey);
    toggleFollow(opFollowKey);
    fetch(`/api/social/users/${encodeURIComponent(opHandle)}/follow`, {
      method: on ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    }).catch(() => { toggleFollow(opFollowKey); });
  }

  // POST the comment, then optimistically prepend it using the returned id.
  async function addComment({ body }) {
    const res = await postCommunity(`/api/community/discussions/${t.id}/comments`, { body });
    const newComment = {
      id: res?.id || `tmp-${Date.now()}`,
      author: { ...ME, seal: null },
      posChip: null,
      opTag: false,
      time: 'עכשיו',
      body: [body],
      likes: 0,
      comments: 0,
      replies: [],
    };
    setComments((prev) => [newComment, ...prev]);
    setCommentCount((n) => n + 1);
    seedLikes({ [newComment.id]: { n: 0, on: false } });
  }

  // like requires auth; guard against unseeded ids too
  function safeLike(id) {
    if (!authed) { openLoginT(); return; }
    if (!likes[id]) return;
    toggleLike(id);
  }

  return (
    <div class="cm-page th-page">
      <a class="th-back" href="/community"><span class="material-symbols-outlined">arrow_forward</span>חזרה לקהילה</a>

      <div class="th-grid">
        {/* ── CONVERSATION ── */}
        <div>
          <div class="th-ctx">
            <span class="cat">{m.ctxCat}</span>
            {m.heat && <span class="th-heat"><span class="material-symbols-outlined">local_fire_department</span>דיון לוהט</span>}
            <span class="cm-id"><span class="dot"></span></span>
            <a class="co-th-market" href={marketHref || '#'} onClick={marketHref ? undefined : (e) => e.preventDefault()} style="text-decoration:none;">{m.short} {m.pp != null && <span class="pp" style="font-family:var(--hz-font-mono);font-weight:700;color:var(--hz-text-soft);">{m.pp}%</span>} <span class={`mv ${m.mv.dir}`} style="font-family:var(--hz-font-mono);font-size:0.76rem;font-weight:600;">{m.mv.val}</span></a>
          </div>

          {/* OPENING POST */}
          <article class="th-op">
            <h1 class="th-op-q">{t.opening.q}</h1>
            <div class="th-author">
              <Avatar a={t.opening.author} size="md" />
              <div class="at-txt">
                <div class="at-nm">{t.opening.author.name} <Pos chip={t.opening.posChip} /></div>
                <div class="at-sub">{t.opening.author.sub}</div>
              </div>
              {opFollowKey && !t.opening.isMine && (
                <Follow k={opFollowKey} follows={follows} onFollow={followAuthor} />
              )}
            </div>
            <div class="th-op-body">
              {t.opening.body.map((para, i) => <p key={i}><Seg parts={para} /></p>)}
            </div>
            <div class="th-op-foot">
              <div class="cm-acts">
                <button class={`cm-act like${likes.op?.on ? ' on' : ''}`} type="button" onClick={() => safeLike('op')}>
                  <span class="material-symbols-outlined">favorite</span><span class="n">{likes.op?.n}</span>
                </button>
                <button class="cm-act" type="button"><span class="material-symbols-outlined">mode_comment</span><span class="n">{commentCount}</span></button>
                <button class="cm-act" type="button"><span class="material-symbols-outlined">ios_share</span></button>
                <button class="cm-act" type="button"><span class="material-symbols-outlined">bookmark</span></button>
                <MoreMenu
                  kind="discussion"
                  id={t.id}
                  isMine={t.isMine}
                  authed={authed}
                  onNeedsAuth={openLoginT}
                  onDeleted={() => { if (typeof window !== 'undefined') window.location.href = '/community'; }}
                />
              </div>
            </div>
          </article>

          {/* COMMENTS */}
          <div class="th-cbar">
            <span class="t">תגובות <span class="n">{commentCount}</span></span>
            <span class="sort">{m.heat ? 'הכי לוהט' : 'הכי רלוונטי'} <span class="material-symbols-outlined">expand_more</span></span>
          </div>

          {/* slice 2: live composer */}
          <div class="th-composer">
            <Avatar a={ME} size="sm" />
            <div class="cinput">
              <ThreadComposer onAddComment={addComment} disabled={!authed} />
            </div>
          </div>

          <div class="th-comments">
            {comments.map((c) => (
              <Comment
                key={c.id}
                c={c}
                likes={likes}
                onLike={safeLike}
                authed={authed}
                onNeedsAuth={openLoginT}
                onDeleted={(id) => setComments((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}
            {t.loadMore && (
              <div class="cm-loadmore" style="display:flex;justify-content:center;padding-top:var(--hz-space-8);">
                <button class="btn" type="button" disabled title="בקרוב">{t.loadMore}</button>
              </div>
            )}
          </div>
        </div>

        {/* ── RAIL ── */}
        <aside class="th-rail">
          <div class="cm-rail cm-rail-sticky">
            <div class="cm-card th-mktcard">
              <div class="cm-card-h"><span class="t">השוק שבמרכז</span></div>
              <div class="cm-mref-cat" style="font-size:0.72rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--hz-text-faint);margin-bottom:0.4rem;">{m.ctxCat}</div>
              <p class="mk-q">{m.title}</p>
              <div class="mk-prob">
                {m.prob != null && <span class="p">{m.prob}<span class="pct">%</span></span>}
                {m.chip && <span class={`cm-mvchip ${m.mv.dir}`}>{m.chip}</span>}
              </div>
              {/* Market-only stats — an event has no single volume/holders/close, so
                  hide them (the "אירוע · N שווקים" chip above carries its context). */}
              {m.kind !== 'event' && (
                <div class="mk-meta">
                  {m.volume && <div class="mk-mrow"><span class="k">נפח מסחר</span><span class="v">{m.volume}</span></div>}
                  {m.holders && m.holders !== '0' && <div class="mk-mrow"><span class="k">מחזיקים</span><span class="v">{m.holders}</span></div>}
                  {m.close && <div class="mk-mrow"><span class="k">נסגר</span><span class="v" style={m.closing ? 'color:var(--hz-signal-closing);' : undefined}>{m.close}</span></div>}
                </div>
              )}
              <div class="mk-act">
                {m.kind === 'event' ? (
                  <a class="btn primary sm" href={marketHref || '#'} onClick={marketHref ? undefined : (e) => e.preventDefault()}>לעמוד האירוע</a>
                ) : (
                  <>
                    <a class="btn primary sm" href={marketHref || '#'} onClick={marketHref ? undefined : (e) => e.preventDefault()}>סחר בשוק</a>
                    <a class="btn sm" href={marketHref || '#'} onClick={marketHref ? undefined : (e) => e.preventDefault()}>לעמוד השוק</a>
                  </>
                )}
              </div>
            </div>

            <div class="cm-card">
              <div class="cm-card-h"><span class="t">משוחחים בולטים</span></div>
              <div class="sq-people">
                {t.participants.map((p) => (
                  <div class="sq-person" key={p.name}>
                    <Avatar a={p} size="md" />
                    <div class="pp-txt"><div class="pp-nm">{p.name} <Seal kind={p.seal} /></div><div class="pp-sub">{p.accuracy != null ? <><b>{p.accuracy}%</b> דיוק</> : 'משתתף'}</div></div>
                    <Follow k={`person:${p.name}`} follows={follows} onFollow={toggleFollow} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
