import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import useFocusTrap from '../overlay/useFocusTrap.js';
import { readParam, writeParam } from '../../lib/url-view-state.js';

// Settings.jsx — Preact settings island.
// Same DOM shape, same data-* attributes, same classes, same behavior.

const DEFAULT_AVATAR_URL = '/assets/brand/default-avatar-96.webp';
const HANDLE_RULE = '3–24 תווים: אותיות קטנות, מספרים, נקודה, קו תחתון';
const BIO_MAX = 100;

// ── helpers ──────────────────────────────────────────────────────────────────

function apiBase() {
  try {
    if (window.NaviAuthSession && typeof window.NaviAuthSession.getBackendBaseUrl === 'function') {
      return window.NaviAuthSession.getBackendBaseUrl() || '';
    }
  } catch { /* fall through */ }
  return '';
}

function request(path, options) {
  return window.fetch(apiBase() + path, Object.assign({
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
  }, options || {})).then(function (res) {
    if (!res.ok) {
      return res.json().catch(function () { return null; }).then(function (body) {
        const err = new Error(path + ' failed: ' + res.status);
        err.code = body && body.error && body.error.code;
        throw err;
      });
    }
    return res.json().catch(function () { return null; });
  });
}

function requestBlob(path) {
  return window.fetch(apiBase() + path, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  }).then(function (res) {
    if (!res.ok) throw new Error(path + ' failed: ' + res.status);
    return res.blob().then(function (blob) {
      return { blob, response: res };
    });
  });
}

function refreshAuthUser() {
  if (window.NaviAuthSession && typeof window.NaviAuthSession.refreshCurrentUser === 'function') {
    return window.NaviAuthSession.refreshCurrentUser().catch(function () { return null; });
  }
  return Promise.resolve(null);
}

function filenameFromDisposition(header) {
  if (!header) return 'hachozeh-data-export.json';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match && utf8Match[1]) {
    try { return decodeURIComponent(utf8Match[1].trim()); } catch { /* fall through */ }
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(header);
  if (quotedMatch && quotedMatch[1]) return quotedMatch[1].trim();
  const plainMatch = /filename=([^;]+)/i.exec(header);
  if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
  return 'hachozeh-data-export.json';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'hachozeh-data-export.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
}

function formatHebrewDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return date.toLocaleString('he-IL');
}

function normalizeHandleDraft(v) { return String(v || '').trim().toLowerCase().replace(/^@/, ''); }
function handleValid(v) { return /^[a-z0-9._]{3,24}$/.test(normalizeHandleDraft(v)); }

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('read failed')); };
    reader.readAsDataURL(file);
  });
}

function resizeAvatarFile(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      try {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        let out = canvas.toDataURL('image/webp', 0.82);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.85);
        resolve(out);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

// useFlash: returns [label, flash(text)] — flash replaces label for 1600ms then restores.
function useFlash(defaultLabel) {
  const [label, setLabel] = useState(defaultLabel);
  const timerRef = useRef(null);
  const flash = useCallback(function (text) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLabel(text);
    timerRef.current = window.setTimeout(function () {
      setLabel(defaultLabel);
    }, 1600);
  }, [defaultLabel]);
  return [label, flash];
}

// ── sub-components ────────────────────────────────────────────────────────────

function DisplayNameSection({ initialDisplayName }) {
  const [displayName, setDisplayName] = useState(initialDisplayName || '');
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName || '');
  const [msg, setMsg] = useState('');
  const [saveLabel, setSaveLabel] = useState('שמירה');
  const [saveBusy, setSaveBusy] = useState(false);

  const normalized = displayName.replace(/\s+/g, ' ').trim();
  const isInvalid = normalized.length > 40;
  const showActions = normalized !== savedDisplayName && !isInvalid && !saveBusy;

  function handleInput(e) {
    const value = e.target.value;
    setDisplayName(value);
    const clean = value.replace(/\s+/g, ' ').trim();
    setMsg(clean.length > 40 ? 'שם התצוגה חייב להיות עד 40 תווים' : '');
  }

  function handleSave() {
    setSaveBusy(true);
    setSaveLabel('שומר…');
    request('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: normalized || null }),
    })
      .then(function (payload) {
        const next = payload?.user?.displayName || normalized;
        setSavedDisplayName(next);
        setDisplayName(next);
        setMsg('');
        setSaveLabel('נשמר!');
        return refreshAuthUser();
      })
      .then(function () {
        window.setTimeout(function () {
          setSaveLabel('שמירה');
          setSaveBusy(false);
        }, 1500);
      })
      .catch(function (err) {
        setSaveBusy(false);
        setSaveLabel('שמירה');
        if (err && err.code === 'name_not_allowed') setMsg('השם הזה לא זמין. נסו שם אחר.');
        else if (err && err.code === 'invalid_request') setMsg('שם התצוגה לא תקין או שמור למערכת');
        else setMsg('השמירה נכשלה, נסו שוב');
      });
  }

  return (
    <div class="lg-row">
      <div class="lg-labelrow"><div class="lg-label" id="settings-display-name-label">שם תצוגה</div></div>
      <div class="lg-field">
        <input
          class="st-input"
          aria-labelledby="settings-display-name-label"
          value={displayName}
          placeholder="השם שיופיע בפרופיל"
          maxlength="40"
          autocomplete="name"
          data-settings-profile="displayName"
          onInput={handleInput}
        />
        <div class="lg-hint is-error" role="alert" data-settings-display-name-msg hidden={!msg}>
          {msg}
        </div>
        <div class="lg-editactions" data-settings-display-name-actions hidden={!showActions}>
          <button
            class="st-btn st-btn--primary st-btn--sm"
            type="button"
            data-settings-action="save-display-name"
            disabled={saveBusy}
            onClick={handleSave}
          >{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Social section (static — "בקרוב" stubs)
function SocialSection() {
  return (
    <div class="lg-row">
      <div class="lg-labelrow"><div class="lg-label">רשתות חברתיות</div><span class="lg-soon">בקרוב</span></div>
      <div class="lg-hint">חבר פרופילים כדי שיוצגו בעמוד הציבורי שלך.</div>
      <div class="lg-field">
        <div class="lg-social">
          <div class="lg-social__row">
            <div class="lg-social__mark lg-social__mark--x">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.656l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </div>
            <div class="lg-social__main"><div class="lg-social__name">X</div><div class="lg-social__handle lg-social__handle--off">לא מחובר</div></div>
            <button class="st-btn st-btn--sm" type="button" disabled>חיבור</button>
          </div>
          <div class="lg-social__row">
            <div class="lg-social__mark lg-social__mark--telegram">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
            </div>
            <div class="lg-social__main"><div class="lg-social__name">Telegram</div><div class="lg-social__handle lg-social__handle--off">לא מחובר</div></div>
            <button class="st-btn st-btn--sm" type="button" disabled>חיבור</button>
          </div>
          <div class="lg-social__row">
            <div class="lg-social__mark lg-social__mark--instagram">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" /></svg>
            </div>
            <div class="lg-social__main"><div class="lg-social__name">Instagram</div><div class="lg-social__handle lg-social__handle--off">לא מחובר</div></div>
            <button class="st-btn st-btn--sm" type="button" disabled>חיבור</button>
          </div>
          <div class="lg-social__row">
            <div class="lg-social__mark lg-social__mark--website"><span class="material-symbols-outlined" aria-hidden="true">link</span></div>
            <div class="lg-social__main"><div class="lg-social__name">אתר אישי</div><div class="lg-social__handle lg-social__handle--off">לא מחובר</div></div>
            <button class="st-btn st-btn--sm" type="button" disabled>חיבור</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Avatar section
function AvatarSection({ userInitial, initialAvatarUrl }) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || '');
  const [busy, setBusy] = useState(false);
  const [clearLabel, flashClear] = useFlash('הסרה');
  const inputRef = useRef(null);

  const hasCustomAvatar = !!avatarUrl;

  function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type || '') || file.size > 12 * 1024 * 1024) {
      flashClear(file.size > 12 * 1024 * 1024 ? 'קובץ גדול מדי' : 'קובץ לא תקין');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    resizeAvatarFile(file).catch(function () { return readFileAsDataUrl(file); })
      .then(function (imageData) {
        return request('/api/me/avatar', {
          method: 'POST',
          body: JSON.stringify({ imageData }),
        });
      })
      .then(function (payload) {
        const url = payload && payload.user ? payload.user.avatarUrl : null;
        setAvatarUrl(url || '');
        return refreshAuthUser();
      })
      .catch(function () {
        flashClear('נכשל');
      })
      .finally(function () {
        if (inputRef.current) inputRef.current.value = '';
        setBusy(false);
      });
  }

  function handleClear() {
    setBusy(true);
    request('/api/me/avatar', { method: 'DELETE', body: '{}' })
      .then(function () {
        setAvatarUrl('');
        return refreshAuthUser();
      })
      .catch(function () {
        flashClear('נכשל');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  return (
    <div class="lg-row lg-row--inline">
      <div class="lg-rowmain">
        <div class="lg-labelrow"><div class="lg-label">תמונת פרופיל</div></div>
      </div>
      <div class="lg-rowend">
        <label class={`st-avatar-edit${busy ? ' is-busy' : ''}`} data-settings-avatar-picker>
          <span
            class="st-avatar st-avatar--lg"
            aria-hidden="true"
            data-settings-avatar-preview
            data-settings-avatar-initial={userInitial}
          >
            {avatarUrl ? (
              <img class="st-avatar__img" src={avatarUrl} alt="" width="96" height="96" data-settings-avatar-img />
            ) : (
              <img class="st-avatar__img" src={DEFAULT_AVATAR_URL} alt="" width="96" height="96" data-settings-avatar-img data-settings-default-avatar />
            )}
          </span>
          <span class="st-avatar-scrim" aria-hidden="true">
            <span class="material-symbols-outlined">upload</span>
          </span>
          <input
            ref={inputRef}
            class="st-avatar-input"
            type="file"
            accept="image/*"
            aria-label="העלאת תמונת פרופיל"
            data-settings-avatar-input
            hidden
            disabled={busy}
            onChange={handleFileChange}
          />
        </label>
        <button
          class="st-btn st-btn--sm"
          type="button"
          data-settings-action="clear-avatar"
          disabled={!hasCustomAvatar || busy}
          onClick={handleClear}
        >{clearLabel}</button>
      </div>
    </div>
  );
}

// Handle / profile address section
function HandleSection({ initialHandle }) {
  const [handle, setHandle] = useState(initialHandle || '');
  const [savedHandle, setSavedHandle] = useState(initialHandle || '');
  const [handleMsg, setHandleMsg] = useState('');
  const [saveLabel, setSaveLabel] = useState('שמירה');
  const [saveBusy, setSaveBusy] = useState(false);

  const trimmedLower = normalizeHandleDraft(handle);
  const isInvalid = !!trimmedLower && !handleValid(trimmedLower);
  const showActions = trimmedLower !== savedHandle && !isInvalid && !saveBusy;

  function handleInput(e) {
    const v = e.target.value;
    setHandle(v);
    const vl = normalizeHandleDraft(v);
    setHandleMsg(!!vl && !handleValid(vl) ? HANDLE_RULE : '');
  }

  function handleSave() {
    const h = normalizeHandleDraft(handle);
    setSaveBusy(true);
    setSaveLabel('שומר…');
    request('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ handle: h }),
    })
      .then(function () { return refreshAuthUser(); })
      .then(function () {
        setSavedHandle(h);
        setHandle(h);
        setHandleMsg('');
        setSaveLabel('נשמר!');
        window.setTimeout(function () {
          setSaveLabel('שמירה');
          setSaveBusy(false);
        }, 1500);
      })
      .catch(function (err) {
        setSaveBusy(false);
        setSaveLabel('שמירה');
        if (err && err.code === 'handle_taken') setHandleMsg('השם תפוס, נסו אחר');
        else if (err && err.code === 'handle_change_cooldown') setHandleMsg('אפשר לשנות שם משתמש אחת ל־30 יום');
        else if (err && err.code === 'invalid_request') setHandleMsg(HANDLE_RULE);
        else setHandleMsg('השמירה נכשלה, נסו שוב');
      });
  }

  return (
    <div class="lg-row">
      <div class="lg-labelrow"><div class="lg-label" id="settings-handle-label">כתובת פרופיל</div></div>
      <div class="lg-field">
        <input
          class="st-input"
          dir="ltr"
          aria-labelledby="settings-handle-label"
          value={handle}
          placeholder="@username"
          maxlength="25"
          autocomplete="off"
          spellcheck="false"
          data-settings-profile="handle"
          onInput={handleInput}
        />
        <div class="lg-hint is-error" role="alert" data-settings-handle-msg hidden={!handleMsg}>
          {handleMsg}
        </div>
        <div class="lg-hint" hidden={Boolean(handleMsg)}>הקישור הציבורי שלך יהיה /@{trimmedLower || 'username'} · ניתן לשנות אחת ל־30 יום</div>
        <div class="lg-editactions" data-settings-handle-actions hidden={!showActions}>
          <button
            class="st-btn st-btn--primary st-btn--sm"
            type="button"
            data-settings-action="save-profile"
            disabled={saveBusy}
            onClick={handleSave}
          >{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Bio section
function BioSection({ initialBio }) {
  const [bio, setBio] = useState(initialBio || '');
  const [savedBio, setSavedBio] = useState(initialBio || '');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveLabel, setSaveLabel] = useState('שמירת שינויים');
  const textareaRef = useRef(null);

  const bioLen = bio.length;
  const showActions = bio !== savedBio;

  function autoGrow() {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
  }

  useEffect(function () { autoGrow(); }, [bio]);

  function handleInput(e) {
    setBio(e.target.value);
  }

  function handleSave() {
    setSaveBusy(true);
    setSaveLabel('שומר…');
    request('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ bio }),
    })
      .then(function () {
        setSavedBio(bio);
        setSaveLabel('שמירת שינויים');
      })
      .catch(function () {
        setSaveLabel('שמירת שינויים');
        // flash "נכשל" briefly on the save button — handled via label swap
        setSaveLabel('נכשל');
        window.setTimeout(function () { setSaveLabel('שמירת שינויים'); }, 1600);
      })
      .finally(function () {
        setSaveBusy(false);
      });
  }

  function handleCancel() {
    setBio(savedBio);
  }

  return (
    <div class="lg-row">
      <div class="lg-labelrow"><div class="lg-label" id="settings-bio-label">אודות</div></div>
      <div class="lg-field">
        <div class="lg-biowrap">
          <textarea
            ref={textareaRef}
            class="st-textarea lg-bioarea"
            rows="1"
            aria-labelledby="settings-bio-label"
            placeholder="ספר לנו על עצמך"
            maxlength="100"
            data-settings-profile="bio"
            value={bio}
            onInput={handleInput}
          >{bio}</textarea>
          <div class={`lg-biocount${bioLen >= BIO_MAX ? ' is-full' : ''}`} data-settings-biocount>
            {bioLen}/100
          </div>
        </div>
        <div class="lg-editactions" data-settings-bio-actions hidden={!showActions}>
          <button
            class="st-btn st-btn--primary st-btn--sm"
            type="button"
            data-settings-action="save-bio"
            disabled={saveBusy}
            onClick={handleSave}
          >{saveLabel}</button>
          <button
            class="st-btn st-btn--sm"
            type="button"
            data-settings-action="cancel-bio"
            disabled={saveBusy}
            onClick={handleCancel}
          >ביטול</button>
        </div>
      </div>
    </div>
  );
}

// Sessions section
function SessionsSection({ initialSessions, initialOtherDevices }) {
  const [sessions, setSessions] = useState(initialSessions || []);
  const [otherDevices] = useState(initialOtherDevices || 0);
  const [logoutOthersModal, setLogoutOthersModal] = useState(false);
  const [logoutBtnLabel, setLogoutBtnLabel] = useState('ניתוק');
  const [logoutBtnDisabled, setLogoutBtnDisabled] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState('ניתוק הכל');
  const logoutTriggerRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const logoutModalCardRef = useRef(null);
  useFocusTrap(logoutModalCardRef);

  function openLogoutModal() {
    setLogoutOthersModal(true);
  }
  function closeLogoutModal() {
    setLogoutOthersModal(false);
    if (logoutTriggerRef.current) logoutTriggerRef.current.focus();
  }

  // Escape key closes the modal
  useEffect(function () {
    if (!logoutOthersModal) return;
    function onKey(e) { if (e.key === 'Escape') closeLogoutModal(); }
    document.addEventListener('keydown', onKey);
    return function () { document.removeEventListener('keydown', onKey); };
  }, [logoutOthersModal]);

  // Focus confirm btn when modal opens
  useEffect(function () {
    if (logoutOthersModal && confirmBtnRef.current) confirmBtnRef.current.focus();
  }, [logoutOthersModal]);

  function handleRevokeSession(id) {
    return function () {
      const btn = document.querySelector(`[data-settings-action="revoke-session"][data-session-id="${CSS.escape(id)}"]`);
      if (btn) { btn.disabled = true; btn.textContent = 'מנתק…'; }
      request('/api/me/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
        body: '{}',
      })
        .then(function () {
          setSessions(function (prev) { return prev.filter(function (s) { return s.id !== id; }); });
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'ניסיון נכשל'; }
        });
    };
  }

  function handleLogoutOthersConfirm() {
    setConfirmBusy(true);
    setConfirmLabel('מנתק…');
    request('/api/me/sessions/revoke-others', { method: 'POST', body: '{}' })
      .then(function () {
        closeLogoutModal();
        setLogoutBtnDisabled(true);
        setLogoutBtnLabel('נותק');
        setSessions(function (prev) { return prev.filter(function (s) { return s.current; }); });
      })
      .catch(function () {
        setConfirmBusy(false);
        setConfirmLabel('ניתוק הכל');
        setLogoutBtnLabel('ניסיון נכשל — נסה שוב');
      });
  }

  return (
    <>
      <div class="lg-row">
        <div class="lg-label">מכשירים מחוברים</div>
        <div class="lg-hint">מכשירים שמחוברים כרגע לחשבון שלך.</div>
        <div class="lg-field">
          <div class="st-sessions">
            {sessions.length > 0 ? sessions.map(function (session) {
              return (
                <div class="st-session" key={session.id} data-settings-session={session.id}>
                  <div class="st-session__ic">
                    <span class="material-symbols-outlined" aria-hidden="true">
                      {session.current ? 'laptop_mac' : 'smartphone'}
                    </span>
                  </div>
                  <div>
                    <div class="st-session__name">{session.label}</div>
                    <div class={session.current ? 'st-session__meta st-session__now' : 'st-session__meta'}>
                      {session.current
                        ? 'הפעלה נוכחית'
                        : `נראה לאחרונה: ${session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString('he-IL') : 'לא ידוע'}`
                      }
                    </div>
                  </div>
                  {session.current ? (
                    <span class="st-session__here">מכשיר זה</span>
                  ) : (
                    <button
                      class="st-btn st-btn--sm"
                      type="button"
                      data-settings-action="revoke-session"
                      data-session-id={session.id}
                      onClick={handleRevokeSession(session.id)}
                    >ניתוק</button>
                  )}
                </div>
              );
            }) : (
              <div class="st-session">
                <div class="st-session__ic"><span class="material-symbols-outlined" aria-hidden="true">laptop_mac</span></div>
                <div>
                  <div class="st-session__name">המכשיר הזה</div>
                  <div class="st-session__meta st-session__now">הפעלה נוכחית</div>
                </div>
                <span class="st-session__here">מכשיר זה</span>
              </div>
            )}
            {sessions.length === 0 && otherDevices > 0 && (
              <div class="st-session">
                <div class="st-session__ic"><span class="material-symbols-outlined" aria-hidden="true">smartphone</span></div>
                <div>
                  <div class="st-session__name">{otherDevices} מכשירים נוספים</div>
                  <div class="st-session__meta">נתק את כולם בכפתור למטה</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div class="lg-row lg-row--inline">
        <div class="lg-rowmain">
          <div class="lg-label">ניתוק מכל המכשירים</div>
          <div class="lg-hint">תתנתק מכל הדפדפנים והמכשירים מלבד זה.</div>
        </div>
        <div class="lg-rowend">
          <button
            ref={logoutTriggerRef}
            class="st-btn st-btn--warn"
            type="button"
            data-settings-action="logout-others"
            disabled={logoutBtnDisabled}
            onClick={openLogoutModal}
          >{logoutBtnLabel}</button>
        </div>
      </div>

      {/* confirm: log out of all other devices */}
      <div
        class="st-overlay"
        data-settings-modal="logout-others"
        hidden={!logoutOthersModal}
        onClick={function (e) { if (e.target === e.currentTarget) closeLogoutModal(); }}
      >
        <div
          ref={logoutModalCardRef}
          class="st-overlay__card st-overlay__card--confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-others-title"
          onClick={function (e) { e.stopPropagation(); }}
        >
          <div class="st-confirm__ic st-confirm__ic--danger">
            <span class="material-symbols-outlined" aria-hidden="true">logout</span>
          </div>
          <h3 id="logout-others-title" class="st-overlay__title">לנתק מכל המכשירים?</h3>
          <p class="st-overlay__sub">כל ההפעלות מלבד זו ינותקו. תצטרך להתחבר מחדש בכל מכשיר אחר.</p>
          <div class="st-overlay__actions st-overlay__actions--row">
            <button
              ref={confirmBtnRef}
              class="st-btn st-btn--sm st-btn--solid-danger"
              type="button"
              data-settings-confirm="logout-others"
              disabled={confirmBusy}
              onClick={handleLogoutOthersConfirm}
            >{confirmLabel}</button>
            <button class="st-overlay__cancel" type="button" data-settings-dismiss onClick={closeLogoutModal}>ביטול</button>
          </div>
        </div>
      </div>
    </>
  );
}

// Data export button
function DataExportRow() {
  const [label, setLabel] = useState('הורדה');
  const [busy, setBusy] = useState(false);

  function handleDownload() {
    setBusy(true);
    setLabel('מכין…');
    requestBlob('/api/me/data-export')
      .then(function (payload) {
        const filename = filenameFromDisposition(payload.response.headers.get('content-disposition'));
        downloadBlob(payload.blob, filename);
        setLabel('הורדה');
        // brief flash "ירד"
        setLabel('ירד');
        window.setTimeout(function () { setLabel('הורדה'); }, 1600);
      })
      .catch(function () {
        setLabel('נכשל');
        window.setTimeout(function () { setLabel('הורדה'); }, 1600);
      })
      .finally(function () {
        setBusy(false);
      });
  }

  return (
    <div class="lg-row lg-row--inline">
      <div class="lg-rowmain">
        <div class="lg-labelrow"><div class="lg-label">הורדת הנתונים שלי</div></div>
        <div class="lg-hint">קובץ JSON עם פרטי החשבון, הפוזיציות והפעילות שלך.</div>
      </div>
      <div class="lg-rowend">
        <button
          class="st-btn"
          type="button"
          data-settings-action="download-data-export"
          disabled={busy}
          onClick={handleDownload}
        >{label}</button>
      </div>
    </div>
  );
}

// Notification toggle button (single pref key)
function NotifyToggle({ prefKey, initialOn }) {
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);

  function handleClick() {
    const next = !on;
    const previous = on;
    setBusy(true);
    setOn(next);
    const body = {};
    body[prefKey] = next;
    request('/api/me/notification-preferences', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
      .catch(function () {
        setOn(previous);
      })
      .finally(function () {
        setBusy(false);
      });
  }

  return (
    <button
      class={on ? 'st-toggle is-on' : 'st-toggle'}
      type="button"
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      data-settings-pref={prefKey}
      disabled={busy}
      onClick={handleClick}
    >
      <span class="st-toggle__dot" />
    </button>
  );
}

// Account deletion section
function DeletionSection({ initialDeletion }) {
  const init = initialDeletion || {};
  const [status, setStatus] = useState(init.status || 'none');
  const [deleteAfter, setDeleteAfter] = useState(init.deleteAfter || '');
  const [deletionModal, setDeletionModal] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState('התחלת מחיקה');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelLabel, setCancelLabel] = useState('ביטול מחיקה');
  const scheduleBtnRef = useRef(null);
  const reasonRef = useRef(null);
  const deletionModalCardRef = useRef(null);
  useFocusTrap(deletionModalCardRef);

  const deleteAfterLabel = formatHebrewDate(deleteAfter);

  const deletionCopy =
    status === 'scheduled'
      ? `המחיקה מתוזמנת ל-${deleteAfterLabel || 'המועד שנקבע'}. עד אז אפשר לבטל. מסחר חסום בזמן ההמתנה.`
      : status === 'completed'
        ? 'ניקוי הזהות בחשבון הושלם.'
        : 'החשבון ייחסם למסחר מיד. ניתן לבטל במשך 14 ימים. לאחר מכן המערכת תמחק פרטי זהות ותשאיר רשומות מסחר/יתרה לצורך תקינות השוק.';

  function openDeletionModal() {
    setDeletionModal(true);
  }
  function closeDeletionModal() {
    setDeletionModal(false);
    if (scheduleBtnRef.current) scheduleBtnRef.current.focus();
  }

  useEffect(function () {
    if (!deletionModal) return;
    function onKey(e) { if (e.key === 'Escape') closeDeletionModal(); }
    document.addEventListener('keydown', onKey);
    return function () { document.removeEventListener('keydown', onKey); };
  }, [deletionModal]);

  useEffect(function () {
    if (deletionModal && reasonRef.current) reasonRef.current.focus();
  }, [deletionModal]);

  function handleScheduleConfirm() {
    const reason = reasonText.trim();
    setConfirmBusy(true);
    setConfirmLabel('מתחיל…');
    request('/api/me/account-deletion', {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null }),
    })
      .then(function (payload) {
        setConfirmLabel('התחלת מחיקה');
        if (payload && payload.deletion) {
          setStatus(payload.deletion.status || 'none');
          setDeleteAfter(payload.deletion.deleteAfter || '');
        }
        closeDeletionModal();
        setReasonText('');
        return refreshAuthUser();
      })
      .catch(function () {
        setConfirmLabel('התחלת מחיקה');
        // flash "נכשל"
        setConfirmLabel('נכשל');
        window.setTimeout(function () { setConfirmLabel('התחלת מחיקה'); }, 1600);
      })
      .finally(function () {
        setConfirmBusy(false);
      });
  }

  function handleCancelDeletion() {
    setCancelBusy(true);
    setCancelLabel('מבטל…');
    request('/api/me/account-deletion', { method: 'DELETE', body: '{}' })
      .then(function (payload) {
        setCancelLabel('ביטול מחיקה');
        if (payload && payload.deletion) {
          setStatus(payload.deletion.status || 'none');
          setDeleteAfter(payload.deletion.deleteAfter || '');
        }
        return refreshAuthUser();
      })
      .catch(function () {
        setCancelLabel('ביטול מחיקה');
        setCancelLabel('נכשל');
        window.setTimeout(function () { setCancelLabel('ביטול מחיקה'); }, 1600);
      })
      .finally(function () {
        setCancelBusy(false);
      });
  }

  return (
    <>
      <div
        class="lg-row lg-row--inline"
        data-settings-account-deletion
        data-deletion-status={status}
        data-delete-after={deleteAfter}
      >
        <div class="lg-rowmain">
          <div class="lg-labelrow"><div class="lg-label">מחיקת חשבון</div></div>
          <div class="lg-hint" data-settings-deletion-copy>{deletionCopy}</div>
          <div class="lg-delbanner" data-settings-deletion-banner hidden={status !== 'scheduled'}>
            <div class="st-callout st-callout--warn">
              <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
              <div class="lg-delbanner__main">
                <strong>מחיקה מתוזמנת</strong>
                <div data-settings-deletion-date>
                  {deleteAfterLabel
                    ? `ניקוי הזהות יתחיל אחרי ${deleteAfterLabel}`
                    : 'ניקוי הזהות יתחיל אחרי תקופת ההמתנה.'}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="lg-rowend">
          <button
            ref={scheduleBtnRef}
            class="st-btn st-btn--danger"
            type="button"
            data-settings-action="schedule-account-deletion"
            hidden={status === 'scheduled' || status === 'completed'}
            onClick={openDeletionModal}
          >התחלת מחיקה</button>
          <button
            class="st-btn st-btn--warn"
            type="button"
            data-settings-action="cancel-account-deletion"
            hidden={status !== 'scheduled'}
            disabled={cancelBusy}
            onClick={handleCancelDeletion}
          >{cancelLabel}</button>
        </div>
      </div>

      {/* confirm: schedule account deletion */}
      <div
        class="st-overlay"
        data-settings-modal="account-deletion"
        hidden={!deletionModal}
        onClick={function (e) { if (e.target === e.currentTarget) closeDeletionModal(); }}
      >
        <div
          ref={deletionModalCardRef}
          class="st-overlay__card st-overlay__card--confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deletion-modal-title"
          onClick={function (e) { e.stopPropagation(); }}
        >
          <div class="st-confirm__ic st-confirm__ic--danger">
            <span class="material-symbols-outlined" aria-hidden="true">delete_forever</span>
          </div>
          <h3 id="deletion-modal-title" class="st-overlay__title">להתחיל מחיקת חשבון?</h3>
          <p class="st-overlay__sub">המסחר ייחסם מיד. במשך 14 ימים אפשר לבטל מהמסך הזה; לאחר מכן יתחיל ניקוי הזהות האוטומטי.</p>
          <label class="st-overlay__field">
            <span class="st-overlay__label">סיבה, לא חובה</span>
            <textarea
              ref={reasonRef}
              class="st-textarea st-overlay__textarea"
              maxlength="240"
              data-settings-delete-reason
              placeholder="אפשר להשאיר ריק"
              value={reasonText}
              onInput={function (e) { setReasonText(e.target.value); }}
            >{reasonText}</textarea>
          </label>
          <div class="st-overlay__actions st-overlay__actions--row">
            <button
              class="st-btn st-btn--sm st-btn--solid-danger"
              type="button"
              data-settings-confirm="account-deletion"
              disabled={confirmBusy}
              onClick={handleScheduleConfirm}
            >{confirmLabel}</button>
            <button class="st-overlay__cancel" type="button" data-settings-dismiss onClick={closeDeletionModal}>ביטול</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── root Settings island ──────────────────────────────────────────────────────

export default function Settings({
  // profile
  userInitial,
  profileDisplayName,
  profileHandle,
  profileBio,
  profileAvatarUrl,
  // email row
  emailDisplay,
  emailVerified,
  // sessions
  sessions,
  otherDevices,
  // notifications
  notificationPreferences,
  // account deletion
  accountDeletion,
}) {
  const SECTION_IDS = ['profile', 'account', 'notify', 'danger'];
  const DEFAULT_SECTION = 'profile';
  // Init FROM the URL at first render — never setState-after-mount, that
  // flashes the default section before snapping to the requested one.
  const [activePanel, setActivePanel] = useState(() => readParam('section', DEFAULT_SECTION, SECTION_IDS));

  function activate(section) {
    setActivePanel(section);
    writeParam('section', section, DEFAULT_SECTION);
  }

  const prefs = notificationPreferences || {};

  return (
    <div class="st-root lg-root" data-settings>
      <div class="lg-body">
        {/* ── nav ── */}
        <nav class="lg-nav" aria-label="ניווט הגדרות">
          <div class="lg-nav__eyebrow">הגדרות</div>
          <button
            class={`lg-navitem${activePanel === 'profile' ? ' is-on' : ''}`}
            type="button"
            data-settings-nav="profile"
            aria-current={activePanel === 'profile' ? 'page' : undefined}
            onClick={function () { activate('profile'); }}
          >
            <span class="material-symbols-outlined" aria-hidden="true">account_circle</span>
            <span>פרופיל</span>
          </button>
          <button
            class={`lg-navitem${activePanel === 'account' ? ' is-on' : ''}`}
            type="button"
            data-settings-nav="account"
            aria-current={activePanel === 'account' ? 'page' : undefined}
            onClick={function () { activate('account'); }}
          >
            <span class="material-symbols-outlined" aria-hidden="true">shield</span>
            <span>חשבון ואבטחה</span>
          </button>
          <button
            class={`lg-navitem${activePanel === 'notify' ? ' is-on' : ''}`}
            type="button"
            data-settings-nav="notify"
            aria-current={activePanel === 'notify' ? 'page' : undefined}
            onClick={function () { activate('notify'); }}
          >
            <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
            <span>התראות</span>
          </button>
          <button
            class={`lg-navitem lg-navitem--danger${activePanel === 'danger' ? ' is-on' : ''}`}
            type="button"
            data-settings-nav="danger"
            aria-current={activePanel === 'danger' ? 'page' : undefined}
            onClick={function () { activate('danger'); }}
          >
            <span class="material-symbols-outlined" aria-hidden="true">warning</span>
            <span>אזור מסוכן</span>
          </button>
        </nav>

        <div class="lg-content">
          {/* ───────── פרופיל ───────── */}
          <section
            class={`lg-panel${activePanel === 'profile' ? ' is-active' : ''}`}
            data-settings-panel="profile"
          >
            <header class="lg-head">
              <h1 class="lg-head__title">פרופיל</h1>
              <p class="lg-head__sub">כך תופיע למשתמשים אחרים בחוזה.</p>
            </header>

            <AvatarSection userInitial={userInitial} initialAvatarUrl={profileAvatarUrl} />
            <DisplayNameSection initialDisplayName={profileDisplayName} />
            <BioSection initialBio={profileBio} />

            {/* email row */}
            <div class="lg-row lg-row--inline">
              <div class="lg-rowmain">
                <div class="lg-labelrow">
                  <div class="lg-label">אימייל</div>
                  {emailVerified && (
                    <span class="st-badge">
                      <span class="material-symbols-outlined" aria-hidden="true">verified</span>מאומת
                    </span>
                  )}
                </div>
              </div>
              <div class="lg-rowend">
                <div class="lg-value" dir="ltr">{emailDisplay ?? '—'}</div>
              </div>
            </div>

            <SocialSection />
          </section>

          {/* ───────── חשבון ואבטחה ───────── */}
          <section
            class={`lg-panel${activePanel === 'account' ? ' is-active' : ''}`}
            data-settings-panel="account"
          >
            <header class="lg-head">
              <h1 class="lg-head__title">חשבון ואבטחה</h1>
              <p class="lg-head__sub">פרטי הכניסה והאמצעים שמגנים על החשבון.</p>
            </header>

            <HandleSection initialHandle={profileHandle} />

            {/* 2FA stub */}
            <div class="lg-row lg-row--inline">
              <div class="lg-rowmain">
                <div class="lg-labelrow"><div class="lg-label">אימות דו-שלבי</div><span class="lg-soon">בקרוב</span></div>
                <div class="lg-hint">שכבת הגנה נוספת בכל כניסה לחשבון.</div>
              </div>
              <div class="lg-rowend">
                <button class="st-toggle" type="button" role="switch" aria-checked="false" aria-label="אימות דו-שלבי" disabled>
                  <span class="st-toggle__dot" />
                </button>
              </div>
            </div>

            <SessionsSection initialSessions={sessions} initialOtherDevices={otherDevices} />
            <DataExportRow />
          </section>

          {/* ───────── התראות ───────── */}
          <section
            class={`lg-panel${activePanel === 'notify' ? ' is-active' : ''}`}
            data-settings-panel="notify"
          >
            <header class="lg-head">
              <h1 class="lg-head__title">התראות</h1>
              <p class="lg-head__sub">מה ומתי נעדכן אותך. בלי רעש מיותר.</p>
            </header>
            <div class="lg-notify">
              <div class="lg-notify__head">
                <div />
                <div class="lg-notify__col">
                  <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
                  <span>באפליקציה</span>
                </div>
                <div class="lg-notify__col">
                  <span class="material-symbols-outlined" aria-hidden="true">mail</span>
                  <span>חיצוני</span>
                </div>
              </div>
              <div class="lg-notify__row is-soon">
                <div class="lg-notify__main">
                  <div class="lg-labelrow"><div class="lg-label">תנועות שוק חדות</div><span class="lg-soon">בקרוב</span></div>
                  <div class="lg-hint">כשמחיר בשוק שאתה עוקב אחריו חוצה סף.</div>
                </div>
                <div class="lg-notify__cell">
                  <button class="st-toggle" type="button" role="switch" aria-checked="false" aria-label="בקרוב" disabled><span class="st-toggle__dot" /></button>
                </div>
                <div class="lg-notify__cell">
                  <button class="st-toggle" type="button" role="switch" aria-checked="false" aria-label="בקרוב" disabled><span class="st-toggle__dot" /></button>
                </div>
              </div>
              <div class="lg-notify__row">
                <div class="lg-notify__main">
                  <div class="lg-label">הכרעת שווקים</div>
                  <div class="lg-hint">כששוק שאתה מחזיק בו נסגר ומוכרע.</div>
                </div>
                <div class="lg-notify__cell">
                  <NotifyToggle prefKey="resolve_app" initialOn={!!prefs.resolve_app} />
                </div>
                <div class="lg-notify__cell">
                  <NotifyToggle prefKey="resolve_ext" initialOn={!!prefs.resolve_ext} />
                </div>
              </div>
              <div class="lg-notify__row">
                <div class="lg-notify__main">
                  <div class="lg-label">תגובות ואזכורים</div>
                  <div class="lg-hint">תגובות לפוזיציות שלך ואזכורים בדיון.</div>
                </div>
                <div class="lg-notify__cell">
                  <NotifyToggle prefKey="comments_app" initialOn={!!prefs.comments_app} />
                </div>
                <div class="lg-notify__cell">
                  <NotifyToggle prefKey="comments_ext" initialOn={!!prefs.comments_ext} />
                </div>
              </div>
            </div>
          </section>

          {/* ───────── אזור מסוכן ───────── */}
          <section
            class={`lg-panel${activePanel === 'danger' ? ' is-active' : ''}`}
            data-settings-panel="danger"
          >
            <header class="lg-head">
              <h1 class="lg-head__title">אזור מסוכן</h1>
              <p class="lg-head__sub">פעולות בלתי הפיכות. בזהירות.</p>
            </header>
            <DeletionSection initialDeletion={accountDeletion?.deletion} />
          </section>
        </div>
      </div>
    </div>
  );
}
