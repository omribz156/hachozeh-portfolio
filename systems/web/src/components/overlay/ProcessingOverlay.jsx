// ProcessingOverlay.jsx — animated spinner while auth request is in flight.

import OverlayFrame from './OverlayFrame.jsx';

export default function ProcessingOverlay({ authState, onClose }) {
  // retryOverlay is 'otp' during the verify step and 'login'/'signup' during the
  // send-code step (both set before open('auth-processing')). We key off it, not
  // `purpose` — `purpose` only ever holds 'login'/'signup' (ErrorOverlay's back-target
  // depends on that), so `purpose === 'otp'` was always false → the verify label never showed.
  const label = authState.retryOverlay === 'otp' ? 'מאמת...' : 'שולח קוד...';

  return (
    <OverlayFrame onClose={onClose}>
      <div class="navi-overlay-processing">
        <div class="navi-overlay-breathing"></div>
        <h1 id="navi-overlay-title" class="navi-overlay-title" style="font-size:22px;">{label}</h1>
        <p class="navi-overlay-subtitle" style="margin:8px 0 28px;">כמה שניות.</p>
        <div class="navi-overlay-progress"><span></span></div>
      </div>
    </OverlayFrame>
  );
}
