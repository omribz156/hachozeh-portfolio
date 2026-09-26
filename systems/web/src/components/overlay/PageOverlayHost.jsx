// PageOverlayHost.jsx — Preact island (client:load). The AUTH CONTROL PLANE.
//
// Renders .navi-overlay-root[data-page-overlay-root] with data-active and
// data-overlay attributes (external CSS keys off these). When active, renders
// <OverlayFrame> containing the active overlay component, **keyed by overlay
// value** so Preact remounts on overlay-to-overlay transitions (entry animation
// runs) but reuses on same-overlay re-renders (no fade replay).

import { useCallback, useEffect } from 'preact/hooks';
import usePageOverlay from './usePageOverlay.js';
import {
  NAVI_PAGE_ROUTES,
  shouldSuppressDevOtp,
  canUseFakeAuth,
  sanitizeOtpCode,
  freshIdeaState,
  isValidOtpCode,
  shouldRedirectToHomeUser,
  buildPostAuthReturnTo,
} from './overlay-logic.js';

import LoginOverlay      from './LoginOverlay.jsx';
import SignupOverlay     from './SignupOverlay.jsx';
import OtpOverlay        from './OtpOverlay.jsx';
import ProcessingOverlay from './ProcessingOverlay.jsx';
import ErrorOverlay      from './ErrorOverlay.jsx';
import SuccessOverlay    from './SuccessOverlay.jsx';
import IdeaOverlay       from './IdeaOverlay.jsx';

export default function PageOverlayHost() {
  const {
    overlayValue,
    active,
    authState,
    setAuthState,
    ideaState,
    setIdeaState,
    open,
    close,
    goToPage,
    clearAuthFlowError,
    setAuthError,
  } = usePageOverlay();

  // ── Shared action: open with hamburger/cat-more side-effect ──────────────────
  const openOverlay = useCallback((value) => {
    clearAuthFlowError();
    // Close any open popovers (hamburger menu, category overflow) — same as
    // the [data-overlay-open] handler in the vanilla version.
    document
      .querySelectorAll('[data-hamburger-menu].is-open, [data-cat-more].is-open')
      .forEach((el) => el.classList.remove('is-open'));
    document
      .querySelectorAll('[data-hamburger-trigger]')
      .forEach((t) => t.setAttribute('aria-expanded', 'false'));
    open(value);
  }, [open, clearAuthFlowError]);

  // ── Document-level delegation for EXTERNAL triggers ──────────────────────────
  // [data-overlay-open]/[data-overlay-close] elements live OUTSIDE this island —
  // header login/signup CTAs, the trade-ticket restriction CTA, hamburger items.
  // The island handles document-level delegation for these triggers, or
  // <a href="?overlay=…"> triggers full-reload and <button> triggers do nothing.
  // In-overlay triggers use their own onClick, so skip the overlay subtree to
  // avoid double-firing. Guard modifier/non-primary clicks so cmd-click on an
  // anchor still opens a new tab.
  useEffect(() => {
    function onDocClick(e) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (e.target.closest('[data-page-overlay-root]')) return; // in-overlay → onClick
      const openEl = e.target.closest('[data-overlay-open]');
      if (openEl) {
        const value = openEl.getAttribute('data-overlay-open');
        if (value) { e.preventDefault(); openOverlay(value); return; }
      }
      const closeEl = e.target.closest('[data-overlay-close]');
      if (closeEl) { e.preventDefault(); close(); }
    }
    // CAPTURE phase (3rd arg = true): intercept overlay-open/close BEFORE Astro's
    // ClientRouter click handler (bubble phase) can soft-navigate a `?overlay=…` href.
    // Without this, an overlay-trigger like <a href="?overlay=idea" data-overlay-open="idea">
    // gets soft-nav'd (content re-render / "refresh" flash) instead of opening the overlay
    // in place. (The HIW link sidesteps it with href="#"; this fixes ALL overlay triggers
    // — idea, the guest login/signup CTAs, etc. — at the interception point.)
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [openOverlay, close]);

  // ── Google OAuth ─────────────────────────────────────────────────────────────
  const handleGoogleClick = useCallback(() => {
    clearAuthFlowError();
    const session = window.NaviAuthSession;

    if (!session?.isEnabled?.()) {
      const currentVal = overlayValue;
      setAuthState((prev) => ({
        ...prev,
        errorTitle:   'הכניסה לא זמינה',
        errorMessage: 'חיבור Google דורש שרת אימות חי.',
        retryOverlay: currentVal === 'signup' ? 'signup' : 'login',
      }));
      open('auth-error');
      return;
    }

    try {
      session.startGoogle(buildPostAuthReturnTo(window.location.href));
    } catch (error) {
      setAuthError(error, overlayValue === 'signup' ? 'signup' : 'login');
      open('auth-error');
    }
  }, [overlayValue, open, clearAuthFlowError, setAuthState, setAuthError]);

  // ── Form submit (login / signup / otp) ──────────────────────────────────────
  const handleSubmit = useCallback(async (action, value) => {
    const session = window.NaviAuthSession;

    if (!session?.isEnabled?.()) {
      if (!canUseFakeAuth()) {
        setAuthState((prev) => ({
          ...prev,
          errorTitle:   'הכניסה לבטא לא זמינה',
          errorMessage: 'הכניסה לבטא לא זמינה כרגע. נסה שוב בעוד רגע.',
          retryOverlay: action === 'signup' ? 'signup' : 'login',
        }));
        open('auth-error');
        return;
      }

      // Fake-auth paths (dev only, backend disabled).
      if (action === 'login') { open('auth-processing'); return; }
      if (action === 'signup') { open('otp'); return; }
      if (action === 'otp') {
        goToPage(NAVI_PAGE_ROUTES.homeUser, 'auth-success');
      }
      return;
    }

    clearAuthFlowError();

    if (action === 'login' || action === 'signup') {
      const identifier = String(value || '').trim();

      if (!identifier) {
        setAuthError('נא להזין כתובת אימייל.', action);
        // Stay on current overlay and let the error banner show.
        // (The vanilla version called renderOverlay() here — we just update state.)
        return;
      }

      setAuthState((prev) => ({
        ...prev,
        identifier,
        purpose:      action,
        retryOverlay: action,
      }));
      open('auth-processing');

      try {
        const payload = await session.start(identifier, action);
        const devCode = shouldSuppressDevOtp() ? '' : (payload.devCode || '');
        setAuthState((prev) => ({
          ...prev,
          challengeId:  payload.challengeId || '',
          devCode,
          codeDraft:    '',
          errorMessage: '',
          errorTitle:   '',
        }));
        open('otp');
      } catch (error) {
        setAuthError(error, action);
        open('auth-error');
      }

      return;
    }

    if (action === 'otp') {
      const code = sanitizeOtpCode(value || '');

      setAuthState((prev) => ({
        ...prev,
        codeDraft:    code,
        retryOverlay: 'otp',
      }));

      if (!isValidOtpCode(code)) {
        setAuthError('נא להזין קוד אימות תקין.', 'otp');
        return;
      }

      open('auth-processing');

      try {
        await session.verify(authState.challengeId, code);
        clearAuthFlowError();

        // Arm the one-shot How-It-Works walkthrough for new users.
        try {
          if (session.getState?.()?.lastAuthResult?.createdUser === true) {
            window.localStorage.setItem('navi_hiw_pending', '1');
          }
        } catch (_) {}

        if (shouldRedirectToHomeUser()) {
          goToPage(NAVI_PAGE_ROUTES.homeUser, '');
          return;
        }

        open('auth-success');
      } catch (error) {
        setAuthError(error, 'otp');
        open('auth-error');
      }
    }
  }, [authState.challengeId, open, goToPage, clearAuthFlowError, setAuthState, setAuthError]);

  // ── Idea actions ─────────────────────────────────────────────────────────────

  const handleIdeaTypeSwitch = useCallback((newType, draft) => {
    setIdeaState((prev) => ({ ...prev, type: newType, draft }));
  }, [setIdeaState]);

  const handleIdeaAgain = useCallback(() => {
    setIdeaState(freshIdeaState());
  }, [setIdeaState]);

  const handleIdeaSubmitSuccess = useCallback(() => {
    setIdeaState((prev) => ({ ...prev, sent: true }));
  }, [setIdeaState]);

  // ── Logout ────────────────────────────────────────────────────────────────────
  // This is wired via document-level delegation in the shell, but also exposed
  // on window for any surface that calls NaviOverlays. The shell uses its own
  // [data-auth-logout] handler — we don't duplicate it here.

  // ── Render ────────────────────────────────────────────────────────────────────

  // The overlay-root div always exists in the DOM (CSS depends on it);
  // the content is conditional on `active`.
  function renderOverlayContent() {
    if (!active) return null;

    // Key by overlayValue so Preact remounts on overlay→overlay transitions
    // (entry animation runs fresh) but reuses on same-overlay state updates.
    switch (overlayValue) {
      case 'login':
        return (
          <LoginOverlay
            key={overlayValue}
            authState={authState}
            onClose={close}
            onSubmit={handleSubmit}
            onGoogleClick={handleGoogleClick}
            onOpenOverlay={openOverlay}
          />
        );
      case 'signup':
        return (
          <SignupOverlay
            key={overlayValue}
            authState={authState}
            onClose={close}
            onSubmit={handleSubmit}
            onGoogleClick={handleGoogleClick}
            onOpenOverlay={openOverlay}
          />
        );
      case 'otp':
        return (
          <OtpOverlay
            key={overlayValue}
            authState={authState}
            onClose={close}
            onSubmit={handleSubmit}
          />
        );
      case 'auth-processing':
        return (
          <ProcessingOverlay
            key={overlayValue}
            authState={authState}
            onClose={close}
          />
        );
      case 'auth-error':
        return (
          <ErrorOverlay
            key={overlayValue}
            authState={authState}
            onClose={close}
            onOpenOverlay={openOverlay}
          />
        );
      case 'auth-success':
        return (
          <SuccessOverlay
            key={overlayValue}
            onClose={close}
          />
        );
      case 'idea':
        return (
          <IdeaOverlay
            key={overlayValue}
            ideaState={ideaState}
            onClose={close}
            onTypeSwitch={handleIdeaTypeSwitch}
            onAgain={handleIdeaAgain}
            onSubmit={handleIdeaSubmitSuccess}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      class="navi-overlay-root"
      data-page-overlay-root=""
      data-active={active ? 'true' : 'false'}
      data-overlay={active ? overlayValue : ''}
    >
      {renderOverlayContent()}
    </div>
  );
}
