// useDialog.js — dialog a11y bundle for Preact overlays/modals:
//   1. Tab / Shift+Tab focus trap (delegates to useFocusTrap)
//   2. Escape-to-close
//   3. return focus to the element that opened the dialog, on unmount
//
// Usage: give the panel a ref + role="dialog" aria-modal="true" aria-labelledby="…",
// then call useDialog(panelRef, onClose). No visual change — keyboard/SR behaviour only.
// (Background `inert` on the rest of the page is handled separately, paired with the
// #main-content anchor from the skip-link work.)

import { useEffect } from 'preact/hooks';
import useFocusTrap from './useFocusTrap.js';

export default function useDialog(panelRef, onClose) {
  useFocusTrap(panelRef);

  // Escape closes the dialog.
  useEffect(() => {
    if (typeof onClose !== 'function') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Restore focus to whatever was focused when the dialog opened (usually its trigger).
  useEffect(() => {
    const trigger = document.activeElement;
    return () => {
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);
}
