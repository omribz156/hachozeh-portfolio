// dev-build-serve — the single prod-faithful dev loop.
//
// Replaces `astro dev` for day-to-day work. `astro dev` hot-reloads but injects
// CSS via JS (a dev-only unstyled flash) and exposes Vite /@fs paths — not safe
// to put behind the dev tunnel and not a true mirror of prod. This instead runs
// the PRODUCTION build (the same artifact prod serves) and rebuilds + restarts
// it whenever you save a file under src/ or public/. You edit →
// ~couple-second rebuild → refresh. One environment, prod-accurate, no flash.
//
// Topology: dev.hachozeh.com → tunnel → Caddy :6969 (catch-all) → this server
// on :4321 (full app) + /api → backend :3001. See Caddyfile.mac-proof.
//
// Node built-ins only (fs.watch recursive) — no extra deps.

import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const watchDirs = [
  join(webRoot, 'src'),
  join(webRoot, 'public'),
];
// npm workspaces hoists the astro bin shim to the repo root unless a version
// conflict forces it local — resolve whichever exists instead of hardcoding
// the workspace path (a root-level install once evicted the local shim and
// crash-looped this orchestrator with spawn ENOENT).
const repoRoot = join(webRoot, '..', '..');
const astroCliCandidates = [
  join(webRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'),
  join(repoRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'),
];
const astroCli = astroCliCandidates.find((p) => existsSync(p));
if (!astroCli) {
  console.error(`[dev-build-serve] astro cli not found at: ${astroCliCandidates.join(' | ')}`);
  process.exit(1);
}
const entry = join(webRoot, 'dist', 'server', 'entry.mjs');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || '4321';
const DEBOUNCE_MS = 250;

let server = null;
let building = false;
let queued = false;
let debounce = null;
let crashRespawns = [];

const log = (msg) => console.log(`[dev-build-serve] ${msg}`);

function build() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    log('building…');
    const proc = spawn(process.execPath, [astroCli, 'build'], { cwd: webRoot, stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) log(`build ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      else log(`build FAILED (exit ${code}) — keeping last good server up`);
      resolve(code === 0);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const old = server;
    server = null;
    old.once('exit', resolve);
    old.kill('SIGTERM');
  });
}

function startServer() {
  if (server) return;
  server = spawn(process.execPath, [entry], {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, HOST, PORT },
  });
  server.on('exit', (code, signal) => {
    server = null;
    if (process.platform === 'win32' && code === 0) {
      log('server process handed off on Windows');
      return;
    }
    if (signal === 'SIGTERM') return; // deliberate restart — restartServer() respawns

    // Unexpected death: respawn now, not on the next file save. launchd only
    // supervises THIS process, so a dead child would otherwise leave :4321
    // down while the agent still reads "running". If the server crash-loops,
    // exit instead and let the supervisor's throttle own the backoff.
    const now = Date.now();
    crashRespawns = crashRespawns.filter((t) => now - t < 60_000);
    crashRespawns.push(now);
    if (crashRespawns.length > 5) {
      log(`server crash-looping (${crashRespawns.length} exits/min) — exiting for supervisor backoff`);
      process.exit(1);
    }
    log(`server exited (code ${code}) — respawning in 1s`);
    setTimeout(() => {
      if (!server && !building) startServer();
    }, 1000);
  });
  log(`serving build on http://${HOST}:${PORT}`);
}

async function rebuildAndRestart() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  // Astro rewrites dist/ during build. Keeping the old SSR child alive while
  // chunks are deleted causes route-specific ERR_MODULE_NOT_FOUND 500s
  // (portfolio/market/settings) even when /trending still looks healthy.
  await stopServer();
  const ok = await build();
  if (ok) startServer();
  else if (existsSync(entry)) startServer();
  building = false;
  if (queued) {
    queued = false;
    rebuildAndRestart();
  }
}

// initial build + serve
log('initial build…');
await build();
startServer();

// watch source recursively; debounce bursts (editors write several events)
for (const dir of watchDirs) {
  log(`watching ${dir} — save a file to rebuild`);
  watch(dir, { recursive: true }, (_event, filename) => {
    if (filename && (filename.endsWith('~') || filename.includes('.DS_Store'))) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      log(`change: ${filename} → rebuild`);
      rebuildAndRestart();
    }, DEBOUNCE_MS);
  });
}

// clean shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('shutting down');
    if (server) server.kill('SIGTERM');
    process.exit(0);
  });
}
