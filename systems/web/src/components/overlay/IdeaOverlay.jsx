// IdeaOverlay.jsx — "יש לך רעיון?" feedback overlay (landing-user).

import { useEffect, useRef, useState } from 'preact/hooks';
import useDialog from './useDialog.js';

const NAVI_IDEA_TYPES = {
  idea:     { label: 'רעיון',  icon: 'lightbulb',  helper: 'פיצ׳ר או שיפור',  flabel: 'פרטים', ph: 'מה היית רוצה לראות?' },
  bug:      { label: 'באג',    icon: 'bug_report', helper: 'משהו שבור',        flabel: 'פרטים', ph: 'מה ניסית לעשות, ומה קרה במקום?' },
  feedback: { label: 'משוב',   icon: 'forum',      helper: 'מחשבה כללית',      flabel: 'פרטים', ph: 'מה עובד, מפריע ואיך לשפר' },
};
const NAVI_IDEA_ORDER = ['idea', 'bug', 'feedback'];

function ideaSenderName() {
  const s = window.NaviAuthSession?.getState?.() || {};
  return (
    s.user?.displayName ||
    s.user?.name ||
    s.identity?.identifierHint ||
    window.NaviSiteShellPortfolioSummary?.getState?.()?.displayName ||
    'החוזה'
  );
}

function ideaSenderInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('') || '·';
}

function resizeFeedbackImageFile(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      resolve(null);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let out = canvas.toDataURL('image/webp', 0.82);
        if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', 0.85);
        resolve(out);
      } catch (_error) {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Auto-grow textarea — mirrors wireIdeaTextarea().
function useAutoGrow(taRef) {
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    function fit() {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    ta.addEventListener('input', fit);
    fit();
    return () => ta.removeEventListener('input', fit);
  }); // re-run every render so draft content from type-switch is sized correctly
}

// ── Sent screen ───────────────────────────────────────────────────────────────

function IdeaSent({ panelRef, onAgain, onClose }) {
  useDialog(panelRef, onClose);
  return (
    <div class="idea-pad">
      <div class="idea-sent">
        <div class="idea-sent__mark"><span class="material-symbols-outlined">check</span></div>
        <h3 class="idea-sent__title">המשוב נשלח</h3>
        <p class="idea-sent__body">תודה.</p>
        <div class="idea-sent__actions">
          <button type="button" data-idea-again class="idea-sent__again" onClick={onAgain}>לשליחת עוד פנייה</button>
          <button type="button" data-overlay-close class="idea-sent__done" onClick={onClose}>סגירה</button>
        </div>
      </div>
    </div>
  );
}

// ── Form screen ───────────────────────────────────────────────────────────────

function IdeaForm({ panelRef, ideaState, onTypeSwitch, onSubmit }) {
  // Focus trap + Esc handled by parent IdeaOverlay via useDialog(panelRef, onClose).
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const [draft, setDraft] = useState(() => ideaState.draft || { title: '', message: '' });
  const [imageData, setImageData] = useState(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  useAutoGrow(taRef);

  const t      = NAVI_IDEA_TYPES[ideaState.type] || NAVI_IDEA_TYPES.idea;
  const isBug  = ideaState.type === 'bug';
  const name   = ideaSenderName();

  function handleTypeSwitch(e) {
    onTypeSwitch(e.currentTarget.dataset.ideaType, draft);
  }

  function handleSubmit() {
    const form    = panelRef.current?.closest('.navi-overlay-panel--idea');
    const msgEl   = form?.querySelector('[data-idea-msg]');
    const errEl   = form?.querySelector('[data-idea-error]');
    const msg     = draft.message.trim();
    if (errEl) {
      errEl.textContent = 'צריך עוד כמה מילים כדי שנבין.';
      errEl.classList.remove('is-shown');
    }

    if (msg.length < 4) {
      msgEl?.classList.add('has-error');
      errEl?.classList.add('is-shown');
      msgEl?.focus();
      return;
    }

    const payload = {
      title: draft.title,
      message: draft.message,
      imageData,
    };

    const submitBtn = form?.querySelector('[data-idea-submit]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'שולח...';
    }

    onSubmit(ideaState.type, payload, submitBtn);
  }

  function handleAttach() {
    fileRef.current?.click();
  }

  async function handleFileChange(e) {
    const file = e.currentTarget.files?.[0];
    const errEl = panelRef.current?.querySelector('[data-idea-error]');
    if (!file) return;

    setIsProcessingImage(true);
    const dataUrl = await resizeFeedbackImageFile(file);
    setIsProcessingImage(false);

    if (!dataUrl) {
      setImageData(null);
      if (errEl) {
        errEl.textContent = 'לא הצלחנו לצרף את התמונה. נסו תמונה אחרת.';
        errEl.classList.add('is-shown');
      }
      return;
    }

    setImageData(dataUrl);
    errEl?.classList.remove('is-shown');
  }

  const cards = NAVI_IDEA_ORDER.map((id) => {
    const it = NAVI_IDEA_TYPES[id];
    return (
      <button
        key={id}
        type="button"
        data-idea-type={id}
        class={`idea-typecard ${id === ideaState.type ? 'is-active' : ''}`}
        onClick={handleTypeSwitch}
      >
        <span class="material-symbols-outlined">{it.icon}</span>
        <span class="idea-typecard__label">{it.label}</span>
      </button>
    );
  });

  return (
    <div class="idea-pad">
      <header class="idea-head">
        <h2 id="idea-overlay-title" class="idea-title">עזרו לנו לבנות את החוזה</h2>
        <p class="idea-sub">רעיון לפיצ׳ר, באג שמצאתם, או סתם מחשבה — הכל עוזר, והכל נקרא.</p>
      </header>
      <div class="idea-typecards" role="tablist">{cards}</div>
      <div class="idea-stack">
        <label class="idea-flabel" for="idea-title">כותרת</label>
        <input
          id="idea-title"
          data-idea-title
          class="idea-box"
          placeholder="בכמה מילים"
          value={draft.title}
          onInput={(e) => setDraft((prev) => ({ ...prev, title: e.currentTarget.value }))}
        />

        <label class="idea-flabel" for="idea-msg">{t.flabel}</label>
        <div class="idea-detail">
          <textarea
            ref={taRef}
            id="idea-msg"
            data-idea-msg
            rows="1"
            class="idea-box idea-area"
            placeholder={t.ph}
            value={draft.message}
            onInput={(e) => setDraft((prev) => ({ ...prev, message: e.currentTarget.value }))}
          />
          <button
            type="button"
            data-idea-attach
            class={`idea-clip ${imageData ? 'has-file' : ''} ${isProcessingImage ? 'is-processing' : ''}`}
            aria-label={isBug ? 'צירוף צילום מסך' : 'צירוף קובץ'}
            title={isProcessingImage ? 'מעבד תמונה' : imageData ? 'תמונה צורפה' : isBug ? 'צירוף צילום מסך של הבאג' : 'צירוף קובץ'}
            onClick={handleAttach}
            disabled={isProcessingImage}
          >
            <span class="material-symbols-outlined">{imageData ? 'check' : 'attach_file'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="idea-file"
            aria-label={isBug ? 'צירוף צילום מסך' : 'צירוף קובץ'}
            onChange={handleFileChange}
          />
        </div>
        <div class="idea-error" data-idea-error role="alert">צריך עוד כמה מילים כדי שנבין.</div>
      </div>
      <button
        type="button"
        data-idea-submit
        class="idea-cta"
        onClick={handleSubmit}
        disabled={isProcessingImage}
      >
        {isProcessingImage ? 'מעבד תמונה...' : 'שליחת המשוב'}
      </button>
      <div class="idea-sender">
        <span class="idea-sender__av">{ideaSenderInitials(name)}</span>
        <span>נשלח כ־<b>{name}</b></span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IdeaOverlay({ ideaState, onClose, onTypeSwitch, onAgain, onSubmit }) {
  const panelRef = useRef(null);
  useDialog(panelRef, onClose);

  function handleSubmit(type, draft, submitBtn) {
    const base   = window.NaviAuthSession?.getBackendBaseUrl?.() || '';
    window
      .fetch(base + '/api/feedback', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'content-type': 'application/json', accept: 'application/json' },
        body:        JSON.stringify({ type, ...draft }),
      })
      .then((res) => {
        if (!res.ok) throw new Error('feedback failed: ' + res.status);
        onSubmit(); // parent sets sent=true
      })
      .catch(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'שליחת המשוב';
        }
        const errEl = panelRef.current?.querySelector('[data-idea-error]');
        if (errEl) {
          errEl.textContent = 'השליחה נכשלה. נסו שוב בעוד רגע.';
          errEl.classList.add('is-shown');
        }
      });
  }

  return (
    <>
      <div class="navi-overlay-backdrop" data-overlay-close onClick={onClose} aria-hidden="true" />
      <div class="navi-overlay-shell">
        <section
          ref={panelRef}
          class="navi-overlay-panel navi-overlay-panel--idea"
          role="dialog"
          aria-modal="true"
          aria-labelledby="idea-overlay-title"
        >
          {ideaState.sent
            ? <IdeaSent panelRef={panelRef} onAgain={onAgain} onClose={onClose} />
            : (
              <IdeaForm
                panelRef={panelRef}
                ideaState={ideaState}
                onTypeSwitch={onTypeSwitch}
                onSubmit={handleSubmit}
              />
            )
          }
        </section>
      </div>
    </>
  );
}
