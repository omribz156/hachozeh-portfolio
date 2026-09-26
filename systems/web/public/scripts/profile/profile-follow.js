/* ============================================================
   Public profile — Follow / unfollow (vanilla island)
   Wires the [data-follow-btn] on /u/:id to:
     • POST   /api/social/users/:id/follow   → { following:true, followerCount }
     • DELETE /api/social/users/:id/follow    → { following:false, followerCount }
   Optimistic toggle (label/icon/state + the rail's עוקבים count), reverts on error.
   Guests are sent to the login overlay instead of calling the API.
   ============================================================ */
(function () {
  "use strict";
  var btn = document.querySelector("[data-follow-btn]");
  if (!btn) return;

  var userId = btn.getAttribute("data-user-id") || "";
  var labelEl = btn.querySelector("[data-follow-label]");
  var countEl = document.querySelector("[data-follower-count]");
  var countItemEl = document.querySelector("[data-follower-item]"); // only present in the below-floor markup
  var statusEl = document.querySelector("[data-follow-status]");
  var busy = false;
  var statusTimer = null;

  // Cold-start floor (audit 1.3, ProfileDossier.astro PROFILE_COUNT_FLOOR): below 5
  // followers the dossier hides the count and shows a recency line instead. A follow
  // click can cross that line live (4 -> 5). Simplest correct choice: reveal the count
  // the moment it reaches the floor, same threshold as SSR, no page reload needed. We
  // don't hide it again on unfollow below the floor within the same view — flipping a
  // real number back into a stub reads as broken, not honest.
  var FOLLOWER_FLOOR = 5;

  function showStatus(msg) {
    if (!statusEl) return;
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    statusEl.textContent = msg;
    statusEl.classList.add("is-shown");
    statusTimer = setTimeout(function () {
      statusEl.classList.remove("is-shown");
      statusTimer = null;
    }, 4000);
  }

  function backendBase() {
    var s = window.NaviAuthSession;
    return (s && typeof s.getBackendBaseUrl === "function" && s.getBackendBaseUrl()) || "";
  }
  function isAuthed() {
    return btn.getAttribute("data-viewer-authed") === "true";
  }
  function compact(n) {
    if (!isFinite(n)) return "—";
    return n >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : String(n);
  }

  function paint(following) {
    btn.classList.toggle("is-following", following);
    btn.setAttribute("data-following", following ? "true" : "false");
    btn.setAttribute("aria-pressed", following ? "true" : "false");
    if (labelEl) labelEl.textContent = following ? "עוקב" : "עקוב";
    // check icon only while following
    var icon = btn.querySelector("[data-follow-icon]");
    if (following && !icon) {
      icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.setAttribute("data-follow-icon", "");
      icon.textContent = "check";
      btn.insertBefore(icon, labelEl);
    } else if (!following && icon) {
      icon.remove();
    }
  }

  function openLogin() {
    if (window.NaviOverlays && typeof window.NaviOverlays.open === "function") {
      window.NaviOverlays.open("login");
    } else {
      window.location.href = "/?overlay=login";
    }
  }

  btn.addEventListener("click", async function () {
    if (busy) return;
    if (!isAuthed()) { openLogin(); return; }
    if (!userId) return;

    var wasFollowing = btn.getAttribute("data-following") === "true";
    var next = !wasFollowing;
    busy = true;
    btn.disabled = true;
    paint(next); // optimistic

    try {
      var res = await fetch(backendBase() + "/api/social/users/" + encodeURIComponent(userId) + "/follow", {
        method: next ? "POST" : "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}", // endpoint requires a JSON body even though it carries no fields
      });
      if (!res.ok) throw new Error("follow");
      var data = await res.json().catch(function () { return null; });
      if (data && typeof data.following === "boolean") paint(data.following);
      if (data && countEl && data.followerCount != null) {
        var newCount = Number(data.followerCount);
        countEl.textContent = compact(newCount);
        if (countItemEl && countItemEl.hidden && newCount >= FOLLOWER_FLOOR) {
          countItemEl.hidden = false;
        }
      }
    } catch (e) {
      paint(wasFollowing); // revert
      showStatus("החיבור נכשל. נסו שוב.");
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
})();
