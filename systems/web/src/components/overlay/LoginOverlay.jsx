// LoginOverlay.jsx — email + Google login.

import { useState } from 'preact/hooks';
import OverlayFrame from './OverlayFrame.jsx';
import BrandMark from './BrandMark.jsx';
import GoogleButton from './GoogleButton.jsx';
import EmailChallenge from './EmailChallenge.jsx';
import AuthFooterLinks from './AuthFooterLinks.jsx';

export default function LoginOverlay({ authState, onClose, onSubmit, onGoogleClick, onOpenOverlay, emailEnabled = false, turnstileSiteKey = '' }) {
  const [email, setEmail] = useState(authState.identifier || '');
  const [token, setToken] = useState('');
  const canSubmit = emailEnabled && email.trim().length > 0 && (!turnstileSiteKey || Boolean(token));
  const errorBanner = authState.errorMessage && authState.retryOverlay === 'login'
    ? <div class="navi-overlay-error-banner" role="alert">{authState.errorMessage}</div>
    : null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit('login', email.trim(), token);
  }

  return (
    <OverlayFrame onClose={onClose}>
      <BrandMark />
      <h1 id="navi-overlay-title" class="navi-overlay-title">ברוך הבא חזרה</h1>
      <p class="navi-overlay-subtitle">התחבר כדי להמשיך לקרוא את השוק.</p>
      <GoogleButton label="המשך עם Google" onClick={onGoogleClick} />
      <p class="navi-overlay-subtitle">הכניסה זמינה לכתובות Gmail בלבד.</p>
      {!emailEnabled && <p class="navi-overlay-subtitle">הכניסה באימייל אינה זמינה זמנית.</p>}
      {emailEnabled && <div class="navi-overlay-divider"><span>או</span></div>}
      {errorBanner}
      {emailEnabled && <form data-overlay-submit="login" onSubmit={handleSubmit}>
        <div class="navi-overlay-field">
          <input
            id="navi-login-email"
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
        {turnstileSiteKey && <EmailChallenge siteKey={turnstileSiteKey} onToken={setToken} />}
      </form>}
      <p class="navi-overlay-switch">
        אין לך חשבון?{' '}
        <button type="button" data-overlay-open="signup" onClick={() => onOpenOverlay('signup')}>פתח חשבון</button>
      </p>
      <AuthFooterLinks />
    </OverlayFrame>
  );
}
