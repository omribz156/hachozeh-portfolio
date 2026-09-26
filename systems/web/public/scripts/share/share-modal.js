(function () {
  "use strict";

  if (window.HachozehShare?.__installed) return;

  function naviTrapTab(panel) {
    return function (e) {
      if (e.key !== 'Tab') return;
      var sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      var f = Array.prototype.filter.call(panel.querySelectorAll(sel), function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey) { if (document.activeElement === first || !panel.contains(document.activeElement)) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last || !panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); } }
    };
  }

  var state = {
    title: "",
    text: "",
    url: "",
    image: "",
    kind: "page",
  };
  var els = null;
  var _trap = null;
  var _opener = null;

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return "";
    }
  }

  function ensureModal() {
    if (els) {
      // ClientRouter's body swap detaches our appended root on a soft-nav, but `els`
      // still points to it — so a post-nav open() toggled an off-DOM node and the share
      // modal looked dead until a refresh. Re-attach the existing root (listeners intact).
      if (!els.root.isConnected) document.body.appendChild(els.root);
      return els;
    }

    var root = document.createElement("div");
    root.className = "hz-share-modal";
    root.dir = "rtl";
    root.innerHTML = [
      '<div class="hz-share-modal__backdrop" data-hz-share-close></div>',
      '<canvas class="hz-share-modal__fx" aria-hidden="true"></canvas>',
      '<section class="hz-share-modal__panel" role="dialog" aria-modal="true" aria-labelledby="hzShareTitle">',
      '  <header class="hz-share-modal__head">',
      '    <h2 class="hz-share-modal__title" id="hzShareTitle">שיתוף</h2>',
      '    <button class="hz-share-modal__close" type="button" aria-label="סגירה" data-hz-share-close><span class="material-symbols-outlined">close</span></button>',
      '  </header>',
      '  <div class="hz-share-modal__preview" data-hz-share-preview></div>',
      '  <div class="hz-share-modal__actions">',
      '    <button class="hz-share-modal__action" type="button" data-hz-share-copy-link><span class="material-symbols-outlined">link</span><span>העתק קישור</span></button>',
      '    <button class="hz-share-modal__action" type="button" data-hz-share-copy-image><span class="material-symbols-outlined">image</span><span>העתק תמונה</span></button>',
      '    <button class="hz-share-modal__action hz-share-modal__action--primary" type="button" data-hz-share-native><span class="material-symbols-outlined">ios_share</span><span>שתף</span></button>',
      '  </div>',
      '</section>',
    ].join("");
    document.body.appendChild(root);

    els = {
      root: root,
      title: root.querySelector("#hzShareTitle"),
      preview: root.querySelector("[data-hz-share-preview]"),
      fx: root.querySelector(".hz-share-modal__fx"),
      copyLink: root.querySelector("[data-hz-share-copy-link]"),
      copyImage: root.querySelector("[data-hz-share-copy-image]"),
      nativeShare: root.querySelector("[data-hz-share-native]"),
    };

    root.addEventListener("click", function (event) {
      if (event.target === root || event.target.closest("[data-hz-share-close]")) close();
    });
    els.copyLink.addEventListener("click", copyLink);
    els.copyImage.addEventListener("click", copyImage);
    els.nativeShare.addEventListener("click", nativeShare);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.classList.contains("is-open")) close();
    });

    return els;
  }

  function setButtonStatus(button, label, resetLabel) {
    var span = button.querySelector("span:last-child");
    if (!span) return;
    span.textContent = label;
    window.setTimeout(function () {
      span.textContent = resetLabel;
    }, 1500);
  }

  function openPanel() {
    var panel = els.root.querySelector(".hz-share-modal__panel");
    _opener = document.activeElement;
    _trap = naviTrapTab(panel);
    panel.addEventListener("keydown", _trap);
    els.root.classList.add("is-open");
    document.body.classList.add("overlay-open");
    els.copyLink.focus();
    if (state.kind === "claim") celebrateClaim();
  }

  // Decode the preview image OFF-DOM first, then insert it and raise the panel in the same
  // frame — so the picture and the overlay rise together instead of the image popping in a
  // beat after the panel. A hard cap keeps a slow / first-generation image from ever
  // blocking the panel (it rises anyway; the image fills in when it lands).
  function renderPreviewAndOpen() {
    var imageUrl = absoluteUrl(state.image);
    if (!imageUrl) {
      els.preview.innerHTML = '<div class="hz-share-modal__preview-fallback">אין תמונת שיתוף זמינה</div>';
      openPanel();
      return;
    }

    var img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    var done = false;
    var errored = false;
    var reveal = function () {
      if (done) return;
      done = true;
      if (errored) {
        els.preview.innerHTML = '<div class="hz-share-modal__preview-fallback">לא הצלחנו לטעון תצוגה מקדימה</div>';
      } else {
        els.preview.replaceChildren(img);
      }
      openPanel();
    };
    img.onerror = function () { errored = true; reveal(); };
    img.src = imageUrl;
    if (img.decode) {
      img.decode().then(reveal, function () { errored = true; reveal(); });
    } else {
      img.onload = reveal;
    }
    window.setTimeout(reveal, 220); // cap — rise anyway if the image is slow
  }

  // Every URL that leaves through the modal is source-tagged so a share landing
  // is distinguishable from an organic visit (read by the web middleware into
  // the hz_src attribution cookie). Canonical/og URLs stay clean — this touches
  // only what gets copied or handed to the share sheet.
  function withShareRef(url, kind) {
    if (!url) return url;
    try {
      var u = new URL(url);
      if (!u.searchParams.has("ref")) {
        u.searchParams.set("ref", "share");
        u.searchParams.set("k", kind || "page");
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  // One note per share action: analytics beacon (when configured) + the opener's
  // hook (e.g. win shares stamp share-consent on the first real action).
  function noteShareAction(action) {
    try {
      if (window.posthog && typeof window.posthog.capture === "function") {
        window.posthog.capture("share_action", { kind: state.kind, action: action });
      }
    } catch {}
    try {
      if (typeof state.onAction === "function") state.onAction(action);
    } catch {}
  }

  function open(options) {
    ensureModal();
    state = {
      title: options && options.title || document.title,
      text: options && options.text || "",
      url: withShareRef(absoluteUrl(options && options.url || window.location.href), options && options.kind || "page"),
      image: options && options.image || "",
      kind: options && options.kind || "page",
      onAction: options && options.onAction || null,
    };

    els.root.classList.toggle("hz-share-modal--claim", state.kind === "claim");
    els.root.classList.remove("is-celebrating");
    els.title.textContent =
      state.kind === "profile" ? "שתף פרופיל" :
      state.kind === "market" ? "שתף שוק" :
      state.kind === "claim" ? "שתף קריאה נכונה" :
      "שיתוף";
    renderPreviewAndOpen();
  }

  function close() {
    if (!els) return;
    var panel = els.root.querySelector(".hz-share-modal__panel");
    if (_trap && panel) { panel.removeEventListener("keydown", _trap); _trap = null; }
    els.root.classList.remove("is-open");
    els.root.classList.remove("hz-share-modal--claim", "is-celebrating");
    document.body.classList.remove("overlay-open");
    if (_opener && _opener.focus) { _opener.focus(); _opener = null; }
  }

  function celebrateClaim() {
    if (window.HZStreakFX?.prefersReduced?.()) return;

    window.requestAnimationFrame(function () {
      els.root.classList.remove("is-celebrating");
      void els.root.offsetWidth;
      els.root.classList.add("is-celebrating");

      if (!window.HZStreakFX?.engine || !els.fx) return;
      var rect = els.root.getBoundingClientRect();
      var fx = window.HZStreakFX.engine(els.fx);
      var palette = ["#ff4d8d", "#33c8ff", "#7ee35f", "#ffd34e", "#a855f7", "#ff8a3d"];
      var lanes = 13;
      var y = -18;
      for (var i = 0; i < lanes; i += 1) {
        fx.confetti((rect.width * (i + 0.5)) / lanes, y, {
          count: i % 2 ? 10 : 12,
          power: 0.42 + Math.random() * 0.12,
          angle: Math.PI / 2,
          spread: 0.38,
          hvel: 0.22,
          palette: palette,
        });
      }
      window.setTimeout(function () {
        for (var i = 0; i < lanes; i += 2) {
          fx.confetti((rect.width * (i + 0.5)) / lanes, y, {
            count: 6,
            power: 0.34 + Math.random() * 0.1,
            angle: Math.PI / 2,
            spread: 0.34,
            hvel: 0.18,
            palette: palette,
          });
        }
      }, 130);
      window.setTimeout(function () {
        els.root.classList.remove("is-celebrating");
      }, 720);
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(state.url);
      noteShareAction("copy_link");
      setButtonStatus(els.copyLink, "הועתק", "העתק קישור");
    } catch {
      setButtonStatus(els.copyLink, "נכשל", "העתק קישור");
    }
  }

  async function copyImage() {
    var imageUrl = absoluteUrl(state.image);
    if (!imageUrl || !window.ClipboardItem || !navigator.clipboard?.write) {
      await copyLink();
      setButtonStatus(els.copyImage, "הועתק קישור", "העתק תמונה");
      return;
    }

    try {
      var response = await fetch(imageUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error("image_fetch_failed");
      var blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      noteShareAction("copy_image");
      setButtonStatus(els.copyImage, "התמונה הועתקה", "העתק תמונה");
    } catch {
      await copyLink();
      setButtonStatus(els.copyImage, "הועתק קישור", "העתק תמונה");
    }
  }

  async function nativeShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: state.title, text: state.text, url: state.url });
        noteShareAction("native");
        close();
        return;
      }
      await copyLink();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setButtonStatus(els.nativeShare, "נכשל", "שתף");
    }
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-hz-share]");
    if (!trigger) return;
    event.preventDefault();
    open({
      kind: trigger.dataset.shareKind || trigger.dataset.hzShare || "page",
      title: trigger.dataset.shareTitle || document.title,
      text: trigger.dataset.shareText || "",
      url: trigger.dataset.shareUrl || window.location.href,
      image: trigger.dataset.shareImage || "",
    });
  });

  window.HachozehShare = { open: open, close: close, __installed: true };
})();
