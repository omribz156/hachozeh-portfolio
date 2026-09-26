/** Community write surfaces. Wired to the real /api/community backend: the
 *  composers collect input + a real market ref and hand a rec to the parent,
 *  which POSTs and updates. Market picking uses live /api/search. position/
 *  result/milestone are AUTO-DERIVED into the feed from real trades/resolutions,
 *  so the composer only authors take + discussion + comment. */
import { useState, useRef, useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { MAX_POST, MAX_COMMENT } from './community-seed.js';
import { searchCommunitySubjects, fetchMyList } from './community-client.js';
import { Avatar } from './community-ui.jsx';
import useDialog from '../overlay/useDialog.js';

// The signed-in viewer as an Avatar-shaped author (real picture when they have one).
export function viewerAvatar(viewer) {
  return {
    name: viewer?.name || 'אתה',
    tint: 't-amber',
    initial: (viewer?.name || 'א').trim()[0] || 'א',
    avatarUrl: viewer?.avatarUrl || null,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const R = 9;
const C = 2 * Math.PI * R;

function grow(el, cap = 200) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, cap) + 'px';
}

// ── 0. Emoji picker ───────────────────────────────────────────────────────────
// Small curated set skewed to market talk (conviction, direction, outcome).
const EMOJIS = [
  '👍', '👎', '🔥', '🎯', '📈', '📉', '💰', '⚡', '✅', '❌',
  '🤔', '😅', '😂', '😍', '😐', '😬', '😱', '🙏', '👏', '💪',
  '⭐', '🏆', '🤝', '👀', '💡', '🚀', '🧠', '⏳', '🎲', '🍿',
];

export function EmojiPicker({ onPick }) {
  return (
    <div class="cm-emoji-pop" role="menu" aria-label="אימוג׳י">
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          class="cm-emoji-opt"
          role="menuitem"
          aria-label={e}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// Insert text at the textarea's caret (falls back to append) and restore focus.
function insertAtCaret(taRef, value, setValue, text) {
  const el = taRef?.current;
  if (!el) { setValue(value + text); return; }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  setValue(value.slice(0, start) + text + value.slice(end));
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
  });
}

// ── 1. CharRing ───────────────────────────────────────────────────────────────
export function CharRing({ value, max }) {
  const len = (value || '').length;
  const offset = (C * (1 - Math.min(len / max, 1))).toFixed(2);
  const left = max - len;
  const danger = left <= Math.floor(max * 0.1);

  return (
    <span class="cm-ring-wrap">
      <svg class={`cm-ring-count${danger ? ' over' : ''}`} viewBox="0 0 24 24">
        <circle class="track" cx="12" cy="12" r={R} />
        <circle class="prog" cx="12" cy="12" r={R} stroke-dasharray={C.toFixed(2)} stroke-dashoffset={offset} />
      </svg>
      {danger && <span class="cm-ring-rem over">{left}</span>}
    </span>
  );
}

// ── 2. SubjectSearch (live) ─────────────────────────────────────────────────────
// Debounced lookup for the composer picker: child markets AND parent events in
// one list (events tagged 'אירוע'). onPick receives a subject:
// { kind:'market'|'event', key, title, cat, prob, href }.
export function MarketSearch({ onPick, placeholder = 'חפש שוק או אירוע…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchCommunitySubjects(q);
      if (live) { setResults(rows); setLoading(false); }
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  function handlePick(s) {
    setQuery('');
    setResults([]);
    setOpen(false);
    onPick(s);
  }

  return (
    <div class="cm-combo">
      <input
        class="cm-market-search"
        type="text"
        autocomplete="off"
        placeholder={placeholder}
        value={query}
        onInput={(e) => { setQuery(e.target.value); setOpen(!!e.target.value.trim()); }}
        onFocus={() => query.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <div class={`cm-market-list${open ? ' open' : ''}`}>
        {results.length ? (
          results.map((s) => (
            <button
              key={`${s.kind}:${s.key}`}
              type="button"
              class={`cm-market-opt${s.kind === 'event' ? ' is-event' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(s)}
            >
              <span class="mo-cat">{s.kind === 'event' && <span class="mo-ev-tag">אירוע</span>}{s.cat}</span>
              <span class="mo-q">{s.title}</span>
              {s.prob != null && <span class="mo-p">{s.prob}%</span>}
            </button>
          ))
        ) : (
          <div class="cm-market-none">{loading ? 'מחפש…' : query.trim().length < 2 ? 'הקלד לפחות 2 תווים' : 'לא נמצא שוק או אירוע תואם'}</div>
        )}
      </div>
    </div>
  );
}

// ── 3. NewDiscussionModal ─────────────────────────────────────────────────────
export function NewDiscussionModal({ onClose, onSubmit }) {
  const [subject, setSubject] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [marketErr, setMarketErr] = useState(false);
  const [titleErr, setTitleErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const panelRef = useRef(null);
  useDialog(panelRef, onClose);

  // Body-scroll lock via the shared iOS-safe refcounter (NaviScrollLock) rather
  // than a raw overflow:hidden — the raw lock leaves the page in a stuck scroll
  // state after the iOS keyboard dismisses / the tab is backgrounded, which (with
  // the un-portaled overlay) froze the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.NaviScrollLock?.lock?.();
    return () => window.NaviScrollLock?.unlock?.();
  }, []);

  async function handleSubmit() {
    let ok = true;
    if (!subject) { setMarketErr(true); ok = false; }
    if (!title.trim()) { setTitleErr(true); ok = false; }
    if (body.trim().length < 2) { ok = false; setErr('כתוב נימוק קצר (לפחות 2 תווים).'); }
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await onSubmit({ subject, title: title.trim(), body: body.trim() });
      onClose();
    } catch (e) {
      setErr(e?.message || 'הפרסום נכשל, נסה שוב.');
      setBusy(false);
    }
  }

  const overlay = (
    <div class="cm-overlay">
      <div class="cm-scrim" onClick={onClose} />
      <div ref={panelRef} class="cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm-discussion-title">
        <div class="cm-modal-head">
          <h2 id="cm-discussion-title">פתח דיון חדש</h2>
          <button class="cm-modal-close" type="button" aria-label="סגור" onClick={onClose}>
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="cm-modal-body">
          <div class="cm-field">
            <label id="cm-label-market" class="cm-label">השוק או האירוע שבמרכז</label>
            {!subject ? (
              <div style={marketErr ? 'outline:1px solid var(--hz-action-sell);border-radius:var(--hz-radius-md);' : ''}>
                <MarketSearch onPick={(s) => { setSubject(s); setMarketErr(false); }} />
              </div>
            ) : (
              <div style="display:flex;align-items:center;gap:0.5em;">
                <input class="cm-market-search" type="text" value={`${subject.kind === 'event' ? 'אירוע · ' : ''}${subject.title}`} readOnly style="flex:1;" aria-labelledby="cm-label-market" />
                <button type="button" style="border:0;background:none;cursor:pointer;color:var(--hz-text-faint);font-size:0.8em;padding:0.4em;" onClick={() => setSubject(null)}>✕</button>
              </div>
            )}
          </div>
          <div class="cm-field">
            <label id="cm-label-title" class="cm-label">כותרת הדיון</label>
            <input
              class="cm-title"
              type="text"
              maxLength={140}
              placeholder="מה השאלה האמיתית פה?"
              value={title}
              onInput={(e) => { setTitle(e.target.value); setTitleErr(false); }}
              style={titleErr ? 'border-color:var(--hz-action-sell)' : ''}
              aria-labelledby="cm-label-title"
            />
          </div>
          <div class="cm-field">
            <label id="cm-label-body" class="cm-label">הנימוק שלך</label>
            <textarea
              class="cm-body"
              rows={4}
              maxLength={MAX_POST}
              placeholder="נמק את הקריאה — מה אתה רואה שהשוק מפספס?"
              value={body}
              onInput={(e) => setBody(e.target.value)}
              aria-labelledby="cm-label-body"
            />
          </div>
          {err && <div class="cm-compose-err" role="alert">{err}</div>}
        </div>
        <div class="cm-modal-foot">
          <button class="btn cm-cancel" type="button" onClick={onClose}>ביטול</button>
          <CharRing value={body} max={MAX_POST} />
          <button class="btn primary cm-submit" type="button" disabled={busy} onClick={handleSubmit}>{busy ? 'מפרסם…' : 'פרסם דיון'}</button>
        </div>
      </div>
    </div>
  );
  // Portal to <body> so the fixed overlay escapes the island's display:contents
  // wrapper (which breaks fixed-overlay hit-testing in Chromium/WebKit).
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}

// ── 4. FeedComposer ─────────────────────────────────────────────────────────────
// Four authored kinds (the design's toolbar): take (a market read, optional
// subject) + position / result / milestone. The latter three are picked from
// YOUR real data (server re-derives + validates on write — nothing is typed).
const MODES = [
  { key: 'position', icon: 'trending_up', title: 'פוזיציה שפתחת' },
  { key: 'result', icon: 'workspace_premium', title: 'שוק שהכרעת' },
  { key: 'milestone', icon: 'military_tech', title: 'הישג' },
];

export function FeedComposer({ onAddTake, disabled, viewer }) {
  const [mode, setMode] = useState('take'); // take | position | result | milestone
  const [value, setValue] = useState(''); // take text
  const [subject, setSubject] = useState(null); // take's optional attached subject
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // rich modes (position/result/milestone): the viewer's own items + a picked one + a note
  const [richList, setRichList] = useState(null); // null=loading
  const [richPick, setRichPick] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const taRef = useRef(null);

  function switchMode(m) {
    const next = mode === m ? 'take' : m;
    setMode(next);
    setRichPick(null); setNote(''); setErr(null); setAttachOpen(false); setEmojiOpen(false);
    if (next !== 'take') {
      setRichList(null);
      fetchMyList(next).then(setRichList).catch(() => setRichList([]));
    }
  }

  const canPost = mode === 'take'
    ? value.trim().length >= 2 && !busy && !disabled
    : !!richPick && !busy && !disabled;

  async function doPost() {
    if (!canPost) return;
    setBusy(true); setErr(null);
    try {
      if (mode === 'take') {
        await onAddTake({ kind: 'take', subjectKind: subject?.kind ?? null, subjectKey: subject?.key ?? null, body: value.trim() });
      } else if (mode === 'milestone') {
        await onAddTake({ kind: 'milestone', milestoneId: richPick.id, body: note.trim() });
      } else {
        await onAddTake({ kind: mode, subjectKind: 'market', subjectKey: richPick.marketKey, body: note.trim() });
      }
      setValue(''); setSubject(null); setRichPick(null); setNote(''); setMode('take'); setAttachOpen(false);
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch (e) {
      setErr(e?.message || 'הפרסום נכשל.');
    } finally {
      setBusy(false);
    }
  }

  const postLabel = { take: 'פרסם', position: 'שתף פוזיציה', result: 'שתף תוצאה', milestone: 'שתף הישג' }[mode];

  return (
    <div class="cm-xcompose">
      <Avatar a={viewerAvatar(viewer)} size="md" />
      <div class="xc-main">
        {mode === 'take' && (
          <div class="xc-blocks">
            <div class="xc-block">
              <textarea
                ref={taRef}
                class="xc-input"
                rows={1}
                maxLength={MAX_POST}
                placeholder={disabled ? 'התחבר כדי לכתוב קריאה' : 'מה קורה בשווקים?'}
                value={value}
                disabled={disabled}
                onInput={(e) => { grow(e.target); setValue(e.target.value); }}
              />
              {subject && (
                <div class="xc-market">
                  <span class="xc-market-chip">
                    {subject.kind === 'event' && <span class="mo-ev-tag">אירוע</span>}
                    {subject.title} {subject.prob != null && <span class="pp">{subject.prob}%</span>}
                    <button type="button" class="x" aria-label="הסר" onClick={() => setSubject(null)}>✕</button>
                  </span>
                </div>
              )}
            </div>
            {attachOpen && !subject && (
              <div class="xc-combo" style="margin-top:var(--hz-space-2);">
                <div class="xc-combo-field">
                  <MarketSearch onPick={(s) => { setSubject(s); setAttachOpen(false); }} placeholder="חפש שוק או אירוע לצרף…" />
                  <button type="button" class="xc-combo-x" title="סגור" onClick={() => setAttachOpen(false)}>
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode !== 'take' && (
          <div class="xc-rich">
            {richList === null ? (
              <div class="xc-rich-empty">טוען…</div>
            ) : richList.length === 0 ? (
              <div class="xc-rich-empty">
                {mode === 'position' ? 'אין לך פוזיציות פתוחות לשיתוף.' : mode === 'result' ? 'אין לך הכרעות לשיתוף עדיין.' : 'אין הישגים לשיתוף עדיין.'}
              </div>
            ) : (
              <div class="xc-rich-list">
                {richList.map((it) => (
                  <button
                    key={it.marketKey || it.id}
                    type="button"
                    class={`xc-rich-opt${(richPick?.marketKey || richPick?.id) === (it.marketKey || it.id) ? ' is-on' : ''}`}
                    onClick={() => setRichPick(it)}
                  >
                    {mode === 'milestone' ? (
                      <><span class="material-symbols-outlined">{it.icon}</span><span class="xc-rich-t">{it.badge}</span></>
                    ) : (
                      <>
                        <span class="xc-rich-t">{it.title}</span>
                        <span class={`xc-rich-tag ${it.side === 'sell' || it.resultKind === 'loss' ? 'sell' : 'buy'}`}>
                          {mode === 'position'
                            ? `${it.side === 'buy' ? 'כן' : 'לא'} · ${it.amount} V₪`
                            : `${it.resultKind === 'win' ? 'זכייה' : 'הפסד'} · ${it.pnl > 0 ? '+' : ''}${it.pnl}`}
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
            {richPick && mode !== 'milestone' && (
              <textarea
                class="xr-note"
                rows={2}
                maxLength={MAX_POST}
                placeholder={mode === 'position' ? 'למה נכנסת? (לא חובה)…' : 'מה למדת מזה? (לא חובה)…'}
                value={note}
                onInput={(e) => setNote(e.target.value)}
              />
            )}
          </div>
        )}

        {err && <div class="cm-compose-err" role="alert">{err}</div>}
        <div class="xc-bar">
          <div class="xc-tools">
            {MODES.map((m) => (
              <button key={m.key} type="button" class={`xc-tool${mode === m.key ? ' on' : ''}`} title={m.title} disabled={disabled} onClick={() => switchMode(m.key)}>
                <span class="material-symbols-outlined">{m.icon}</span>
              </button>
            ))}
            {mode === 'take' && (
              <button type="button" class={`xc-tool xc-attach${subject ? ' on' : ''}`} title="צרף שוק או אירוע" disabled={disabled} onClick={() => setAttachOpen((o) => !o)}>
                <span class="material-symbols-outlined">query_stats</span>
              </button>
            )}
            <div class="cm-emoji-wrap">
              <button type="button" class={`xc-tool${emojiOpen ? ' on' : ''}`} title="אימוג׳י" aria-expanded={emojiOpen ? 'true' : 'false'} disabled={disabled} onClick={() => setEmojiOpen((o) => !o)}>
                <span class="material-symbols-outlined">mood</span>
              </button>
              {emojiOpen && (
                <EmojiPicker onPick={(e) => {
                  if (mode === 'take') insertAtCaret(taRef, value, setValue, e);
                  else setNote((n) => n + e);
                  setEmojiOpen(false);
                }} />
              )}
            </div>
          </div>
          <div class="xc-right">
            {mode === 'take' && <CharRing value={value} max={MAX_POST} />}
            <button class="btn primary sm xc-post" type="button" disabled={!canPost} onClick={doPost}>{busy ? 'מפרסם…' : postLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 5. ThreadComposer ─────────────────────────────────────────────────────────
export function ThreadComposer({ onAddComment, disabled }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const taRef = useRef(null);

  async function doPost() {
    const text = value.trim();
    if (text.length < 2 || busy || disabled) { taRef.current?.focus(); return; }
    setBusy(true); setErr(null);
    try {
      await onAddComment({ body: text });
      setValue('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch (e) {
      setErr(e?.message || 'הפרסום נכשל.');
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doPost(); }
  }

  return (
    <>
      <textarea
        ref={taRef}
        class="th-cfield-input"
        rows={1}
        maxLength={MAX_COMMENT}
        placeholder={disabled ? 'התחבר כדי להגיב' : 'הוסף את הקריאה שלך… נמק עמדה, לא תוצאה.'}
        value={value}
        disabled={disabled}
        onInput={(e) => { setValue(e.target.value); grow(e.target, 220); }}
        onKeyDown={handleKeyDown}
      />
      {err && <div class="cm-compose-err" role="alert">{err}</div>}
      <div class="xc-bar">
        <div class="xc-tools">
          <div class="cm-emoji-wrap">
            <button
              type="button"
              class={`xc-tool${emojiOpen ? ' on' : ''}`}
              title="אימוג׳י"
              aria-expanded={emojiOpen ? 'true' : 'false'}
              disabled={disabled}
              onClick={() => setEmojiOpen((o) => !o)}
            >
              <span class="material-symbols-outlined">mood</span>
            </button>
            {emojiOpen && (
              <EmojiPicker onPick={(e) => { insertAtCaret(taRef, value, setValue, e); setEmojiOpen(false); }} />
            )}
          </div>
        </div>
        <div class="xc-right">
          <CharRing value={value} max={MAX_COMMENT} />
          <button class="btn primary sm thc-post" type="button" disabled={!value.trim() || busy || disabled} onClick={doPost}>{busy ? 'מפרסם…' : 'פרסם תגובה'}</button>
        </div>
      </div>
    </>
  );
}
