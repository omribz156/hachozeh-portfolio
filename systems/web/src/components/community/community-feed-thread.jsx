/** Inline reply thread under a feed post (take/share). Opens when the comment
 *  button is tapped: fetches the post's comments and offers a composer. Guests
 *  can read; posting is auth-gated. Reuses /api/community/posts/:id/comments. */
import { useState, useEffect } from 'preact/hooks';
import { Avatar, Seal, Seg, MoreMenu } from './community-ui.jsx';
import { postCommunity } from './community-client.js';

export function FeedPostComments({ postId, viewer, onPosted }) {
  const authed = Boolean(viewer?.authenticated);
  const ME = { name: viewer?.name || 'אתה', tint: 't-amber', initial: (viewer?.name || 'א').trim()[0] || 'א', seal: null, avatarUrl: viewer?.avatarUrl || null };
  const [comments, setComments] = useState(null); // null = loading
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/community/feed/${encodeURIComponent(postId)}/comments`, { credentials: 'include', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => { if (live) setComments(d.comments || []); })
      .catch(() => { if (live) setComments([]); });
    return () => { live = false; };
  }, [postId]);

  async function post() {
    const text = value.trim();
    if (text.length < 2 || busy || !authed) return;
    setBusy(true); setErr(null);
    try {
      const res = await postCommunity(`/api/community/feed/${encodeURIComponent(postId)}/comments`, { body: text });
      setComments((prev) => [...(prev || []), { id: res?.id || `tmp-${Date.now()}`, author: ME, time: 'עכשיו', body: [text], likes: 0 }]);
      setValue('');
      if (onPosted) onPosted();
    } catch (e) {
      setErr(e?.message || 'הפרסום נכשל.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="cm-postthread">
      {comments === null ? (
        <div class="cm-pt-loading">טוען תגובות…</div>
      ) : (
        <>
          {comments.length === 0 && <div class="cm-pt-empty">היה הראשון להגיב.</div>}
          {comments.map((c) => (
            <div class="cm-pt-c" key={c.id}>
              <Avatar a={c.author} size="sm" />
              <div class="cm-pt-c-main">
                <div class="cm-pt-c-head"><span class="nm">{c.author.name}</span>{c.author.seal && <Seal kind={c.author.seal} />}<span class="tm">{c.time}</span></div>
                <p class="cm-pt-c-txt"><Seg parts={c.body} /></p>
                <MoreMenu
                  kind="comment"
                  id={c.id}
                  isMine={c.isMine}
                  authed={authed}
                  onDeleted={(id) => setComments((prev) => (prev || []).filter((x) => x.id !== id))}
                />
              </div>
            </div>
          ))}
          <div class="cm-pt-composer">
            <textarea
              class="cm-pt-input"
              rows={1}
              maxLength={1200}
              placeholder={authed ? 'הוסף תגובה…' : 'התחבר כדי להגיב'}
              value={value}
              disabled={!authed}
              onInput={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); post(); } }}
            />
            <button class="btn primary sm" type="button" disabled={value.trim().length < 2 || busy || !authed} onClick={post}>{busy ? 'שולח…' : 'שלח'}</button>
          </div>
          {err && <div class="cm-compose-err">{err}</div>}
        </>
      )}
    </div>
  );
}
