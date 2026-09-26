// OtpOverlay.jsx — 6-box OTP input. The code is always a 6-digit numeric OTP
// (prod issues 6 digits; the dev code is enforced 6-digit in env.ts), so there is
// a single input path — no dual-mode / single-box fallback.

import { useEffect, useRef } from 'preact/hooks';
import OverlayFrame from './OverlayFrame.jsx';
import BrandMark from './BrandMark.jsx';
import { sanitizeOtpCode, isValidOtpCode, shouldSuppressDevOtp } from './overlay-logic.js';

// Wire the 6 split-box inputs after mount (same logic as wireOverlayDom).
function useOtpBoxWiring(formRef, onAutosubmit) {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const boxes  = form.querySelectorAll('[data-otp-box]');
    const hidden = form.querySelector('[data-otp-code]');

    if (!boxes.length || !hidden) return;

    const readAll = () =>
      Array.from(boxes)
        .map((b) => sanitizeOtpCode(b.value).slice(0, 1))
        .join('');

    const writeHidden = () => { hidden.value = readAll(); };

    const reflectFilled = () =>
      boxes.forEach((b) => {
        b.dataset.hasValue = b.value ? 'true' : 'false';
      });

    const tryAutosubmit = () => {
      const code = readAll();
      if (code.length === 6 && isValidOtpCode(code)) {
        form.requestSubmit?.();
      }
    };

    const handlers = [];

    boxes.forEach((box, i) => {
      function onInput() {
        const v = sanitizeOtpCode(box.value).slice(-1);
        box.value = v;
        reflectFilled();
        writeHidden();
        if (v && i < boxes.length - 1) boxes[i + 1].focus();
        if (i === boxes.length - 1) setTimeout(tryAutosubmit, 50);
      }

      function onKeyDown(e) {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          e.preventDefault();
          boxes[i - 1].focus();
          boxes[i - 1].value = '';
          reflectFilled();
          writeHidden();
        } else if (e.key === 'ArrowLeft' && i > 0) {
          boxes[i - 1].focus();
        } else if (e.key === 'ArrowRight' && i < boxes.length - 1) {
          boxes[i + 1].focus();
        }
      }

      box.addEventListener('input', onInput);
      box.addEventListener('keydown', onKeyDown);
      handlers.push(() => {
        box.removeEventListener('input', onInput);
        box.removeEventListener('keydown', onKeyDown);
      });
    });

    function onPaste(e) {
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, 6);
      if (!pasted) return;
      e.preventDefault();
      for (let i = 0; i < boxes.length; i++) {
        boxes[i].value = pasted[i] || '';
      }
      reflectFilled();
      writeHidden();
      boxes[Math.min(pasted.length, boxes.length - 1)].focus();
      if (pasted.length === 6) setTimeout(tryAutosubmit, 80);
    }

    boxes[0].addEventListener('paste', onPaste);
    handlers.push(() => boxes[0].removeEventListener('paste', onPaste));

    // Keyboard opening on focus can push the submit button below the visible
    // area even with the panel's own max-height/scroll (auth-overlays.css) —
    // nudge it into view. Cheap, no visualViewport needed (the panel handles
    // the actual clipping; this just centers the focused control within it).
    function onFocus() {
      const submit = form.querySelector('[type="submit"]');
      submit?.scrollIntoView({ block: 'nearest' });
    }
    boxes.forEach((box) => box.addEventListener('focus', onFocus));
    handlers.push(() => boxes.forEach((box) => box.removeEventListener('focus', onFocus)));

    setTimeout(() => boxes[0].focus(), 50);

    return () => handlers.forEach((fn) => fn());
  }); // re-run every render so we pick up any devCode mode switch
}

export default function OtpOverlay({ authState, onClose, onSubmit }) {
  const formRef = useRef(null);

  const visibleDevCode = shouldSuppressDevOtp() ? '' : (authState.devCode || '');
  const code = sanitizeOtpCode(authState.codeDraft || '');

  useOtpBoxWiring(formRef, null);

  const target = authState.identifier || 'name@example.com';

  const errorBanner = authState.errorMessage && authState.retryOverlay === 'otp'
    ? <div class="navi-overlay-error-banner" role="alert">{authState.errorMessage}</div>
    : null;

  const devHint = visibleDevCode
    ? (
      <p style="font-family:var(--hz-font-mono);font-size:11px;color:var(--hz-text-faint);text-align:center;margin:-8px 0 18px;">
        קוד מבחן: <span dir="ltr">{authState.devCode}</span>
      </p>
    )
    : null;

  function handleSubmit(e) {
    e.preventDefault();
    const hidden = e.currentTarget.querySelector('[data-otp-code]');
    const raw = sanitizeOtpCode(hidden?.value || '');
    onSubmit('otp', raw);
  }

  // Build the 6 split boxes.
  const digits = (code + '      ').slice(0, 6).split('');
  const splitBoxes = digits.map((digit, index) => {
    const val = sanitizeOtpCode(digit).trim();
    return (
      <input
        key={index}
        type="text"
        inputmode="numeric"
        autocomplete={index === 0 ? 'one-time-code' : 'off'}
        maxlength="1"
        class="navi-overlay-otp-box"
        data-otp-box={index}
        data-has-value={val ? 'true' : 'false'}
        value={val}
        aria-label={`ספרה ${index + 1}`}
      />
    );
  });

  const codeControl = (
    <>
      <fieldset style="border:0;padding:0;margin:0;">
        <legend class="sr-only">הזן קוד אימות בן 6 ספרות</legend>
        <div class="navi-overlay-otp">{splitBoxes}</div>
      </fieldset>
      <input type="hidden" data-otp-code value={sanitizeOtpCode(code)} />
    </>
  );

  return (
    <OverlayFrame onClose={onClose}>
      <BrandMark />
      <h1 id="navi-overlay-title" class="navi-overlay-title">אמת את הכתובת</h1>
      <p class="navi-overlay-subtitle">
        שלחנו קוד בן 6 ספרות אל<br />
        <span style="font-family:var(--hz-font-mono);font-weight:600;font-size:13px;color:var(--hz-text-soft);">{target}</span>
      </p>
      {devHint}
      {errorBanner}
      <form ref={formRef} data-overlay-submit="otp" onSubmit={handleSubmit}>
        {codeControl}
        <button type="submit" class="navi-overlay-primary">אמת והמשך</button>
      </form>
      <p class="navi-overlay-otp-resend">
        <button type="button" data-overlay-resend disabled>שלח שוב</button>
      </p>
    </OverlayFrame>
  );
}
