import sharp from '../../../lib/share-sharp.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BACKEND_INTERNAL_URL } from '../../../lib/backend.js';
import { deriveTrackRecord } from '../../../lib/profile-format.js';
import { shareImageTextCss } from '../../../lib/share-image-font.js';
import { checkShareImageRateLimit, shareImageRateLimitResponse } from '../../../lib/share-image-rate-limit.js';

const WIDTH = 1200;
const HEIGHT = 630;
const LEFT_WIDTH = 600;
const RIGHT_X = LEFT_WIDTH;
const WEB_PUBLIC_ROOT = process.cwd().endsWith(`${path.sep}systems${path.sep}web`)
  ? path.join(process.cwd(), 'public')
  : path.join(process.cwd(), 'systems/web/public');

const TONE = {
  bg: '#07100f',
  panel: '#fbfbf5',
  ink: '#102018',
  muted: '#68756c',
  brand: '#f7c66a',
  good: '#6ee7b7',
  line: '#dfe5dc',
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compactText(value, fallback = '') {
  return String(value || fallback || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapRtl(text, maxChars, maxLines) {
  const words = compactText(text).replace(/[:·]/g, '').split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '')}…`;
  }
  return lines.length ? lines : ['חוֹזֶה'];
}

async function getJSON(apiPath) {
  try {
    const res = await fetch(new URL(apiPath, BACKEND_INTERNAL_URL), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1800),
    });
    return res.ok ? await res.json().catch(() => null) : null;
  } catch {
    return null;
  }
}

async function publicAsset(src) {
  const clean = compactText(src);
  if (!clean.startsWith('/assets/') || clean.includes('..') || !/\.(jpe?g|png|webp|svg)$/i.test(clean)) return null;

  try {
    const filePath = path.join(WEB_PUBLIC_ROOT, clean.replace(/^\//, ''));
    if (path.relative(WEB_PUBLIC_ROOT, filePath).startsWith('..')) return null;
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function avatarAsset(src) {
  const clean = compactText(src);
  if (!clean.startsWith('/api/uploads/avatars/') || clean.includes('..') || !/\.webp$/i.test(clean)) return null;

  try {
    const res = await fetch(new URL(clean, BACKEND_INTERNAL_URL), {
      headers: { accept: 'image/webp,image/*' },
      signal: AbortSignal.timeout(1800),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function renderAvatarFallback(initial) {
  return `
    <circle cx="300" cy="315" r="164" fill="${TONE.brand}" opacity="0.94"/>
    <text x="300" y="369" class="avatarInitial" text-anchor="middle">${escapeXml(initial)}</text>
  `;
}

function renderSvg({ profile, record, hasAvatar }) {
  const name = profile.displayName || profile.handle || 'חוֹזֶה';
  const initial = compactText(name).charAt(0) || 'ח';
  // Content-column geometry — tight 44px gutters so the record table + metric
  // cards stretch across the panel (matches share/markets/[marketKey].png.js).
  const PANEL_R = 1156;         // right text edge
  const COL_L = RIGHT_X + 44;   // table / cards left edge
  const BAR_W = 200;            // category bar track
  const BAR_R = COL_L + BAR_W;
  const PROB_X = COL_L + BAR_W / 2;
  const LABEL_R = PANEL_R - 16;
  const CARD_W = 157;           // metric card width (three across, 20px gaps)
  const CARD_X2 = COL_L + CARD_W + 20;
  const CARD_X3 = COL_L + (CARD_W + 20) * 2;
  const categories = record.breakdown.slice(0, 3);
  const categoryRows = categories.length
    ? categories.map((item, index) => {
      const y = 228 + index * 38;
      const barWidth = Math.round(clamp(Number(item.pct) || 0, 0, 100) * (BAR_W / 100));
      return `
        <g>
          <text x="${LABEL_R}" y="${y}" class="catLabel" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(item.label)}</text>
          <text x="${PROB_X}" y="${y}" class="catPct" text-anchor="middle" direction="ltr">${escapeXml(`${item.pct}%`)}</text>
          <rect x="${COL_L}" y="${y + 10}" width="${BAR_W}" height="9" rx="4" fill="#e2e8dc"/>
          <rect x="${BAR_R - barWidth}" y="${y + 10}" width="${barWidth}" height="9" rx="4" fill="${index === 0 ? TONE.good : TONE.brand}" opacity="0.9"/>
        </g>
      `;
    }).join('')
    : `<text x="${LABEL_R}" y="240" class="empty" text-anchor="start" direction="rtl">אין עדיין קטגוריות מובילות</text>`;
  const nameLines = wrapRtl(name, 20, 2);
  const nameSvg = nameLines.map((line, index) => `
    <text x="900" y="${88 + index * 46}" class="name" text-anchor="middle" direction="rtl" unicode-bidi="plaintext">${escapeXml(line)}</text>
  `).join('');
  const accuracy = record.accuracyPct == null ? '—' : `${record.accuracyPct}%`;
  const streak = Number.isFinite(Number(record.longestWinStreak)) ? String(record.longestWinStreak) : '—';
  const resolved = Number(record.resolvedCount) > 0 ? Number(record.resolvedCount).toLocaleString('en-US') : '—';
  // Biggest win — compact V₪ so it fits the narrow metric card.
  const biggestWin = (() => {
    const n = Number(record.biggestWin);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1000) return `V₪ ${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return `V₪ ${Math.round(n)}`;
  })();

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="leftShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#07100f" stop-opacity="0.16"/>
          <stop offset="54%" stop-color="#07100f" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#07100f" stop-opacity="0.78"/>
        </linearGradient>
        <style>
          ${shareImageTextCss()}
          .avatarInitial { fill: #102018; font-size: 142px; font-weight: 900; }
          .brandText { fill: #fff8e8; font-size: 28px; font-weight: 900; }
          .accLabel { fill: #dce5d6; font-size: 22px; font-weight: 900; }
          .accValue { fill: ${TONE.brand}; font-size: 60px; font-weight: 900; }
          .name { fill: #102018; font-size: 44px; font-weight: 900; }
          .sectionLabel { fill: #5c6b60; font-size: 19px; font-weight: 900; }
          .catLabel { fill: #13241b; font-size: 22px; font-weight: 900; }
          .catPct { fill: #102018; font-size: 22px; font-weight: 900; direction: ltr; }
          .metricLabel { fill: #5c6b60; font-size: 16px; font-weight: 900; }
          .metricValue { fill: #102018; font-size: 34px; font-weight: 900; }
          .empty { fill: #55645a; font-size: 21px; font-weight: 800; }
        </style>
      </defs>
      <rect x="0" y="0" width="${LEFT_WIDTH}" height="${HEIGHT}" fill="url(#leftShade)"/>
      <rect x="${RIGHT_X}" y="0" width="${WIDTH - RIGHT_X}" height="${HEIGHT}" fill="${TONE.panel}"/>
      <rect x="${RIGHT_X}" y="0" width="${WIDTH - RIGHT_X}" height="14" fill="${TONE.brand}"/>
      <rect x="${RIGHT_X}" y="0" width="1" height="${HEIGHT}" fill="#d7ddd5"/>
      <rect x="398" y="28" width="172" height="58" rx="18" fill="#07100f" opacity="0.46"/>
      <text x="414" y="66" class="brandText" text-anchor="start">החוזה</text>
      <text x="300" y="528" class="accLabel" text-anchor="middle" direction="rtl">דיוק החשבון</text>
      <text x="300" y="582" class="accValue" text-anchor="middle" direction="ltr">${escapeXml(accuracy)}</text>
      ${nameSvg}
      <text x="${LABEL_R}" y="174" class="sectionLabel" text-anchor="start" direction="rtl">${categories.length ? 'הקטגוריות המובילות' : 'רקורד'}</text>
      <line x1="${COL_L}" x2="${PANEL_R}" y1="194" y2="194" stroke="${TONE.line}" stroke-width="2"/>
      ${categoryRows}
      <g transform="translate(${COL_L} 390)">
        <rect x="0" y="0" width="${CARD_W}" height="116" rx="22" fill="#f0f3ec"/>
        <text x="${CARD_W / 2}" y="42" class="metricLabel" text-anchor="middle" direction="rtl">הרצף הארוך</text>
        <text x="${CARD_W / 2}" y="88" class="metricValue" text-anchor="middle">${escapeXml(streak)}</text>
      </g>
      <g transform="translate(${CARD_X2} 390)">
        <rect x="0" y="0" width="${CARD_W}" height="116" rx="22" fill="#f0f3ec"/>
        <text x="${CARD_W / 2}" y="42" class="metricLabel" text-anchor="middle" direction="rtl">שווקים שהוכרעו</text>
        <text x="${CARD_W / 2}" y="88" class="metricValue" text-anchor="middle" direction="ltr">${escapeXml(resolved)}</text>
      </g>
      <g transform="translate(${CARD_X3} 390)">
        <rect x="0" y="0" width="${CARD_W}" height="116" rx="22" fill="#f0f3ec"/>
        <text x="${CARD_W / 2}" y="42" class="metricLabel" text-anchor="middle" direction="rtl">הרווח הגדול</text>
        <text x="${CARD_W / 2}" y="88" class="metricValue" text-anchor="middle" direction="ltr">${escapeXml(biggestWin)}</text>
      </g>
      ${hasAvatar ? '' : renderAvatarFallback(initial)}
    </svg>
  `;
}

async function circleImage(buffer, size) {
  return sharp(buffer)
    .resize(size, size, { fit: 'cover' })
    .composite([{
      input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();
}

async function renderPng({ profile, record, avatar }) {
  const layers = [];
  if (avatar) {
    layers.push({
      input: await sharp(avatar).resize(LEFT_WIDTH, HEIGHT, { fit: 'cover' }).png().toBuffer(),
      left: 0,
      top: 0,
    });
  }

  layers.push({ input: Buffer.from(renderSvg({ profile, record, hasAvatar: Boolean(avatar) })), left: 0, top: 0 });

  if (avatar) {
    layers.push({
      input: await circleImage(avatar, 84),
      left: 30,
      top: 30,
    });
  }

  const logo = await publicAsset('/assets/brand/logo-tile.svg');
  if (logo) {
    layers.push({
      input: await sharp(logo).resize(58, 58, { fit: 'contain' }).png().toBuffer(),
      left: 512,
      top: 28,
    });
  }

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: TONE.bg,
    },
  }).composite(layers).png().toBuffer();
}

export async function GET({ params, clientAddress, request }) {
  const gate = checkShareImageRateLimit({ clientAddress, request });
  if (!gate.allowed) return shareImageRateLimitResponse(gate.retryAfterSec);

  const handle = params.handle?.replace(/\.png$/i, '');
  const enc = encodeURIComponent(handle || '');
  const profile = handle ? await getJSON(`/api/social/users/${enc}`) : null;
  if (!profile) return new Response(null, { status: 404 });

  const track = await getJSON(`/api/social/users/${enc}/track-record`);
  const record = deriveTrackRecord(track, profile.showcaseCategories || []);
  const avatar = await avatarAsset(profile.avatarUrl) || await publicAsset('/assets/brand/default-avatar.png');
  const png = await renderPng({ profile, record, avatar });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}
