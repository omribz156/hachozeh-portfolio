// graphs-accuracy-charts.js — hand-built SVG chart builders for /graphs-and-accuracy.
// Ported from systems/design/to integrate/graphs-and-accuracy/dist/shared.jsx.
// Each builder returns an HTML string (rendered via set:html in the .astro).
//
// Adaptations from the prototype, for the live app:
//  - charts use a fixed internal viewBox and render at width:100% so they scale
//    down on narrow viewports (the prototype used fixed pixel widths);
//  - axis/point labels live INSIDE the SVG as <text> (the prototype positioned
//    some as absolute HTML), so each chart scales as one unit;
//  - colors are platform tokens (--hz-*) instead of hardcoded hex.
//
// SVGs are forced direction:ltr so numeric axes lay out correctly inside the
// RTL page (kept from the prototype).

const C = {
  ink: 'var(--hz-text)',
  soft: 'var(--hz-text-soft)',
  muted: 'var(--hz-text-muted)',
  faint: 'var(--hz-text-faint)',
  brand: 'var(--hz-brand)',
  brandStrong: 'var(--hz-brand-strong)',
  info: 'var(--hz-info)',
  signalNew: 'var(--hz-signal-new)',
  buy: 'var(--hz-action-buy)',
  sell: 'var(--hz-action-sell)',
  bg: 'var(--hz-bg)',
  borderFaint: 'var(--hz-border-faint)',
  borderSoft: 'var(--hz-border-soft)',
};
const MONO = 'var(--hz-font-mono)';

// Chart markup crosses an HTML injection boundary; labels remain text and every
// numeric interpolation must be finite even if an upstream payload is malformed.
const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const dimension = (value, fallback) => Math.max(1, Math.min(10000, finiteNumber(value, fallback)));

function smoothPath(pts, t = 0.18) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}
const lerp = (a, b, t) => a + (b - a) * t;
const svgOpen = (w, h) =>
  `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto;overflow:visible;direction:ltr" role="img">`;

// ── §00 hero arc gauge ──────────────────────────────────────────────────────
export function arcGauge(value = 92, size = 216) {
  value = Math.max(0, Math.min(100, finiteNumber(value)));
  size = dimension(size, 216);
  const sw = 14;
  const r = (size - sw) / 2;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arcPath = (fromDeg, toDeg) => {
    const a = toXY(fromDeg), b = toXY(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
  };
  const endDeg = start + (sweep * value) / 100;
  return `
    <svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" class="ga-gauge" role="img" aria-label="דיוק מצטבר ${value} אחוז" style="display:block;width:100%;height:auto;direction:ltr">
      <defs>
        <linearGradient id="ga-gauge-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${C.brand}" />
          <stop offset="100%" stop-color="${C.brandStrong}" />
        </linearGradient>
      </defs>
      <path d="${arcPath(start, start + sweep)}" fill="none" stroke="rgba(255,248,232,0.08)" stroke-width="${sw}" stroke-linecap="round" />
      <path d="${arcPath(start, endDeg)}" fill="none" stroke="url(#ga-gauge-grad)" stroke-width="${sw}" stroke-linecap="round" />
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${C.ink}" font-family="${MONO}" font-weight="800" font-size="${size * 0.3}" letter-spacing="-0.02em">${value}<tspan font-size="${size * 0.13}" fill="${C.brand}">%</tspan></text>
      <text x="${cx}" y="${cy + size * 0.18}" text-anchor="middle" fill="${C.muted}" font-size="12" font-weight="600">דיוק מצטבר</text>
    </svg>`;
}

// ── §01 accuracy before close (line) ────────────────────────────────────────
export function accuracyLine(pts, width = 900, height = 300) {
  width = dimension(width, 900);
  height = dimension(height, 300);
  pts = pts.map(p => ({ value: finiteNumber(p.value), label: escapeText(p.label), sub: escapeText(p.sub) }));
  if (pts.length === 0) return chartEmpty(height);
  const padX = 30, padR = 30, padTop = 36, padBottom = 64;
  const plotW = width - padX - padR;
  const plotH = height - padTop - padBottom;
  const min = 70, max = 95;
  // Single-point series: (pts.length - 1) denominators below go to 0/0 → NaN
  // geometry. A first-ever resolved market has exactly one point, so render a
  // labeled dot centered on the plot instead of a degenerate line/area.
  if (pts.length === 1) {
    const p = pts[0];
    const cx = padX + plotW / 2;
    const cy = padTop + (1 - (p.value - min) / (max - min)) * plotH;
    return `
      ${svgOpen(width, height)}
        <circle class="ga-dot" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="5.5" fill="${C.bg}" stroke="${C.brand}" stroke-width="2.5" />
        <text x="${cx.toFixed(2)}" y="${(cy - 14).toFixed(2)}" text-anchor="middle" fill="${C.ink}" font-size="13" font-weight="700" font-family="${MONO}">${p.value.toFixed(1)}%</text>
        <text x="${cx.toFixed(2)}" y="${height - 34}" text-anchor="middle" fill="${C.soft}" font-size="13" font-weight="700">${p.label}</text>
        <text x="${cx.toFixed(2)}" y="${height - 18}" text-anchor="middle" fill="${C.faint}" font-size="10.5">${p.sub}</text>
      </svg>`;
  }
  const xs = pts.map((_, i) => padX + (plotW * (pts.length - 1 - i)) / (pts.length - 1));
  const seps = xs.slice(0, -1).map((x, i) => (x + xs[i + 1]) / 2);
  const ys = pts.map((p) => padTop + (1 - (p.value - min) / (max - min)) * plotH);
  const nodes = xs.map((x, i) => ({ x, y: ys[i] }));
  const line = smoothPath(nodes);
  const baseY = padTop + plotH;
  const area = `${line} L${xs[xs.length - 1].toFixed(2)},${baseY.toFixed(2)} L${xs[0].toFixed(2)},${baseY.toFixed(2)} Z`;
  return `
    ${svgOpen(width, height)}
      <defs>
        <linearGradient id="ga-acc-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${C.brand}" stop-opacity="0.16" />
          <stop offset="100%" stop-color="${C.brand}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${seps.map((x) => `<line x1="${x.toFixed(2)}" y1="${padTop - 6}" x2="${x.toFixed(2)}" y2="${baseY}" stroke="${C.borderFaint}" stroke-width="1" />`).join('')}
      <path d="${area}" fill="url(#ga-acc-grad)" />
      <path d="${line}" fill="none" stroke="${C.brand}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${nodes.map((n, i) => `
        <circle class="ga-dot" cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="5.5" fill="${C.bg}" stroke="${C.brand}" stroke-width="2.5" />
        <text x="${n.x.toFixed(2)}" y="${(n.y - 14).toFixed(2)}" text-anchor="middle" fill="${C.ink}" font-size="13" font-weight="700" font-family="${MONO}">${pts[i].value.toFixed(1)}%</text>`).join('')}
      ${pts.map((p, i) => `
        <text x="${xs[i].toFixed(2)}" y="${height - 34}" text-anchor="middle" fill="${C.soft}" font-size="13" font-weight="700">${p.label}</text>
        <text x="${xs[i].toFixed(2)}" y="${height - 18}" text-anchor="middle" fill="${C.faint}" font-size="10.5">${p.sub}</text>`).join('')}
    </svg>`;
}

// ── §02 prediction vs reality (paired bars) ─────────────────────────────────
export function predictionRealityBars(data, width = 900, height = 300) {
  width = dimension(width, 900);
  height = dimension(height, 300);
  data = data.map(d => ({ expected: finiteNumber(d.expected), resolved: finiteNumber(d.resolved), label: escapeText(d.label) }));
  const expectedColor = C.info, resolvedColor = C.signalNew;
  const padX = 16, padR = 52, padTop = 18, padBottom = 38;
  const plotW = width - padX - padR;
  const plotH = height - padTop - padBottom;
  const max = 100;
  const groupGap = 16, barGap = 5;
  const groupW = (plotW - groupGap * (data.length - 1)) / data.length;
  const bw = (groupW - barGap) / 2;
  const axis = [100, 80, 60, 40, 20, 0];
  return `
    ${svgOpen(width, height)}
      ${axis.map((tk) => {
        const y = padTop + (1 - tk / max) * plotH;
        return `<line x1="${padX}" y1="${y.toFixed(2)}" x2="${width - padR}" y2="${y.toFixed(2)}" stroke="${C.borderFaint}" stroke-width="1" stroke-dasharray="${tk === 0 ? '0' : '3 4'}" />
          <text x="${width - padR + 12}" y="${(y + 4).toFixed(2)}" fill="${C.faint}" font-size="10.5" font-family="${MONO}">${tk}%</text>`;
      }).join('')}
      ${data.map((d, i) => {
        const gx = padX + i * (groupW + groupGap);
        const he = (d.expected / max) * plotH;
        const hr = (d.resolved / max) * plotH;
        const ye = padTop + plotH - he;
        const yr = padTop + plotH - hr;
        return `<g class="ga-pair">
          <rect x="${gx.toFixed(2)}" y="${ye.toFixed(2)}" width="${bw.toFixed(2)}" height="${he.toFixed(2)}" rx="2.5" fill="rgb(var(--hz-info-rgb) / 0.25)" stroke="${expectedColor}" stroke-width="1" />
          <rect x="${(gx + bw + barGap).toFixed(2)}" y="${yr.toFixed(2)}" width="${bw.toFixed(2)}" height="${hr.toFixed(2)}" rx="2.5" fill="rgb(var(--hz-signal-new-rgb) / 0.25)" stroke="${resolvedColor}" stroke-width="1" />
        </g>
        <text x="${(gx + groupW / 2).toFixed(2)}" y="${height - 14}" text-anchor="middle" fill="${C.faint}" font-size="10.5" font-family="${MONO}">${d.label}</text>`;
      }).join('')}
    </svg>`;
}

// ── §03 brier vs volume (bars) ──────────────────────────────────────────────
export function brierBars(data, width = 900, height = 280) {
  width = dimension(width, 900);
  height = dimension(height, 280);
  data = data.map(d => ({ value: finiteNumber(d.value), label: escapeText(d.label) }));
  const accent = C.info;
  const padX = 14, padR = 52, padTop = 24, padBottom = 44;
  const plotW = width - padX - padR;
  const plotH = height - padTop - padBottom;
  const max = 0.09;
  const gap = 10;
  const bw = (plotW - gap * (data.length - 1)) / data.length;
  const ticks = [0, 0.02, 0.04, 0.06, 0.08];
  return `
    ${svgOpen(width, height)}
      ${ticks.map((tk) => {
        const y = padTop + (1 - tk / max) * plotH;
        return `<line x1="${padX}" y1="${y.toFixed(2)}" x2="${width - padR}" y2="${y.toFixed(2)}" stroke="${C.borderFaint}" stroke-width="1" />
          <text x="${width - padR + 12}" y="${(y + 4).toFixed(2)}" fill="${C.faint}" font-size="10.5" font-family="${MONO}">${tk.toFixed(2)}</text>`;
      }).join('')}
      ${data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = padX + i * (bw + gap);
        const y = padTop + plotH - h;
        const tt = data.length > 1 ? i / (data.length - 1) : 1;
        const op = lerp(0.28, 0.92, tt).toFixed(3);
        return `<rect class="ga-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="3" fill="${accent}" opacity="${op}" />
          <text x="${(x + bw / 2).toFixed(2)}" y="${(y - 7).toFixed(2)}" text-anchor="middle" fill="${C.soft}" font-size="10" font-family="${MONO}" opacity="${tt > 0.45 ? 1 : 0.6}">${d.value.toFixed(3)}</text>
          <text x="${(x + bw / 2).toFixed(2)}" y="${height - 16}" text-anchor="middle" fill="${C.faint}" font-size="9.5" font-family="${MONO}">${d.label}</text>`;
      }).join('')}
    </svg>`;
}

// ── §04 resolution split (HTML flex bar — scales natively) ──────────────────
export function splitBar(resolution, height = 64) {
  const yes = Math.max(0, Math.min(100, finiteNumber(resolution.yes)));
  const no = Math.max(0, Math.min(100, finiteNumber(resolution.no)));
  height = dimension(height, 64);
  return `
    <div class="ga-split">
      <div class="ga-split__legend">
        <span style="color:${C.buy}">כן · ${yes}%</span>
        <span style="color:${C.sell}">לא · ${no}%</span>
      </div>
      <div class="ga-split__track" style="height:${height}px">
        <div class="ga-seg ga-seg--yes" style="width:${yes}%">
          <span>${yes}%</span>
        </div>
        <div class="ga-seg ga-seg--no" style="width:${no}%">
          <span>${no}%</span>
        </div>
      </div>
    </div>`;
}

// ── data-state placeholders ─────────────────────────────────────────────────
export function resolveStatus(pageStatus, data) {
  if (pageStatus === 'loading' || pageStatus === 'error' || pageStatus === 'empty') return pageStatus;
  const isEmpty = data == null || (Array.isArray(data) && data.length === 0) ||
    (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
  return isEmpty ? 'empty' : 'ready';
}

export function chartSkeleton(height = 300) {
  height = dimension(height, 300);
  const rows = [0.18, 0.4, 0.62, 0.84];
  return `<div class="ga-statewrap" style="height:${height}px">
    ${rows.map((r) => `<div class="ga-skelline" style="top:${r * 100}%"></div>`).join('')}
    <div class="ga-skel"></div>
  </div>`;
}

export function chartEmpty(height = 300) {
  height = dimension(height, 300);
  return `<div class="ga-state" style="height:${height}px">
    <div class="ga-state__rule"></div>
    <div class="ga-state__title">אין עדיין נתונים להצגה</div>
    <div class="ga-state__body">המדד יתעדכן אוטומטית כשיצטברו מספיק שווקים שהוכרעו.</div>
  </div>`;
}

export function chartError(height = 300) {
  height = dimension(height, 300);
  return `<div class="ga-state" style="height:${height}px">
    <div class="ga-state__rule ga-state__rule--error"></div>
    <div class="ga-state__title">לא ניתן לטעון את הנתונים</div>
    <div class="ga-state__body">אירעה תקלה בטעינת הנתונים מהשרת.</div>
    <button type="button" class="ga-retry" data-ga-retry>נסו שוב</button>
  </div>`;
}

// Pick chart-or-state for a section. `chartHtml` is a thunk so we don't build
// geometry when a placeholder will be shown instead.
export function section(pageStatus, data, height, chartHtml) {
  const s = resolveStatus(pageStatus, data);
  if (s === 'loading') return chartSkeleton(height);
  if (s === 'empty') return chartEmpty(height);
  if (s === 'error') return chartError(height);
  return chartHtml();
}
