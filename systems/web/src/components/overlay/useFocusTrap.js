// useFocusTrap.js — Tab/Shift+Tab cycle within a dialog panel.
// Pass the ref of the panel element; the hook attaches and cleans up the listener.

import { useEffect } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function useFocusTrap(panelRef) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;

      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null); // visible only

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !panel.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  });
  // Re-run on every render so the focusable list is always fresh (e.g. OTP boxes
  // change count when switching dev-code mode). Matches the original wireFocusTrap
  // which re-ran on every renderOverlay() call.
}
