import sharp from '../../../lib/share-sharp.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BACKEND_INTERNAL_URL } from '../../../lib/backend.js';
import { fetchMarketDetail } from '../../../lib/market-detail.js';
import { shareImageTextCss } from '../../../lib/share-image-font.js';
import { checkShareImageRateLimit, shareImageRateLimitResponse } from '../../../lib/share-image-rate-limit.js';
import { parseShareClaimImageRequest, shareClaimImageBadRequestResponse } from '../../../lib/share-claim-image-request.js';

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
  muted: '#66756b',
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
  return lines.length ? lines : ['קריאה נכונה בהחוזה'];
}

function formatAmount(amount, amountLabel) {
  const label = compactText(amountLabel);
  if (/^V₪\s*\S/.test(label) && label.length <= 24) return label;

  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 'קריאה נכונה';

  return `V₪ ${new Intl.NumberFormat('he-IL', {
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric)}`;
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

function categoryKey(context) {
  const href = compactText(context?.categoryHref);
  const match = href.match(/[?&]category=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : 'general';
}

function mediaSrc(context, category) {
  if (context?.brandPhotoUrl) return context.brandPhotoUrl;
  const src = compactText(context?.brandImageUrl);
  if (!src) return `/assets/images/market-buckets/${category || 'general'}.svg`;
  if (src.startsWith('/assets/images/market-buckets/') && category) {
    return `/assets/images/market-buckets/${category}.svg`;
  }
  return src;
}

// Consented share snapshot (identity + entry odds). Null when the claim isn't
// shared/consented — the caller falls back to the plain query params.
async function fetchClaimShare(claimId) {
  if (!claimId) return null;

  try {
    const response = await fetch(
      new URL(`/api/share/claims/${encodeURIComponent(claimId)}`, BACKEND_INTERNAL_URL),
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1800) },
    );
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

async function avatarAsset(src) {
  const clean = compactText(src);
  if (!clean.startsWith('/api/uploads/avatars/') || clean.includes('..') || !/\.webp$/i.test(clean)) return null;

  try {
    const response = await fetch(new URL(clean, BACKEND_INTERNAL_URL), {
      headers: { accept: 'image/webp,image/*' },
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
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

async function resolveMarketMedia(marketKey) {
  if (!marketKey) return null;

  try {
    const record = await fetchMarketDetail(marketKey);
    const category = categoryKey(record?.context);
    return await publicAsset(mediaSrc(record?.context, category));
  } catch {
    return null;
  }
}

function renderFallbackMedia() {
  return `
    <rect x="0" y="0" width="${LEFT_WIDTH}" height="${HEIGHT}" fill="#102018"/>
    <circle cx="156" cy="124" r="212" fill="${TONE.brand}" opacity="0.12"/>
    <circle cx="430" cy="514" r="240" fill="${TONE.good}" opacity="0.10"/>
    <circle cx="300" cy="318" r="148" fill="${TONE.brand}" opacity="0.94"/>
    <path d="M300 196 L334 278 L424 278 L350 330 L378 416 L300 364 L222 416 L250 330 L176 278 L266 278 Z" fill="${TONE.ink}" opacity="0.72"/>
  `;
}

function renderSvg({ title, outcome, amountLabel, hasMedia, predictorName, entryPricePct, hasAvatar }) {
  // Tight interior gutters (44px), matching the market + profile cards.
  const PANEL_R = 1156;
  const COL_L = RIGHT_X + 44; // 644
  const titleLines = wrapRtl(title, 25, 3);
  const titleSvg = titleLines.map((line, index) => `
    <text x="${PANEL_R}" y="${274 + index * 44}" class="title" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(line)}</text>
  `).join('');
  const outcomeLabel = outcome ? `התוצאה: ${outcome}` : 'קראת את זה נכון';
  // Identity line: who made the call. Falls back to the plain kicker when the
  // share isn't claim-backed yet.
  const kicker = predictorName ? `${compactText(predictorName).slice(0, 26)} · קריאה נכונה` : 'קריאה נכונה';
  const kickerX = hasAvatar ? PANEL_R - 68 : PANEL_R;
  // Entry odds: the against-the-odds half of the brag. Two pills when known,
  // spanning the full interior; a single wide pill otherwise.
  const pills = entryPricePct != null
    ? `
      <rect x="968" y="462" width="${PANEL_R - 968}" height="54" rx="27" fill="#eef3ec"/>
      <text x="${(968 + PANEL_R) / 2}" y="498" class="outcome" text-anchor="middle" direction="rtl" unicode-bidi="plaintext">כניסה ב־${escapeXml(String(entryPricePct))}%</text>
      <rect x="${COL_L}" y="462" width="300" height="54" rx="27" fill="#eef3ec"/>
      <text x="${COL_L + 150}" y="498" class="outcome" text-anchor="middle" direction="rtl" unicode-bidi="plaintext">${escapeXml(outcome ? compactText(outcome).slice(0, 16) : 'קראת נכון')}</text>
    `
    : `
      <rect x="${COL_L}" y="462" width="${PANEL_R - COL_L}" height="54" rx="27" fill="#eef3ec"/>
      <text x="${(COL_L + PANEL_R) / 2}" y="498" class="outcome" text-anchor="middle" direction="rtl" unicode-bidi="plaintext">${escapeXml(outcomeLabel)}</text>
    `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="mediaShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#07100f" stop-opacity="0.04"/>
          <stop offset="52%" stop-color="#07100f" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#07100f" stop-opacity="0.72"/>
        </linearGradient>
        <style>
          ${shareImageTextCss()}
          .brandText { fill: #fff8e8; font-size: 28px; font-weight: 900; }
          .kicker { fill: #5c6b60; font-size: 24px; font-weight: 900; }
          .amount { fill: ${TONE.brand}; font-size: 86px; font-weight: 900; direction: ltr; }
          .title { fill: ${TONE.ink}; font-size: 38px; font-weight: 900; }
          .outcome { fill: ${TONE.ink}; font-size: 24px; font-weight: 900; }
        </style>
      </defs>
      ${hasMedia ? '' : renderFallbackMedia()}
      <rect x="0" y="0" width="${LEFT_WIDTH}" height="${HEIGHT}" fill="url(#mediaShade)"/>
      <rect x="${RIGHT_X}" y="0" width="${WIDTH - RIGHT_X}" height="${HEIGHT}" fill="${TONE.panel}"/>
      <rect x="${RIGHT_X}" y="0" width="${WIDTH - RIGHT_X}" height="14" fill="${TONE.brand}"/>
      <rect x="${RIGHT_X}" y="0" width="1" height="${HEIGHT}" fill="#d7ddd5"/>
      <rect x="30" y="30" width="256" height="58" rx="18" fill="#07100f" opacity="0.50"/>
      <text x="46" y="68" class="brandText" text-anchor="start">החוזה</text>
      <text x="${kickerX}" y="86" class="kicker" text-anchor="start" direction="rtl" unicode-bidi="plaintext">${escapeXml(kicker)}</text>
      <text x="900" y="196" class="amount" text-anchor="middle" direction="ltr">${escapeXml(amountLabel)}</text>
      ${titleSvg}
      <line x1="${COL_L}" x2="${PANEL_R}" y1="430" y2="430" stroke="${TONE.line}" stroke-width="2"/>
      ${pills}
    </svg>
  `;
}

async function renderPng(card) {
  const layers = [];

  if (card.media?.buffer) {
    const mediaBuffer = card.media.src?.startsWith('/assets/images/market-buckets/')
      ? normalizeBucketSvg(card.media.buffer)
      : card.media.buffer;
    layers.push({
      input: await sharp(mediaBuffer)
        .rotate()
        .resize(LEFT_WIDTH, HEIGHT, { fit: 'cover' })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    });
  }

  layers.push({ input: Buffer.from(renderSvg({ ...card, hasAvatar: Boolean(card.avatar) })), left: 0, top: 0 });

  if (card.avatar) {
    layers.push({
      input: await circleImage(card.avatar, 52),
      left: 1104, // right edge (PANEL_R 1156 − 52), beside the kicker
      top: 50,
    });
  }

  const logo = await publicAsset('/assets/brand/logo-tile.svg');
  if (logo?.buffer) {
    layers.push({
      input: await sharp(logo.buffer).resize(58, 58, { fit: 'contain' }).png().toBuffer(),
      left: 214,
      top: 30,
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

export async function GET({ url, clientAddress, request }) {
  const parsed = parseShareClaimImageRequest(url);
  if (!parsed.ok) return shareClaimImageBadRequestResponse(parsed.message);

  const gate = checkShareImageRateLimit({ clientAddress, request, ...parsed.rateLimit });
  if (!gate.allowed) return shareImageRateLimitResponse(gate.retryAfterSec);

  // Claim-backed truth first (identity + entry odds); plain params are the
  // pre-consent fallback — deletable once consent stamping is verified in prod.
  const share = await fetchClaimShare(parsed.claimId);
  const title = compactText(share?.marketTitle || parsed.legacy.title, 'שוק בהחוזה').slice(0, 160);
  const outcome = compactText(share?.outcomeLabel || parsed.legacy.outcome).slice(0, 80);
  const marketKey = compactText(share?.marketKey || parsed.legacy.market).slice(0, 160);
  const amountLabel = share
    ? formatAmount(share.proceeds, '')
    : formatAmount(parsed.legacy.amount, parsed.legacy.amountLabel);
  const entryPricePct = Number.isFinite(Number(share?.entryPricePct)) ? Number(share.entryPricePct) : null;
  const [media, avatar] = await Promise.all([
    resolveMarketMedia(marketKey),
    share?.user?.avatarUrl ? avatarAsset(share.user.avatarUrl) : Promise.resolve(null),
  ]);
  const png = await renderPng({
    title,
    outcome,
    amountLabel,
    media,
    hasMedia: Boolean(media?.buffer),
    predictorName: share?.user?.displayName || '',
    entryPricePct,
    avatar,
  });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': share ? 'public, max-age=900, stale-while-revalidate=86400' : 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}
