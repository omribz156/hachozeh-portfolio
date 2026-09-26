// SignupOverlay.jsx — email + Google signup.

import { useState } from 'preact/hooks';
import OverlayFrame from './OverlayFrame.jsx';
import BrandMark from './BrandMark.jsx';
import GoogleButton from './GoogleButton.jsx';

export default function SignupOverlay({ authState, onClose, onSubmit, onGoogleClick, onOpenOverlay }) {
  const [email, setEmail] = useState(authState.identifier || '');
  const canSubmit = email.trim().length > 0;
  const errorBanner = authState.errorMessage && authState.retryOverlay === 'signup'
    ? <div class="navi-overlay-error-banner" role="alert">{authState.errorMessage}</div>
    : null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit('signup', email.trim());
  }

  return (
    <OverlayFrame onClose={onClose}>
      <BrandMark />
      <h1 id="navi-overlay-title" class="navi-overlay-title">פתח חשבון</h1>
      <p class="navi-overlay-subtitle">ניתוח שווקים מתחיל בפנים. דקה אחת.</p>
      <GoogleButton label="הרשם עם Google" onClick={onGoogleClick} />
      <div class="navi-overlay-divider"><span>או</span></div>
      {errorBanner}
      <form data-overlay-submit="signup" onSubmit={handleSubmit}>
        <div class="navi-overlay-field">
          <input
            id="navi-signup-email"
            type="email"
            autocomplete="email"
            aria-label="כתובת אימייל"
            class="navi-overlay-input"
            placeholder="כתובת אימייל"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
          <button type="submit" class="navi-overlay-continue" disabled={!canSubmit}>המשך</button>
        </div>
      </form>
      <p class="navi-overlay-legal">
        בלחיצה על המשך, אני מסכים ל<a href="/terms" target="_blank" rel="noopener noreferrer">תנאי השימוש</a>
        {' '}ול<a href="/privacy" target="_blank" rel="noopener noreferrer">מדיניות הפרטיות</a>, ומאשר שמלאו לי 18.
      </p>
      <p class="navi-overlay-switch">
        כבר יש לך חשבון?{' '}
        <button type="button" data-overlay-open="login" onClick={() => onOpenOverlay('login')}>התחבר</button>
      </p>
    </OverlayFrame>
  );
}
