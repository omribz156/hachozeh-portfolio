/* ============================================================
   Profile — owner edit overlay (vanilla island)
   Wires the ported edit overlay to the real owner write endpoints:
     • PATCH  /api/me/profile        { displayName, bio }
     • POST   /api/me/avatar         { imageData: <dataURL> }   (DELETE to reset)
     • PUT    /api/me/social-links    { x: <handle> | null }
   On success it updates the page in place (name/bio/avatar/X). Only changed
   fields are sent. The badge picker is intentionally absent — achievements has
   no backend yet (see finish-profile-integration.md).
   ============================================================ */
(function () {
  "use strict";

  var DEFAULT_AVATAR_URL = "/assets/brand/default-avatar-96.webp";

  function bindAvatarFallback(img) {
    if (!img || img.dataset.profileAvatarFallbackBound === "true") return;
    img.dataset.profileAvatarFallbackBound = "true";
    function useDefault() {
      if (img.dataset.profileDefaultAvatar === "true") return;
      img.dataset.profileDefaultAvatar = "true";
      img.removeAttribute("data-profile-avatar-photo");
      img.src = DEFAULT_AVATAR_URL;
    }
    img.addEventListener("error", useDefault, { once: true });
    if (img.complete && img.naturalWidth === 0) useDefault();
  }

  function wireAvatarFallback() {
    document.querySelectorAll("[data-profile-avatar-photo]").forEach(bindAvatarFallback);
  }

  // Guest-safe interactions (positions/record tabs, sort, search, share) must run
  // for EVERYONE — including non-owners, whose public profile has no #editOverlay.
  // The owner-only edit wiring below early-returns when the overlay is absent, so
  // these are wired up front (function declarations, hoisted) to keep that guard
  // from skipping them. Was a bug: guests had dead tabs/share. See public-profile.spec.mjs.
  wireProfileTables();
  wireShare();
  wireAvatarFallback();

  var overlay = document.getElementById("editOverlay");
  if (!overlay) return; // everything below is the owner-only edit overlay

  function backendBase() {
    var s = window.NaviAuthSession;
    return (s && typeof s.getBackendBaseUrl === "function" && s.getBackendBaseUrl()) || "";
  }
  function api(path, opts) {
    return fetch(backendBase() + path, Object.assign({ credentials: "include", headers: { "content-type": "application/json", accept: "application/json" } }, opts || {}));
  }
  // Reads {error:{code}} off a failed response without assuming a body exists.
  function errorCode(res) {
    return res.json().then(function (body) { return (body && body.error && body.error.code) || null; }).catch(function () { return null; });
  }

  var openBtn = document.getElementById("editProfileBtn");
  var saveBtn = document.getElementById("editSave");
  var errEl = document.getElementById("editError");
  var fName = document.getElementById("editName");
  var fBio = document.getElementById("editBio");
  var fX = document.getElementById("editX");
  var fBioCount = document.getElementById("editBioCount");
  var fAvatarInput = document.getElementById("editAvatarInput");
  var fAvatarReset = document.getElementById("editAvatarReset");
  var prevEl = document.getElementById("editAvatarPrev");

  // showcase-category picker (#7) — present only when the user has record categories
  var catBox = document.getElementById("editCats");
  var MAX_CATS = 3;
  function catInputs() { return catBox ? Array.prototype.slice.call(catBox.querySelectorAll('input[name="showcaseCat"]')) : []; }
  function checkedCats() { return catInputs().filter(function (i) { return i.checked; }).map(function (i) { return i.value; }); }
  // Once MAX_CATS are picked, grey out + lock the rest so you can't exceed.
  function enforceCatMax() {
    var n = checkedCats().length;
    catInputs().forEach(function (i) {
      var atCap = n >= MAX_CATS && !i.checked;
      i.disabled = atCap;
      var chip = i.closest(".edit-cat");
      if (chip) chip.classList.toggle("is-disabled", atCap);
    });
  }

  // live page targets
  var pageName = document.querySelector("[data-profile-name]");
  var pageBio = document.querySelector("[data-profile-bio]");
  var pageX = document.querySelector("[data-profile-x]");
  var pageAvatar = document.querySelector("[data-profile-avatar]");

  // Avatar rendering via DOM (no innerHTML string interpolation — src set as a
  // property, so a URL can never break out into markup).
  function setPhoto(container, url) {
    if (!container) return;
    var img = document.createElement("img");
    img.alt = ""; img.className = "avatar-photo"; img.dataset.profileAvatarPhoto = "true"; img.src = url;
    bindAvatarFallback(img);
    container.replaceChildren(img);
  }
  function setGlyph(container) {
    if (!container) return;
    var img = document.createElement("img");
    img.alt = ""; img.className = "avatar-glyph"; img.src = "/assets/brand/logo-glyph.svg";
    container.replaceChildren(img);
  }
  function cloneAvatarInto(target, source) {
    if (!target || !source) return;
    target.replaceChildren();
    Array.prototype.forEach.call(source.childNodes, function (n) { target.appendChild(n.cloneNode(true)); });
  }

  // pendingAvatar: null = unchanged · "" = reset to default · dataURL = new photo
  var pendingAvatar = null;
  var initial = {};
  var scrollHeld = false;
  var focusTimer = null;
  var closeTimer = null;

  function clearFocusTimer() {
    if (!focusTimer) return;
    window.clearTimeout(focusTimer);
    focusTimer = null;
  }

  function clearCloseTimer() {
    if (!closeTimer) return;
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }

  function shouldAutoFocusEditField() {
    try {
      if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return false;
    } catch (e) { /* old browsers: keep desktop behavior */ }
    return true;
  }

  function lockScroll() {
    if (scrollHeld) return;
    scrollHeld = true;
    window.NaviScrollLock?.lock?.();
  }

  // The profile editor is the only blocking surface on an owner profile. A
  // stale lock from an earlier overlay must not strand this page until Safari
  // is restarted, so exit always returns the page to a known-clean state.
  function releaseProfileScroll() {
    scrollHeld = false;
    if (window.NaviScrollLock?.releaseAll) window.NaviScrollLock.releaseAll();
    else document.body.classList.remove("overlay-open");
  }

  // Bio grows from one line: reset to auto, then lock to content height. Must run
  // while the modal is visible (scrollHeight is 0 on a hidden element).
  function autoGrowBio() {
    if (!fBio) return;
    fBio.style.height = "auto";
    fBio.style.height = fBio.scrollHeight + "px";
  }

  function openModal() {
    clearFocusTimer();
    clearCloseTimer();
    releaseProfileScroll();
    initial = { name: (fName.value || "").trim(), bio: fBio.value || "", x: (fX.value || "").trim(), cats: checkedCats().join(",") };
    pendingAvatar = null;
    cloneAvatarInto(prevEl, pageAvatar);
    fBioCount.textContent = String(fBio.value.length);
    setError("");
    overlay.hidden = false;
    lockScroll();
    autoGrowBio();
    enforceCatMax();
    document.addEventListener("keydown", onKey);
    if (shouldAutoFocusEditField()) {
      focusTimer = window.setTimeout(function () {
        focusTimer = null;
        if (!overlay.hidden) fName.focus();
      }, 30);
    }
  }
  function closeModal() {
    clearFocusTimer();
    clearCloseTimer();
    overlay.hidden = true;
    releaseProfileScroll();
    document.removeEventListener("keydown", onKey);
  }
  // On iOS, removing a scrim in the same tap can re-target the tail of that
  // gesture to a link behind it. Keep the scrim through the event, then close.
  function requestClose() {
    if (overlay.hidden || closeTimer) return;
    closeTimer = window.setTimeout(function () {
      closeTimer = null;
      closeModal();
    }, 0);
  }
  function onKey(e) { if (e.key === "Escape" && !overlay.hidden) closeModal(); }
  function setError(msg) {
    if (!errEl) return;
    if (msg) { errEl.textContent = msg; errEl.classList.add("is-shown"); }
    else errEl.classList.remove("is-shown");
  }

  // X handle from a pasted url/@handle/handle
  function xHandle(v) {
    v = (v || "").trim();
    if (!v) return "";
    var m = v.match(/(?:x\.com|twitter\.com)\/(@?[A-Za-z0-9_]+)/i);
    if (m) return m[1].replace(/^@/, "");
    return v.replace(/^@/, "");
  }

  async function save() {
    setError("");
    var name = (fName.value || "").trim();
    var bio = fBio.value || "";
    var x = (fX.value || "").trim();
    saveBtn.disabled = true;
    saveBtn.textContent = "שומר...";
    try {
      // 1) name / bio
      if (name !== initial.name || bio !== initial.bio) {
        var r1 = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: name || null, bio: bio || null }) });
        if (!r1.ok) {
          var code1 = await errorCode(r1);
          var err1 = new Error("profile");
          err1.code = code1;
          throw err1;
        }
      }
      // 2) avatar
      if (pendingAvatar === "") {
        var rd = await api("/api/me/avatar", { method: "DELETE" });
        if (!rd.ok) throw new Error("avatar");
        setGlyph(pageAvatar);
      } else if (pendingAvatar) {
        var ra = await api("/api/me/avatar", { method: "POST", body: JSON.stringify({ imageData: pendingAvatar }) });
        if (!ra.ok) throw new Error("avatar");
        var ad = await ra.json().catch(function () { return null; });
        var url = ad && ad.user && ad.user.avatarUrl;
        if (url) setPhoto(pageAvatar, url);
      }
      // 3) X social link
      if (x !== initial.x) {
        var handle = xHandle(x);
        var r3 = await api("/api/me/social-links", { method: "PUT", body: JSON.stringify({ x: handle || null }) });
        if (!r3.ok) throw new Error("social");
      }
      // 4) showcase categories (#7)
      var cats = checkedCats().join(",");
      var catsChanged = catBox && cats !== initial.cats;
      if (catsChanged) {
        var r4 = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify({ showcaseCategories: checkedCats() }) });
        if (!r4.ok) throw new Error("categories");
      }
      // reflect name/bio/X on the page
      if (pageName && name) pageName.textContent = name;
      if (pageBio) pageBio.textContent = bio;
      if (pageX) {
        var savedXHandle = xHandle(x);
        if (savedXHandle) { pageX.setAttribute("href", "https://x.com/" + savedXHandle); pageX.style.display = ""; }
        else { pageX.setAttribute("href", "#"); pageX.style.display = "none"; }
      }
      closeModal();
      // The rail breakdown is SSR-rendered from the chosen set, so reflect a
      // category change with a reload (text fields update in place above).
      if (catsChanged) window.location.reload();
    } catch (e) {
      if (e && e.code === "name_not_allowed") setError("השם הזה לא זמין. נסו שם אחר.");
      else setError("השמירה נכשלה. נסו שוב בעוד רגע.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "שמירת שינויים";
    }
  }

  // wiring
  if (openBtn) openBtn.addEventListener("click", openModal);
  // Keep every interaction inside the modal boundary. In particular, ClientRouter
  // listens on document for links; without this boundary a mobile tap near the
  // editor edge can still reach shell navigation behind the scrim.
  overlay.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
  overlay.addEventListener("click", function (event) {
    event.stopImmediatePropagation();
    if (event.target.closest("[data-close]")) {
      event.preventDefault();
      requestClose();
    }
  });
  document.addEventListener("astro:before-swap", function () { clearFocusTimer(); clearCloseTimer(); releaseProfileScroll(); });
  window.addEventListener("pagehide", function () { clearFocusTimer(); clearCloseTimer(); releaseProfileScroll(); });
  saveBtn.addEventListener("click", save);
  fBio.addEventListener("input", function () { fBioCount.textContent = String(fBio.value.length); autoGrowBio(); });
  if (catBox) catBox.addEventListener("change", enforceCatMax);
  // Downscale + center-crop to a 512×512 square (matching the server's cover resize) and
  // re-encode small in the BROWSER before upload — so the payload is ~tens of KB, not the
  // raw multi-MB photo. The backend still sanitizes (re-encodes + strips EXIF); this only
  // shrinks the upload so the route bodyLimit can stay tight.
  function resizeAvatarFile(file, done) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      try {
        var size = 512;
        var canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext("2d");
        var scale = Math.max(size / img.width, size / img.height); // cover
        var w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        var out = canvas.toDataURL("image/webp", 0.82);
        if (out.indexOf("data:image/webp") !== 0) out = canvas.toDataURL("image/jpeg", 0.85); // old browsers
        done(out);
      } catch (e) { done(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(null); };
    img.src = url;
  }
  fAvatarInput.addEventListener("change", function () {
    var file = fAvatarInput.files && fAvatarInput.files[0];
    if (!file) return;
    resizeAvatarFile(file, function (dataUrl) {
      if (!dataUrl) { setError("לא הצלחנו לעבד את התמונה. נסו תמונה אחרת."); return; }
      pendingAvatar = dataUrl;
      setPhoto(prevEl, pendingAvatar);
    });
  });
  fAvatarReset.addEventListener("click", function () {
    pendingAvatar = "";
    setGlyph(prevEl);
  });

  // share — native share or clipboard (guest-safe; called up top)
  function wireShare() {
    document.querySelectorAll("[data-profile-share]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (window.HachozehShare || el.hasAttribute("data-hz-share")) return;
        var url = window.location.origin + window.location.pathname; // canonical /<handle> (or /<id>)
        if (navigator.share) { navigator.share({ url: url }).catch(function () {}); }
        else if (navigator.clipboard) { navigator.clipboard.writeText(url).catch(function () {}); }
      });
    });
  }

  // ── positions / record tables: tabs + sort + search (ported from the drop) ──
  // Guest-safe; called up top so a missing owner overlay never skips the tabs.
  function wireProfileTables() {
    function applySearch(depth) {
      var input = depth.querySelector("[data-pf-search]");
      var q = (input && input.value || "").trim();
      var panel = depth.querySelector(".pf-tabpanel.is-active");
      if (!panel) return;
      panel.querySelectorAll(".pf-position-row, .pf-history-row").forEach(function (r) {
        r.style.display = (!q || r.textContent.indexOf(q) !== -1) ? "" : "none";
      });
    }
    // ?tab=positions|history — URL-addressable view state (default omitted from
    // the URL). Read once per script run; data-astro-rerun makes this script
    // re-execute fresh on every soft-nav, so no astro:page-load listener needed.
    var DEFAULT_TAB = "positions";
    var requestedTab = null;
    try {
      requestedTab = new URL(window.location.href).searchParams.get("tab");
    } catch (e) { /* non-browser — ignore */ }

    document.querySelectorAll(".pf-tablist").forEach(function (tablist) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll(".pf-tab[role='tab']"));

      function activateTab(tab, opts) {
        var id = tab.getAttribute("data-tab");
        var depth = tab.closest(".pf-depth");
        tabs.forEach(function (x) {
          x.classList.toggle("is-active", x === tab);
          x.setAttribute("aria-selected", x === tab ? "true" : "false");
        });
        depth.querySelectorAll(".pf-tabpanel").forEach(function (p) { p.classList.toggle("is-active", p.getAttribute("data-panel") === id); });
        applySearch(depth);
        if (opts && opts.userInitiated) {
          try {
            var url = new URL(window.location.href);
            if (id === DEFAULT_TAB) url.searchParams.delete("tab");
            else url.searchParams.set("tab", id);
            window.history.replaceState(null, "", url);
          } catch (e2) { /* swallow */ }
        }
      }

      tabs.forEach(function (t) {
        t.addEventListener("click", function () { activateTab(t, { userInitiated: true }); });
      });

      // Deep link: activate the requested tab if valid, synchronously before
      // first paint of this content — invalid/absent values fall back to the
      // server-rendered default silently (no URL write on init).
      if (requestedTab && requestedTab !== DEFAULT_TAB) {
        var match = tabs.filter(function (t) { return t.getAttribute("data-tab") === requestedTab; })[0];
        if (match) activateTab(match);
      }

      // Arrow-key nav on the tablist (RTL: ArrowLeft = next, ArrowRight = prev)
      tablist.addEventListener("keydown", function (e) {
        var idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        var next = idx;
        if (e.key === "ArrowLeft")  { next = (idx + 1) % tabs.length; }
        else if (e.key === "ArrowRight") { next = (idx - 1 + tabs.length) % tabs.length; }
        else if (e.key === "Home")  { next = 0; }
        else if (e.key === "End")   { next = tabs.length - 1; }
        else { return; }
        e.preventDefault();
        tabs[next].focus();
        activateTab(tabs[next], { userInitiated: true });
      });
    });
    document.querySelectorAll("[data-pf-search]").forEach(function (inp) {
      inp.addEventListener("input", function () { applySearch(inp.closest(".pf-depth")); });
    });
    document.querySelectorAll("[data-sort-table]").forEach(function (tbl) {
      var list = tbl.querySelector(".pf-positions-list, .pf-history-list");
      if (!list) return;
      var headers = tbl.querySelectorAll(".pf-position-header");
      headers.forEach(function (h) {
        h.addEventListener("click", function () {
          var key = h.getAttribute("data-sort");
          var def = h.getAttribute("data-default") || "desc";
          var dir = h.classList.contains("is-active") ? (h.getAttribute("data-dir") === "asc" ? "desc" : "asc") : def;
          headers.forEach(function (x) {
            var ic = x.querySelector(".pf-sort-icon");
            if (x === h) { x.classList.add("is-active"); x.setAttribute("data-dir", dir); if (ic) { ic.textContent = dir === "asc" ? "▲" : "▼"; ic.classList.add("pf-sort-icon--active"); } }
            else { x.classList.remove("is-active"); x.removeAttribute("data-dir"); if (ic) { ic.textContent = "⇅"; ic.classList.remove("pf-sort-icon--active"); } }
          });
          var rows = Array.prototype.slice.call(list.children);
          rows.sort(function (a, b) {
            var va = a.getAttribute("data-" + key), vb = b.getAttribute("data-" + key);
            var na = parseFloat(va), nb = parseFloat(vb), cmp;
            if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
            else cmp = String(va).localeCompare(String(vb), "he");
            return dir === "asc" ? cmp : -cmp;
          });
          rows.forEach(function (r) { list.appendChild(r); });
        });
      });
    });
  }
})();
