import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEB_PUBLIC_ROOT = process.cwd().endsWith(`${path.sep}systems${path.sep}web`)
  ? path.join(process.cwd(), 'public')
  : path.join(process.cwd(), 'systems/web/public');
const WEB_DIST_CLIENT_ROOT = process.cwd().endsWith(`${path.sep}systems${path.sep}web`)
  ? path.join(process.cwd(), 'dist/client')
  : path.join(process.cwd(), 'systems/web/dist/client');

const FONT_FAMILY = 'HachozehShareHebrew';
const FONT_DIRS = [
  path.join(WEB_PUBLIC_ROOT, 'assets/fonts/share'),
  path.join(WEB_DIST_CLIENT_ROOT, 'assets/fonts/share'),
];
const FONT_FILES = [
  { weight: 400, path: 'assets/fonts/share/NotoSansHebrew-400.ttf' },
  { weight: 700, path: 'assets/fonts/share/NotoSansHebrew-700.ttf' },
  { weight: 900, path: 'assets/fonts/share/NotoSansHebrew-900.ttf' },
];

let cachedFontCss = null;
let configuredFontconfig = false;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function existingFontDirs() {
  return FONT_DIRS.filter((dir) => existsSync(path.join(dir, 'NotoSansHebrew-400.ttf')));
}

function readFontData(assetPath) {
  const candidates = [
    path.join(WEB_PUBLIC_ROOT, assetPath),
    path.join(WEB_DIST_CLIENT_ROOT, assetPath),
  ];

  try {
    const fontPath = candidates.find((candidate) => existsSync(candidate));
    return fontPath ? readFileSync(fontPath).toString('base64') : '';
  } catch {
    return '';
  }
}

export function configureShareImageFontconfig() {
  if (configuredFontconfig) return;
  configuredFontconfig = true;

  const fontDirs = existingFontDirs();
  if (!fontDirs.length) return;

  const configDir = path.join(os.tmpdir(), 'hachozeh-share-fontconfig');
  const cacheDir = path.join(configDir, 'cache');
  const configPath = path.join(configDir, 'fonts.conf');

  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(configPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${fontDirs.map((dir) => `  <dir>${escapeXml(dir)}</dir>`).join('\n')}
  <cachedir>${escapeXml(cacheDir)}</cachedir>
  <match target="pattern">
    <test qual="any" name="family">
      <string>${FONT_FAMILY}</string>
    </test>
    <edit name="family" mode="assign" binding="strong">
      <string>Noto Sans Hebrew</string>
    </edit>
  </match>
</fontconfig>
`);
    process.env.FONTCONFIG_FILE = configPath;
    process.env.FONTCONFIG_PATH = configDir;
    process.env.FONTCONFIG_USE_MMAP ||= '0';
  } catch {
    // The SVG also embeds the font. Fontconfig is a production hardening path.
  }
}

export function shareImageTextCss() {
  if (cachedFontCss) return cachedFontCss;

  const faces = FONT_FILES.map((font) => {
    const data = readFontData(font.path);
    if (!data) return '';
    return `
          @font-face {
            font-family: '${FONT_FAMILY}';
            src: url(data:font/truetype;base64,${data}) format('truetype');
            font-weight: ${font.weight};
            font-style: normal;
          }`;
  }).filter(Boolean).join('\n');

  cachedFontCss = `
          ${faces}
          text {
            font-family: '${FONT_FAMILY}', 'Noto Sans Hebrew', Arial, sans-serif;
          }`;

  return cachedFontCss;
}
