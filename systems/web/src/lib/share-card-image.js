import sharp from './share-sharp.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { shareImageTextCss } from './share-image-font.js';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
const WEB_PUBLIC_ROOT = process.cwd().endsWith(`${path.sep}systems${path.sep}web`)
  ? path.join(process.cwd(), 'public')
  : path.join(process.cwd(), 'systems/web/public');

const TONES = {
  green: { bg: '#0a1712', panel: '#f4f0e6', primary: '#6ee7b7', secondary: '#f7c66a' },
  amber: { bg: '#171207', panel: '#fff4dc', primary: '#f7c66a', secondary: '#6ee7b7' },
  blue: { bg: '#091525', panel: '#eef5ff', primary: '#7dd3fc', secondary: '#f7c66a' },
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

function wrap(text, maxChars, maxLines) {
  const words = compactText(text).split(' ').filter(Boolean);
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
  return lines.length ? lines : ['החוזה'];
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

export async function renderShareCardPng({
  eyebrow = 'החוזה',
  title = 'החוזה',
  subtitle = 'שוק תחזיות עברי',
  rows = [],
  stats = [],
  tone = 'green',
  avatarInitial = '',
} = {}) {
  const colors = TONES[tone] || TONES.green;
  const titleLines = wrap(title, avatarInitial ? 19 : 22, 3);
  const subtitleLines = wrap(subtitle, 34, 2);
  const rowItems = rows.slice(0, 3);
  const statItems = stats.slice(0, 3);
  const titleSvg = titleLines.map((line, i) => `
    <text x="1080" y="${136 + i * 58}" class="title" text-anchor="end">${escapeXml(line)}</text>
  `).join('');
  const subtitleSvg = subtitleLines.map((line, i) => `
    <text x="1080" y="${336 + i * 34}" class="subtitle" text-anchor="end">${escapeXml(line)}</text>
  `).join('');
  const rowsSvg = rowItems.map((row, i) => `
    <g transform="translate(650 ${438 + i * 48})">
      <circle cx="410" cy="0" r="7" fill="${i === 0 ? colors.primary : colors.secondary}" opacity="0.95"/>
      <text x="388" y="8" class="row" text-anchor="end">${escapeXml(row)}</text>
    </g>
  `).join('');
  const statsSvg = statItems.map((stat, i) => `
    <g transform="translate(${88 + i * 150} 508)">
      <text x="0" y="0" class="statValue">${escapeXml(stat.value)}</text>
      <text x="0" y="32" class="statLabel">${escapeXml(stat.label)}</text>
    </g>
  `).join('');
  const avatarSvg = avatarInitial ? `
    <circle cx="256" cy="246" r="116" fill="${colors.primary}" opacity="0.94"/>
    <circle cx="256" cy="246" r="135" fill="none" stroke="#fff8e8" stroke-width="7" opacity="0.22"/>
    <text x="256" y="286" class="avatar" text-anchor="middle">${escapeXml(avatarInitial)}</text>
  ` : `
    <circle cx="256" cy="236" r="132" fill="${colors.primary}" opacity="0.88"/>
    <path d="M256 126 L292 214 L386 214 L310 268 L340 358 L256 305 L172 358 L202 268 L126 214 L220 214 Z" fill="${colors.bg}" opacity="0.72"/>
    <circle cx="140" cy="448" r="88" fill="${colors.secondary}" opacity="0.2"/>
    <circle cx="410" cy="112" r="120" fill="#fff8e8" opacity="0.06"/>
  `;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}">
      <defs>
        <style>
          ${shareImageTextCss()}
          .brand { fill: #fff8e8; font-size: 42px; font-weight: 900; }
          .domain { fill: #dce5d6; font-size: 24px; font-weight: 800; }
          .eyebrow { fill: #59655d; font-size: 25px; font-weight: 900; }
          .title { fill: #102018; font-size: 54px; font-weight: 900; }
          .subtitle { fill: #526057; font-size: 27px; font-weight: 800; }
          .row { fill: #18291f; font-size: 25px; font-weight: 850; }
          .statValue { fill: #fff8e8; font-size: 34px; font-weight: 900; }
          .statLabel { fill: #dce5d6; font-size: 18px; font-weight: 800; }
          .avatar { fill: #102018; font-size: 106px; font-weight: 900; }
        </style>
      </defs>
      <rect width="1200" height="630" fill="${colors.bg}"/>
      <circle cx="160" cy="120" r="240" fill="${colors.primary}" opacity="0.12"/>
      <circle cx="410" cy="516" r="260" fill="${colors.secondary}" opacity="0.11"/>
      ${avatarSvg}
      <text x="78" y="82" class="brand">החוזה</text>
      <text x="78" y="118" class="domain" direction="ltr">hachozeh.com</text>
      ${statsSvg}
      <rect x="540" y="0" width="660" height="630" fill="${colors.panel}"/>
      <rect x="540" y="0" width="660" height="16" fill="${colors.primary}"/>
      <rect x="520" y="0" width="46" height="630" fill="#07100f" opacity="0.22"/>
      <text x="990" y="76" class="eyebrow" text-anchor="end">${escapeXml(eyebrow)}</text>
      ${titleSvg}
      ${subtitleSvg}
      ${rowsSvg}
    </svg>
  `;

  const layers = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  const logo = await publicAsset('/assets/brand/logo-tile.svg');
  if (logo) {
    layers.push({
      input: await sharp(logo).resize(76, 76, { fit: 'contain' }).png().toBuffer(),
      left: 1086,
      top: 28,
    });
  }

  return sharp({
    create: {
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
      channels: 4,
      background: colors.bg,
    },
  }).composite(layers).png().toBuffer();
}
