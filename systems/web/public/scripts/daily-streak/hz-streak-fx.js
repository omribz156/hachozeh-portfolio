/* hz-streak-fx.js — particle engine for the daily-streak overlay.
   Fireworks (radial spark burst, on open) + confetti (directional, on claim).
   Warm Hachozeh palette. Honors prefers-reduced-motion at the call sites.
   Exposes window.HZStreakFX. No dependencies. */
(function () {
  "use strict";

  var COLORS = {
    amber: "#e8b257", amberStrong: "#f5c771",
    mint: "#5dd39e", info: "#7aaee6",
    white: "#f6f4ef", rose: "#e77a8a"
  };

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function fit(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, ctx: ctx };
  }

  function engine(canvas) {
    if (canvas.__fx) return canvas.__fx;
    var parts = [], raf = null, dims = fit(canvas);
    function ensure() { dims = fit(canvas); }

    function frame() {
      var ctx = dims.ctx, w = dims.w, h = dims.h;
      ctx.clearRect(0, 0, w, h);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx; p.y += p.vy; p.life -= 1;
        var t = Math.max(0, p.life / p.max);
        if (p.type === "spark") {
          ctx.globalAlpha = t; ctx.fillStyle = p.color;
          ctx.shadowBlur = 11; ctx.shadowColor = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          p.rot += p.vr; ctx.globalAlpha = Math.min(1, t * 1.5);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        if (p.life <= 0 || p.y > h + 60) parts.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(frame) : null;
    }
    function start() { if (!raf) { ensure(); raf = requestAnimationFrame(frame); } }

    var api = {
      burst: function (x, y, opts) {
        opts = opts || {}; ensure();
        var n = opts.count || 44;
        var pal = opts.palette || [COLORS.amber, COLORS.amberStrong, COLORS.white, COLORS.mint];
        var speed = opts.speed || 4.4;
        for (var i = 0; i < n; i++) {
          var a = (Math.PI * 2) * (i / n) + Math.random() * 0.35;
          var sp = speed * (0.45 + Math.random() * 0.75);
          parts.push({ type: "spark", x: x, y: y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
            g: 0.05, drag: 0.965, r: 1.5 + Math.random() * 2.4,
            color: pal[(Math.random() * pal.length) | 0],
            life: 52 + Math.random() * 34, max: 86 });
        }
        start();
      },
      confetti: function (x, y, opts) {
        opts = opts || {}; ensure();
        var n = opts.count || 72;
        var pal = opts.palette || [COLORS.amber, COLORS.amberStrong, COLORS.mint, COLORS.info, COLORS.white];
        var spread = opts.spread || 1.7, power = opts.power || 1;
        var center = (opts.angle == null) ? -Math.PI / 2 : opts.angle;
        var hvel = opts.hvel || 0.65;
        for (var i = 0; i < n; i++) {
          var a = center + (Math.random() - 0.5) * spread;
          var sp = (3 + Math.random() * 6.5) * power;
          parts.push({ type: "conf",
            x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10,
            vx: Math.cos(a) * sp * hvel, vy: Math.sin(a) * sp,
            g: 0.16, drag: 0.992,
            w: 4 + Math.random() * 4, h: 6 + Math.random() * 8,
            rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.42,
            color: pal[(Math.random() * pal.length) | 0],
            life: 90 + Math.random() * 55, max: 145 });
        }
        start();
      },
      clear: function () { parts.length = 0; }
    };

    canvas.__fx = api;
    window.addEventListener("resize", function () { if (raf) ensure(); });
    return api;
  }

  function countUp(el, from, to, dur, fmt) {
    fmt = fmt || function (v) { return Math.round(v).toLocaleString("en-US"); };
    if (prefersReduced()) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  window.HZStreakFX = { engine: engine, countUp: countUp, COLORS: COLORS, prefersReduced: prefersReduced };
})();
