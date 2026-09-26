// SuccessOverlay.jsx — auth-success screen (auto-closes after 1700ms via usePageOverlay).

import OverlayFrame from './OverlayFrame.jsx';
import { formatNumber } from './overlay-logic.js';
import { VShekelSymbol } from '../currency/VShekel.jsx';

export default function SuccessOverlay({ onClose }) {
  const authResult    = window.NaviAuthSession?.getState?.()?.lastAuthResult || null;
  const isNewUser     = authResult?.createdUser === true;
  const starterGrant  = authResult?.starterGrantAmount || '1000';
  const grantLabel    = formatNumber(Number.parseFloat(starterGrant) || 1000);

  const title    = isNewUser ? 'אתה בפנים.'    : 'חזרת לחזית.';
  const subtitle = isNewUser ? 'פותח את החזית...' : 'ממשיך מהמקום שעצרת...';

  const grant = isNewUser
    ? (
      <div class="navi-overlay-grant">
        <span class="navi-overlay-grant-label">תיק תרגול</span>
        <span class="navi-overlay-grant-unit"><VShekelSymbol /></span>
        <span class="navi-overlay-grant-value">{grantLabel}</span>
      </div>
    )
    : null;

  return (
    <OverlayFrame onClose={onClose}>
      <div class="navi-overlay-success">
        <h1 class="navi-overlay-success-title">{title}</h1>
        <p class="navi-overlay-subtitle" style={`margin:0 0 ${isNewUser ? '28' : '20'}px;`}>{subtitle}</p>
        {grant}
        <div class="navi-overlay-progress" style={`margin-top:${isNewUser ? '32' : '24'}px;`}>
          <span style="animation-duration:1.6s;"></span>
        </div>
      </div>
    </OverlayFrame>
  );
}
