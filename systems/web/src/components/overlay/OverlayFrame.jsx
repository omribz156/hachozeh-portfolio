// OverlayFrame.jsx — backdrop + shell + section[role=dialog].
// Used by all auth overlays. Idea overlay uses its own ideaFrame markup
// (rendered inline in IdeaOverlay.jsx with class navi-overlay-panel--idea).

import { useRef } from 'preact/hooks';
import useDialog from './useDialog.js';

export default function OverlayFrame({ children, wide, onClose }) {
  const panelRef = useRef(null);
  useDialog(panelRef, onClose);

  const cls = wide
    ? 'navi-overlay-panel navi-overlay-panel--wide'
    : 'navi-overlay-panel';

  return (
    <>
      <div class="navi-overlay-backdrop" data-overlay-close onClick={onClose} aria-hidden="true" />
      <div class="navi-overlay-shell">
        <section ref={panelRef} class={cls} role="dialog" aria-modal="true" aria-labelledby="navi-overlay-title">
          {children}
        </section>
      </div>
    </>
  );
}
