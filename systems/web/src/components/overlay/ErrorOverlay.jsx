// ErrorOverlay.jsx — auth error screen with back + retry.

import OverlayFrame from './OverlayFrame.jsx';

export default function ErrorOverlay({ authState, onClose, onOpenOverlay }) {
  const title       = authState.errorTitle   || 'האימות נכשל';
  const msg         = authState.errorMessage || 'נראה שמשהו השתבש. אנא נסה שוב.';
  const retryTarget = authState.retryOverlay || 'login';
  // back: if retrying otp, go to signup or login by purpose; else same as retry.
  const backTarget  = retryTarget === 'otp'
    ? (authState.purpose === 'signup' ? 'signup' : 'login')
    : retryTarget;

  return (
    <OverlayFrame onClose={onClose}>
      <div class="navi-overlay-error-head">
        <div class="navi-overlay-error-glyph">!</div>
        <h2 class="navi-overlay-error-title">{title}</h2>
      </div>
      <p class="navi-overlay-error-body">{msg}</p>
      <div class="navi-overlay-error-actions">
        <button
          type="button"
          data-overlay-open={backTarget}
          class="navi-overlay-secondary"
          onClick={() => onOpenOverlay(backTarget)}
        >
          חזור
        </button>
        <button
          type="button"
          data-overlay-open={retryTarget}
          class="navi-overlay-primary"
          onClick={() => onOpenOverlay(retryTarget)}
        >
          נסה שוב
        </button>
      </div>
    </OverlayFrame>
  );
}
