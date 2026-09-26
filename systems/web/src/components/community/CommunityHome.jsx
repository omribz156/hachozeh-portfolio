/** Community home (Preact island) — live surface backed by /api/community.
 *  Data arrives from SSR as `initial` props; composers POST to the backend and
 *  refetch. View toggle (דיונים / פיד חי), topic filter, sort, discussion list,
 *  activity feed, right rail. Likes/reposts + follow-persistence are deferred
 *  (see finish-community-integration.md) — like toggles stay in-memory for now. */
import { useState } from 'preact/hooks';
import { Seg, Avatar, Seal, Stack, useToggles, Acts, Follow, MarketRef, MoreMenu } from './community-ui.jsx';
import { FeedComposer, NewDiscussionModal } from './community-composers.jsx';
import { FeedPostComments } from './community-feed-thread.jsx';
import { postCommunity } from './community-client.js';

function openLogin() {
  if (typeof window !== 'undefined' && window.NaviOverlays?.open) window.NaviOverlays.open('login');
  else if (typeof window !== 'undefined') window.location.href = '/?overlay=login';
}

export default function CommunityHome({ initial, viewer }) {
  const authed = Boolean(viewer?.authenticated);
  const ME = { name: viewer?.name || 'אתה', tint: 't-amber', initial: (viewer?.name || 'א').trim()[0] || 'א', avatarUrl: viewer?.avatarUrl || null };

  const TOPICS = initial?.topics ?? ['הכל'];
  const RAIL_NOW = initial?.railNow ?? [];
  const RAIL_PEOPLE = initial?.railPeople ?? [];

  const [view, setView] = useState('discuss');
  const [topic, setTopic] = useState('הכל');
  const [sort, setSort] = useState('active');
  const [sortOpen, setSortOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [discussions, setDiscussions] = useState(initial?.discussions ?? []);
  const [feed, setFeed] = useState(initial?.feed ?? []);
  const [expandedPost, setExpandedPost] = useState(null);

  function togglePostComments(id) { setExpandedPost((prev) => (prev === id ? null : id)); }
  function bumpCommentCount(id) {
    setFeed((prev) => prev.map((f) => (f.id === id ? { ...f, comments: (f.comments || 0) + 1 } : f)));
  }

  // Real likes: seed count + viewer-liked from the feed DTO; toggles persist.
  const feedLikeEntries = (arr) => {
    const m = {};
    (arr ?? []).forEach((f) => { m[f.id] = { n: f.likes || 0, on: !!f.liked }; });
    return m;
  };
  // Seed the follow set from the rail DTO so already-followed voices render as
  // "עוקב" on load (the toggle itself persists to the social seam).
  const initialFollows = RAIL_PEOPLE.filter((p) => p.viewerFollows && p.handle).map((p) => `person:${p.handle}`);
  const { likes, follows, toggleLike, toggleFollow, seedLikes } = useToggles(feedLikeEntries(initial?.feed), initialFollows);

  const byTopic = (arr) => (topic === 'הכל' ? arr : arr.filter((x) => x.topic === topic));
  const SORTS = { active: 'הכי פעילים', new: 'חדש' };
  const sortDisc = (arr) => {
    const a = [...arr];
    if (sort === 'active') a.sort((x, y) => (y.replies || 0) - (x.replies || 0));
    return a; // 'new' keeps server order (newest-first)
  };

  const filteredDiscussions = sortDisc(byTopic(discussions));
  const filteredFeed = byTopic(feed);

  // "הדיון של היום" — the most active discussion leads as a featured card (only on
  // the unfiltered view, as in the original design); the rest fall into the list
  // below so it isn't shown twice.
  const featured = topic === 'הכל' ? filteredDiscussions[0] ?? null : null;
  const listDiscussions = featured ? filteredDiscussions.slice(1) : filteredDiscussions;

  async function refetchDiscussions() {
    try {
      const r = await fetch('/api/community/discussions?limit=20', { credentials: 'include', headers: { accept: 'application/json' } });
      if (r.ok) { const d = await r.json(); setDiscussions(d.discussions || []); }
    } catch { /* keep current */ }
  }
  async function refetchFeed() {
    try {
      const r = await fetch('/api/community/feed?limit=24', { credentials: 'include', headers: { accept: 'application/json' } });
      if (r.ok) { const d = await r.json(); setFeed(d.feed || []); seedLikes(feedLikeEntries(d.feed)); }
    } catch { /* keep current */ }
  }

  // ── composer writes (POST → refetch); throw so the composer surfaces errors ──
  async function addFeedItem(rec) {
    // rec already carries { kind, subjectKind?, subjectKey?, milestoneId?, body } —
    // forward it (take/position/result/milestone all go through here).
    await postCommunity('/api/community/posts', rec);
    await refetchFeed();
    setView('activity');
    setTopic('הכל');
  }
  async function addDiscussion(rec) {
    const s = rec.subject;
    await postCommunity('/api/community/discussions', {
      subjectKind: s?.kind,
      subjectKey: s?.key,
      title: rec.title,
      body: rec.body,
    });
    await refetchDiscussions();
    setView('discuss');
    setTopic('הכל');
  }

  function openComposerOrLogin() {
    if (!authed) { openLogin(); return; }
    setModalOpen(true);
  }

  // Rail follow is wired to the real social seam, keyed by public handle; optimistic.
  function followPerson(handle) {
    if (!authed) { openLogin(); return; }
    if (!handle) return;
    const key = `person:${handle}`;
    const on = follows.has(key);
    toggleFollow(key);
    fetch(`/api/social/users/${encodeURIComponent(handle)}/follow`, {
      method: on ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    }).catch(() => { toggleFollow(key); });
  }

  function safeLike(id) {
    if (!authed) { openLogin(); return; }
    if (!likes[id]) return;
    toggleLike(id);
  }

  return (
    <>
      {modalOpen && <NewDiscussionModal onClose={() => setModalOpen(false)} onSubmit={addDiscussion} />}
      <div class="cm-page cp-page">
        <div class="cp-grid">
          <div class="cp-main">
            <div class="cm-mast">
              <div>
                <h1 class="cm-mast-h">קהילה</h1>
                <div class="cp-views" role="tablist" aria-label="תצוגת קהילה">
                  <button class="cp-view-btn" role="tab" aria-selected={view === 'discuss'} onClick={() => setView('discuss')}><span class="material-symbols-outlined" aria-hidden="true">forum</span>דיונים</button>
                  <button class="cp-view-btn" role="tab" aria-selected={view === 'activity'} onClick={() => setView('activity')}><span class="live-dot" aria-hidden="true"></span>פיד חי</button>
                </div>
              </div>
            </div>

            <div class="co-filter">
              <span class="co-filter-lbl">נושאים</span>
              <div class="cm-topics">
                {TOPICS.map((t) => <button key={t} class="cm-topic" aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}
              </div>
              <div class="cp-sort-wrap" style="position:relative;">
                <button class="cp-sort" type="button" aria-haspopup="menu" aria-expanded={String(sortOpen)} onClick={() => setSortOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'Escape') setSortOpen(false); }}>{SORTS[sort]} <span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button>
                {sortOpen && (
                  <div class="cp-sort-menu open" role="menu">
                    {Object.entries(SORTS).map(([k, label]) => (
                      <button key={k} class={`cp-sort-opt${sort === k ? ' is-on' : ''}`} type="button" role="menuitem" onClick={() => { setSort(k); setSortOpen(false); }}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
              <button class="btn primary cm-new-cta" type="button" onClick={openComposerOrLogin}>פתח דיון</button>
            </div>

            {/* ── DISCUSSIONS ── */}
            <div class={`cp-panel${view === 'discuss' ? ' on' : ''}`} data-panel="discuss">
              {featured && (
                <section class="co-feat" aria-label="הדיון של היום">
                  <div class="co-feat-tag">הדיון של היום</div>
                  <a
                    class="co-feat-mref"
                    href={featured.market?.href || '#'}
                    onClick={featured.market?.href ? undefined : (e) => e.preventDefault()}
                  >
                    <span class="cat">{featured.cat}</span>
                    <span class="cm-id"><span class="dot"></span></span>
                    {featured.market?.pp != null && <span class="prob">{featured.market.pp}%</span>}
                    <span class={`mv ${featured.market?.mv?.dir || 'flat'}`}>{featured.market?.mv?.val}</span>
                  </a>
                  <p class="co-quote">
                    <a class="th-open" href={`/community/t/${featured.id}`}>{featured.title}</a>
                  </p>
                  <div class="co-feat-by">
                    <Avatar a={featured.author} size="md" />
                    <div class="by-txt">
                      <div class="by-nm">{featured.author.name} <Seal kind={featured.author.seal} /></div>
                      <div class="by-sub">{featured.time}</div>
                    </div>
                  </div>
                  <div class="co-feat-foot">
                    <a class="co-th-replies" href={`/community/t/${featured.id}`}>
                      <span class="material-symbols-outlined">mode_comment</span><b>{featured.replies}</b>
                    </a>
                    {featured.stack?.length > 0 && (
                      <div class="co-th-conv" style="margin:0;">
                        <Stack items={featured.stack} />
                        <span class="co-th-replies">מתדיינים עכשיו</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {listDiscussions.length ? (
                <section class="co-threads" aria-label="דיונים">
                  {listDiscussions.map((d) => (
                    <article class="co-thread" key={d.id}>
                      <div class="co-th-top">
                        <span class="co-th-cat">{d.cat}</span>
                        <a class="co-th-market" href={d.market?.href || '#'} onClick={d.market?.href ? undefined : (e) => e.preventDefault()}><span class="nm">{d.market.short}</span> {d.market.pp != null && <span class="pp">{d.market.pp}%</span>} <span class={`mv ${d.market.mv.dir}`}>{d.market.mv.val}</span></a>
                      </div>
                      <h3 class="co-th-q"><a href={`/community/t/${d.id}`}>{d.title}</a></h3>
                      <p class="co-th-take"><Seg parts={d.take} /></p>
                      <div class="co-th-meta">
                        <div class="co-th-by">
                          <Avatar a={d.author} size="sm" />
                          <span class="nm">{d.author.name} <Seal kind={d.author.seal} /></span>
                          <span class="cm-id"><span class="dot"></span></span>
                          <span class="tm">{d.time}</span>
                        </div>
                        <div class="co-th-conv">
                          <Stack items={d.stack} />
                          <span class="co-th-replies"><span class="material-symbols-outlined">mode_comment</span><b>{d.replies}</b></span>
                          <MoreMenu
                            kind="discussion"
                            id={d.id}
                            isMine={d.isMine}
                            authed={authed}
                            onNeedsAuth={openLogin}
                            onDeleted={() => setDiscussions((prev) => prev.filter((x) => x.id !== d.id))}
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              ) : (
                // only truly empty when there's no featured card either
                !featured && (
                  <div class="cm-empty"><span class="material-symbols-outlined">forum</span>{topic === 'הכל' ? 'אין דיונים עדיין — פתח את הראשון.' : 'אין דיונים בנושא הזה עדיין — '}{topic !== 'הכל' && <button class="cm-empty-clear" type="button" onClick={() => setTopic('הכל')}>חזרה לכל הנושאים</button>}</div>
                )
              )}
            </div>

            {/* ── ACTIVITY ── */}
            <div class={`cp-panel${view === 'activity' ? ' on' : ''}`} data-panel="activity">
              <div class="cp-composer-wrap">
                <FeedComposer onAddTake={addFeedItem} disabled={!authed} viewer={viewer} />
              </div>

              {filteredFeed.length ? (
                <section class="sq-feed" aria-label="פיד פעילות">
                  {filteredFeed.map((f) => (
                    <article class="sq-item" key={f.id}>
                      <Avatar a={f.author} size="md" />
                      <div class="sq-body">
                        {f.kind === 'milestone' ? (
                          <>
                            <div class="cm-id" style="margin-bottom:0.1rem;"><span class="nm">{f.author.name}</span><span class="dot"></span><span class="tm">{f.time}</span></div>
                            <div class="sq-mile">
                              <span class="avatar av-sm t-amber"><span class="material-symbols-outlined" style="font-size:18px;color:var(--hz-brand-strong);">{f.milestoneIcon || 'workspace_premium'}</span></span>
                              <div class="m-txt"><Seg parts={f.mile} /></div>
                            </div>
                          </>
                        ) : (
                          <div class="sq-head">
                            <div class="sq-head-txt">
                              <div class="cm-id"><span class="nm">{f.author.name}</span><Seal kind={f.author.seal} /><span class="dot"></span><span class="tm">{f.time}</span></div>
                              <div class="cm-verb"><Seg parts={f.verb} /></div>
                            </div>
                            {f.glyph && <span class={`sq-glyph ${f.glyph}`}><span class="material-symbols-outlined">{f.glyphIcon}</span></span>}
                          </div>
                        )}
                        {f.body && <p class="cm-take"><Seg parts={f.body} /></p>}
                        {f.market && <MarketRef m={f.market} />}
                        <div class="sq-foot">
                          <Acts
                            id={f.id}
                            comments={f.comments}
                            likes={likes}
                            onLike={safeLike}
                            onComment={f.commentable ? togglePostComments : undefined}
                            commentOpen={expandedPost === f.id}
                          />
                          {(f.kind === 'take' || f.kind === 'share') && (
                            <MoreMenu
                              kind="post"
                              id={f.id}
                              isMine={f.isMine}
                              authed={authed}
                              onNeedsAuth={openLogin}
                              onDeleted={() => setFeed((prev) => prev.filter((x) => x.id !== f.id))}
                            />
                          )}
                        </div>
                        {f.commentable && expandedPost === f.id && (
                          <FeedPostComments postId={f.id} viewer={viewer} onPosted={() => bumpCommentCount(f.id)} />
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              ) : (
                <div class="cm-empty"><span class="material-symbols-outlined">bolt</span>{topic === 'הכל' ? 'עוד אין פעילות — היה הראשון.' : 'אין פעילות בנושא הזה כרגע — '}{topic !== 'הכל' && <button class="cm-empty-clear" type="button" onClick={() => setTopic('הכל')}>חזרה לכל הנושאים</button>}</div>
              )}
            </div>
          </div>

          {/* ── RAIL ── */}
          <aside class="cp-rail">
            <div class="cm-rail cm-rail-sticky">
              {RAIL_NOW.length > 0 && (
                <div class="cm-card">
                  <div class="cm-card-h"><span class="t">נדון עכשיו</span></div>
                  <div class="co-now">
                    {RAIL_NOW.map((r) => <span key={r.topic} class="co-now-row"><span class="topic">{r.topic}</span><span class="cnt">{r.cnt}</span></span>)}
                  </div>
                </div>
              )}
              {RAIL_PEOPLE.length > 0 && (
                <div class="cm-card">
                  <div class="cm-card-h"><span class="t">קולות לעקוב</span></div>
                  <div class="sq-people">
                    {RAIL_PEOPLE.map((p) => (
                      <div class="sq-person" key={p.userId || p.name}>
                        <Avatar a={p} size="md" />
                        <div class="pp-txt"><div class="pp-nm">{p.name} <Seal kind={p.seal} /></div><div class="pp-sub">{p.accuracy != null ? <><b>{p.accuracy}%</b> דיוק</> : 'חזאי'}</div></div>
                        {p.handle && <Follow k={`person:${p.handle}`} follows={follows} onFollow={() => followPerson(p.handle)} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div class="cm-card">
                <div class="cm-card-h"><span class="t">כללי הקהילה</span><a class="lnk" href="/terms" target="_blank" rel="noopener noreferrer">תנאים</a></div>
                <ul class="cm-rules">
                  <li>כבדו זה את זה — בלי הסתה, השמצה או לשון הרע.</li>
                  <li>בלי תוכן בלתי חוקי, פוגעני או מפר זכויות.</li>
                  <li>בלי ספאם, מניפולציה או קידום עצמי בשווקים.</li>
                  <li>דיווח על תוכן פוגעני — דרך תפריט ⋯ שליד התגובה.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
