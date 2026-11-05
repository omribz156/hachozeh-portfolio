import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = `${root}/showcase/public`;
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// An allowlist, not a copy of the live public/ tree (which contains auth scripts).
for (const path of ['assets/brand', 'assets/currency', 'assets/images/market-buckets', 'favicon.ico', 'og-image.jpg', 'scripts/probability-chart-renderer.js', 'scripts/probability-chart-compact.js', 'scripts/market-detail-chart.js', 'scripts/components/pnl-sparkline-renderer.js']) {
  await mkdir(`${target}/${path.substring(0, path.lastIndexOf('/')) || '.'}`, { recursive: true });
  await cp(`${root}/public/${path}`, `${target}/${path}`, { recursive: true });
}
