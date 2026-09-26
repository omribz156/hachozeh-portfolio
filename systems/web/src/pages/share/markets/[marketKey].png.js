import sharp from '../../../lib/share-sharp.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchMarketDetail } from '../../../lib/market-detail.js';
import { shareImageTextCss } from '../../../lib/share-image-font.js';
import { checkShareImageRateLimit, shareImageRateLimitResponse } from '../../../lib/share-image-rate-limit.js';
import {
  selectResolvedEventWinner,
  selectShareMarketCardRows,
} from '../../../lib/share-market-card-rows.js';

const WIDTH = 1200;
const HEIGHT = 630;
// Even 50/50 split with the image. The content gets its room from tight interior
// gutters (see COL_L / PANEL_R in renderSvg), not from stealing image width.
const MEDIA_WIDTH = 600;
const RIGHT_X = MEDIA_WIDTH;
const RIGHT_WIDTH = WIDTH - MEDIA_WIDTH;
const WEB_PUBLIC_ROOT = process.cwd().endsWith(`${path.sep}systems${path.sep}web`)
  ? path.join(process.cwd(), 'public')
  : path.join(process.cwd(), 'systems/web/public');

const CATEGORY_TONES = {
  sports: { primary: '#f7c66a', secondary: '#2371b5', surface: '#edf5ff', ink: '#10233d' },
  economy: { primary: '#6ee7b7', secondary: '#f7c66a', surface: '#ecfbf4', ink: '#113129' },
  politics: { primary: '#f7c66a', secondary: '#d96363', surface: '#f8f1e7', ink: '#2c1c24' },
  technology: { primary: '#7dd3fc', secondary: '#f7c66a', surface: '#edf7ff', ink: '#101f33' },
  weather: { primary: '#7dd3fc', secondary: '#6ee7b7', surface: '#edf7f7', ink: '#10233d' },
  world: { primary: '#9ca3af', secondary: '#6ee7b7', surface: '#f2f4f7', ink: '#172033' },
  default: { primary: '#f7c66a', secondary: '#6ee7b7', surface: '#f4f0e6', ink: '#142437' },
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

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(clamp(n <= 1 ? n * 100 : n, 0, 100))}%`;
}

// Glue a trailing pure-number/punct token onto the word before it with a
// non-breaking space, so a Latin+number run like "GTA 6?" is one wrap unit and
// never splits across an RTL line break (which reorders the halves and reads
// broken). "6?", "6", "2026", "II" attach; Hebrew/Latin words stay separate.
function glueNumericTails(words) {
  const out = [];
  for (const word of words) {
    if (out.length && /^[0-9?!.,%\-'"״׳()]+$/.test(word)) {
      out[out.length - 1] = `${out[out.length - 1]} ${word}`;
    } else {
      out.push(word);
    }
  }
  return out;
}

function wrapRtl(text, maxChars, maxLines) {
  const words = glueNumericTails(
    compactText(text).replace(/[:·]/g, '').split(' ').filter(Boolean),
  );
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
  return lines.length ? lines : ['שוק תחזיות'];
}

function categoryKey(context) {
  const href = compactText(context?.categoryHref);
  const match = href.match(/[?&]category=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : 'default';
}

function mediaSrc(context, category) {
  if (context?.brandPhotoUrl) return context.brandPhotoUrl;

  const src = compactText(context?.brandImageUrl);
  if (!src) return '';

  // If a stale/generic bucket image leaked in from an old detail payload, prefer
  // the canonical bucket for this market category.
  if (src.startsWith('/assets/images/market-buckets/') && category && category !== 'default') {
    return `/assets/images/market-buckets/${category}.svg`;
  }

  return src;
}

async function publicAsset(src) {
  const clean = compactText(src);
  if (!clean.startsWith('/assets/') || clean.includes('..') || !/\.(jpe?g|png|webp|svg)$/i.test(clean)) return null;

  try {
    const filePath = path.join(WEB_PUBLIC_ROOT, clean.replace(/^\//, ''));
    if (path.relative(WEB_PUBLIC_ROOT, filePath).startsWith('..')) return null;
    return {
      buffer: await readFile(filePath),
      kind: /\.svg$/i.test(clean) ? 'icon' : 'photo',
      src: clean,
    };
  } catch {
    return null;
  }
}

function normalizeBucketSvg(buffer) {
  return Buffer.from(
    buffer.toString('utf8').replace(/<rect([^>]*?)\s+rx="[^"]+"([^>]*?)\/>/g, '<rect$1$2/>'),
  );
}

// Single-line outcome label with a hard character budget: the label's right edge
// sits at x=1094 and the percent column ends near x=830, so anything wider
// overprints the number (the GTA/BOI collision class from the share sweep).
function clipLabel(value, maxChars = 20) {
  const text = compactText(value);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

function hasHebrew(value) {
  return /[֐-׿]/.test(String(value || ''));
}

function sourceLabel(snapshot) {
  const source = snapshot.contract?.resolutionSource;
  if (source && typeof source === 'object') return compactText(source.label);
  return compactText(source);
}

function renderMedia({ mediaKind, tone }) {
  if (mediaKind) {
    return `
      <rect x="0" y="0" width="${MEDIA_WIDTH}" height="${HEIGHT}" fill="#07100f" opacity="0.04"/>
      <rect x="0" y="0" width="${MEDIA_WIDTH}" height="${HEIGHT}" fill="url(#mediaShade)"/>
    `;
  }

  return `
    <rect x="0" y="0" width="${MEDIA_WIDTH}" height="${HEIGHT}" fill="${tone.surface}"/>
    <rect x="0" y="0" width="${MEDIA_WIDTH}" height="14" fill="${tone.primary}"/>
    <rect x="70" y="105" width="460" height="420" rx="54" fill="${tone.ink}"/>
    <circle cx="300" cy="315" r="148" fill="${tone.primary}" opacity="0.9"/>
    <path d="M300 193 L332 276 L420 276 L348 327 L376 411 L300 360 L224 411 L252 327 L180 276 L268 276 Z" fill="${tone.ink}" opacity="0.72"/>
  `;
}

function renderSvg({ title, categoryLabel, rows, volumeLabel, closeLabel, resolutionSource, resolved, winningLabel, resolvedDateLabel, media, tone }) {
  const titleLines = wrapRtl(title, 26, 3);
  const isResolved = resolved && !!compactText(winningLabel);
  // No fabricated 50/50 rows: a fallback/unknown card must not fake market odds.
  const displayRows = [...rows].sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0));
  const meta = isResolved
    ? [
        volumeLabel ? `מחזור ${volumeLabel}` : '',
        resolvedDateLabel ? `הוכרע · ${resolvedDateLabel}` : 'הוכרע',
      ].filter(Boolean).join(' · ')
    : [
        volumeLabel ? `מחזור ${volumeLabel}` : '',
        closeLabel ? `נסגר ב־${closeLabel}` : '',
      ].filter(Boolean).join(' · ');
  const metaLine = meta || (resolutionSource ? 'הכרעה לפי מקור רשמי' : 'מחיר שוק בזמן אמת');
  const tableY = Math.max(276, 118 + titleLines.length * 48 + 42);

  // Content-column geometry, all derived. Tight interior gutters (44px) let the
  // table stretch across the 600px panel instead of hugging its middle — the
  // "more room inside" without touching the 50/50 image split.
  const PANEL_R = 1156;         // right text edge (44px right gutter)
  const COL_L = RIGHT_X + 44;   // table left edge (44px gutter from the seam)
  const BAR_W = 244;            // bar track width
  const BAR_R = COL_L + BAR_W;  // fill grows leftward from here
  const PROB_X = COL_L + BAR_W / 2; // % centered over the bar
  const LABEL_R = PANEL_R - 16; // outcome label, slight inset from the title

  const titleSvg = titleLines.map((line, index) => `
    <text x="${PANEL_R}" y="${118 + index * 48}" class="title" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(line)}</text>
  `).join('');

  const rowSvg = displayRows.slice(0, 4).map((row, index) => {
    const y = tableY + 60 + index * 58;
    const probability = Number(row.probability) || 0;
    const barWidth = Math.max(8, Math.round(clamp(probability <= 1 ? probability * 100 : probability, 0, 100) * (BAR_W / 100)));
    // Clip so the label clears the % column with real air (no ellipsis touching
    // the number). Prefix-heavy labels (e.g. "הורדת ריבית של 0.25…") need enough
    // room to reach the differentiating number, so the outcome font is a notch
    // smaller than the % and we allow more characters.
    const rawLabel = clipLabel(row.label || 'תוצאה', 22);
    // Latin/numeric-only labels (e.g. "-0.25%") must not go through RTL bidi —
    // the sign lands on the wrong side. librsvg ignores the direction attribute,
    // so force the paragraph LTR with a leading LRM (first-strong detection).
    const isHebrewLabel = hasHebrew(rawLabel);
    const label = isHebrewLabel ? rawLabel : `‎${rawLabel}`;
    const labelDir = isHebrewLabel
      ? 'text-anchor="start" direction="rtl" unicode-bidi="plaintext"'
      : 'text-anchor="end" direction="ltr"';
    return `
      <g>
        <line x1="${COL_L}" x2="${PANEL_R}" y1="${y + 18}" y2="${y + 18}" stroke="#dce2d7" stroke-width="1"/>
        <text x="${LABEL_R}" y="${y}" class="outcome" ${labelDir}>${escapeXml(label)}</text>
        <text x="${PROB_X}" y="${y}" class="prob" text-anchor="middle" direction="ltr">${escapeXml(pct(probability))}</text>
        <rect x="${COL_L}" y="${y + 8}" width="${BAR_W}" height="10" rx="5" fill="#e2e8dc"/>
        <rect x="${BAR_R - barWidth}" y="${y + 8}" width="${barWidth}" height="10" rx="5" fill="${index === 0 ? tone.primary : tone.secondary}" opacity="${index === 0 ? '1' : '0.82'}"/>
      </g>
    `;
  }).join('');

  // Resolved: the market link is shared AFTER the outcome — tell the result, not
  // stale live odds. Winner only (the story); the ✓ is a vector path, never a
  // font glyph (the embedded Hebrew font has no ✓).
  const winnerLines = wrapRtl(compactText(winningLabel), 20, 2);
  const winnerCy = tableY + 78;
  const resolvedBlock = `
    <text x="${PANEL_R}" y="${tableY}" class="won" text-anchor="start" direction="rtl">הוכרע</text>
    <line x1="${COL_L}" x2="${PANEL_R}" y1="${tableY + 18}" y2="${tableY + 18}" stroke="#c8d1c4" stroke-width="2"/>
    <circle cx="${COL_L + 22}" cy="${winnerCy}" r="22" fill="#2f9e6e"/>
    <path d="M ${COL_L + 12} ${winnerCy} l 7 8 l 13 -15" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${winnerLines.map((line, index) => `
      <text x="${PANEL_R}" y="${tableY + 90 + index * 52}" class="winner" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(line)}</text>
    `).join('')}
  `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="mediaShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#07100f" stop-opacity="0.05"/>
          <stop offset="55%" stop-color="#07100f" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#07100f" stop-opacity="0.64"/>
        </linearGradient>
        <linearGradient id="rightBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fffaf0"/>
          <stop offset="100%" stop-color="#edf3ea"/>
        </linearGradient>
        <style>
          ${shareImageTextCss()}
          .kicker { fill: #5c6b60; font-size: 21px; font-weight: 900; }
          .title { fill: #102018; font-size: 40px; font-weight: 900; }
          .head { fill: #55645a; font-size: 18px; font-weight: 900; }
          .outcome { fill: #13241b; font-size: 22px; font-weight: 900; }
          .prob { fill: #102018; font-size: 25px; font-weight: 900; direction: ltr; }
          .meta { fill: #435147; font-size: 20px; font-weight: 800; }
          .won { fill: #2f9e6e; font-size: 21px; font-weight: 900; letter-spacing: 0.04em; }
          .winner { fill: #102018; font-size: 46px; font-weight: 900; }
        </style>
      </defs>
      ${renderMedia({ mediaKind: media?.kind, tone })}
      <rect x="${RIGHT_X}" y="0" width="${RIGHT_WIDTH}" height="${HEIGHT}" fill="#fbfbf5"/>
      <rect x="${RIGHT_X}" y="0" width="${RIGHT_WIDTH}" height="14" fill="${tone.primary}"/>
      <rect x="${RIGHT_X}" y="0" width="1" height="${HEIGHT}" fill="#d7ddd5"/>
      <text x="${PANEL_R}" y="62" class="kicker" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(categoryLabel || 'שוק תחזיות')}</text>
      ${titleSvg}
      ${isResolved ? resolvedBlock : (displayRows.length ? `
      <text x="${LABEL_R}" y="${tableY}" class="head" text-anchor="start" direction="rtl">תוצאה</text>
      <text x="${PROB_X}" y="${tableY}" class="head" text-anchor="middle" direction="rtl">סיכוי</text>
      <line x1="${COL_L}" x2="${PANEL_R}" y1="${tableY + 18}" y2="${tableY + 18}" stroke="#c8d1c4" stroke-width="2"/>
      ${rowSvg}` : '')}
      <text x="${PANEL_R}" y="578" class="meta" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(metaLine || 'מחיר שוק בזמן אמת')}</text>
    </svg>
  `;
}

async function renderPng(card) {
  const layers = [];

  if (card.media?.buffer) {
    const mediaBuffer = card.media.src?.startsWith('/assets/images/market-buckets/')
      ? normalizeBucketSvg(card.media.buffer)
      : card.media.buffer;
    const mediaInput = card.media.kind === 'icon'
      ? await sharp(mediaBuffer)
          .resize(MEDIA_WIDTH, HEIGHT, { fit: 'cover' })
          .png()
          .toBuffer()
      : await sharp(mediaBuffer)
          .rotate()
          .resize(MEDIA_WIDTH, HEIGHT, { fit: 'cover' })
          .png()
          .toBuffer();
    layers.push({
      input: mediaInput,
      left: 0,
      top: 0,
    });
  }

  layers.push({ input: Buffer.from(renderSvg(card)), left: 0, top: 0 });

  const logo = await publicAsset('/assets/brand/logo-tile.svg');
  if (logo?.buffer) {
    layers.push({
      input: await sharp(logo.buffer).resize(76, 76, { fit: 'contain' }).png().toBuffer(),
      left: 30,
      top: 30,
    });
  }

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: '#0a1712',
    },
  }).composite(layers).png().toBuffer();
}

export async function GET({ params, url, clientAddress, request }) {
  const gate = checkShareImageRateLimit({ clientAddress, request });
  if (!gate.allowed) return shareImageRateLimitResponse(gate.retryAfterSec);

  const marketKey = params.marketKey?.replace(/\.png$/i, '');
  // ?focus mirrors the market page: a focused child renders itself, the bare key
  // renders the parent event. Without this a focused-child share shows the parent.
  const focus = url?.searchParams?.has('focus');

  try {
    const record = await fetchMarketDetail(marketKey);
    const snapshot = record?.snapshot || {};
    const context = record?.context || {};
    // Event share (bare key, not focused): headline + media + rows are the
    // EVENT's, not the first child's. A focused child renders its own market.
    const isEventShare = !focus && !!snapshot.event
      && Array.isArray(snapshot.children) && snapshot.children.length > 1;
    const eventInfo = isEventShare ? snapshot.event : null;
    const title = eventInfo?.title || context.marketLabel || snapshot.contract?.measurement || 'שוק תחזיות';
    const category = categoryKey(context);
    const media = (eventInfo?.icon ? await publicAsset(eventInfo.icon) : null)
      || await publicAsset(mediaSrc(context, category));
    const tone = CATEGORY_TONES[category] || CATEGORY_TONES.default;
    const rawVolume = compactText(eventInfo?.volumeLabel || snapshot.volumeLabel);
    const volumeDigits = rawVolume.replace(/\D/g, '');
    // A live event shows only children still in contention. Once every child is
    // terminal, promote the resolved-yes child into the same winner treatment a
    // standalone resolved market uses instead of emitting an empty table.
    const eventWinnerLabel = selectResolvedEventWinner(snapshot, isEventShare);
    const resolved = (!isEventShare && snapshot.marketStatus === 'resolved') || !!eventWinnerLabel;
    const winningLabel = eventWinnerLabel
      || (resolved ? compactText(snapshot.resolution?.winningOutcomeLabel) : '');
    const resolvedDateLabel = resolved ? compactText(snapshot.updatedLabel).split('·')[0].trim() : '';
    const png = await renderPng({
      title,
      categoryLabel: context.categoryLabel,
      rows: selectShareMarketCardRows(snapshot, isEventShare),
      volumeLabel: volumeDigits && Number(volumeDigits) > 0 ? rawVolume : '',
      closeLabel: snapshot.closeLabel,
      resolutionSource: sourceLabel(snapshot),
      resolved,
      winningLabel,
      resolvedDateLabel,
      media,
      tone,
    });

    return new Response(png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.warn('[market-share-image] fallback', { marketKey, message: error?.message });
    const png = await renderPng({
      title: 'שוק תחזיות בהחוזה',
      categoryLabel: 'החוזה',
      rows: [],
      volumeLabel: '',
      closeLabel: '',
      resolutionSource: '',
      media: null,
      tone: CATEGORY_TONES.default,
    });

    return new Response(png, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=60',
      },
    });
  }
}
