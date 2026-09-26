// live-pulse.js — the shared "value changed" cue used by every live surface.
//   window.HzLive.set(el, nextText, prevNum, nextNum)
//     sets el's text and pulses it green/red ONLY if the text actually changed and a
//     numeric direction can be derived. No change → no motion.
//   window.HzLive.flash(el, 'up'|'down')  — pulse without touching text.
// Loaded once in Layout (before islands), so vanilla inline scripts and Preact islands
// share one implementation.
(function () {
  if (window.HzLive && window.HzLive.__installed) return;

  function flash(el, dir) {
    if (!el || (dir !== 'up' && dir !== 'down')) return;
    var cls = dir === 'up' ? 'hz-live-flash--up' : 'hz-live-flash--down';
    el.classList.remove('hz-live-flash--up', 'hz-live-flash--down');
    // force reflow so re-adding the class restarts the animation on rapid changes
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(function () { el.classList.remove(cls); }, 650);
  }

  function set(el, nextText, prevNum, nextNum) {
    if (!el) return;
    var next = String(nextText);
    var changed = String(el.textContent).trim() !== next.trim();
    el.textContent = next;
    if (!changed) return;
    var dir = null;
    if (typeof prevNum === 'number' && typeof nextNum === 'number' && prevNum !== nextNum) {
      dir = nextNum > prevNum ? 'up' : 'down';
    }
    flash(el, dir);
  }

  window.HzLive = { set: set, flash: flash, __installed: true };
})();
