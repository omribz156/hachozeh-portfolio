import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../../showcase-dist/', import.meta.url));
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}
const all = await files(root), hashes = new Set(), broken = [];
let pages = 0;
for (const file of all) {
  if (!file.endsWith('.html')) continue;
  pages++;
  const html = await readFile(file, 'utf8');
  const path = `/${relative(root, file).replace(/index\.html$/, '')}`;
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    if (node.tagName === 'script' && !attrs.src && !['application/json', 'application/ld+json'].includes(attrs.type)) {
      const script = (node.childNodes || []).map(c => c.value || '').join('');
      hashes.add(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    }
    for (const key of ['href', 'src']) {
      if (!attrs[key] || attrs[key].startsWith('#')) continue;
      const url = new URL(attrs[key], `https://hachozeh.com${path}`);
      if (url.origin !== 'https://hachozeh.com') continue;
      if (url.pathname.startsWith('/api/')) throw new Error(`API reference in HTML: ${path}`);
      const candidate = join(root, decodeURIComponent(url.pathname));
      broken.push({ from: path, target: url.pathname, candidate });
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
}
for (const link of broken) {
  try {
    const s = await stat(link.candidate);
    if (s.isDirectory()) await stat(join(link.candidate, 'index.html'));
  } catch { throw new Error(`Broken static link: ${link.from} -> ${link.target}`); }
}
const csp = ["default-src 'none'", `script-src 'self' ${[...hashes].join(' ')}`, "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'none'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"].join('; ');
if (csp.length > 7500) throw new Error('CSP is too large');
await writeFile(join(root, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()\n  Cache-Control: public, max-age=0, must-revalidate\n\n/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
await writeFile(join(root, '_redirects'), '/trending / 301\n/trending/ / 301\n');
await writeFile(join(root, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://hachozeh.com/sitemap.xml\n');
const paths = all.filter(f => f.endsWith('index.html')).map(f => `/${relative(root, f).replace(/index\.html$/, '')}`);
await writeFile(join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.filter(p => p !== '/trending/').map(p => `<url><loc>https://hachozeh.com${p}</loc></url>`).join('')}</urlset>`);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim());
const snapshot = JSON.parse(await readFile(new URL('../data/snapshot.json', import.meta.url), 'utf8'));
await writeFile(join(root, 'showcase-release.json'), `${JSON.stringify({ mode: 'static-showcase', revision, dirty, builtAt: new Date().toISOString(), capturedAt: snapshot.capturedAt, pages }, null, 2)}\n`);
console.log(`Sealed ${pages} pages; ${broken.length} local links/assets resolve; ${hashes.size} inline-script hashes; backend connections blocked by CSP.`);
