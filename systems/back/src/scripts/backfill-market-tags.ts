/**
 * backfill-market-tags — one-time seed of the tag co-graph (migration 070) for
 * the markets that already exist. Idempotent: upserts tags + market_tags.
 *
 * Suggestions come from three curated sources (controlled vocabulary):
 *   1. the market's category  → one broad topic tag (always)
 *   2. its market_family_key  → recurring-series entity tags (FAMILY_TAGS)
 *   3. Hebrew keyword matches on the title (KEYWORD_TAGS)
 *
 * Eligibility mirrors the public surface: published markets in real categories,
 * excluding stress/systems/oracle-eol and test/sim/graph families. The dry-run
 * prints the full plan for OPERATOR REVIEW; nothing is written without --apply.
 *
 *   node --import tsx src/scripts/backfill-market-tags.ts           # dry run
 *   node --import tsx src/scripts/backfill-market-tags.ts --apply   # write
 */
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import {
  isMarketTagEligible,
  suggestMarketTags,
  tagIdForSlug,
  type MarketTagDefinition
} from "../markets/market-tags/tag-suggestions";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  const { rows } = await pool.query<{ id: string; category_key: string | null; market_family_key: string | null; title: string }>(
    `select id, category_key, market_family_key, title
       from markets
      where published_at is not null
      order by category_key, market_family_key nulls last, id`
  );

  const plan: { id: string; tags: ReturnType<typeof suggestMarketTags> }[] = [];
  const tagDefs = new Map<string, MarketTagDefinition>();
  let skipped = 0;
  for (const m of rows) {
    if (!isMarketTagEligible(m)) { skipped += 1; continue; }
    const tags = suggestMarketTags(m);
    if (!tags.length) { skipped += 1; continue; }
    for (const t of tags) tagDefs.set(t.def.slug, t.def);
    plan.push({ id: m.id, tags });
  }

  console.log(`\n=== BACKFILL PLAN (${apply ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`published: ${rows.length} | eligible+tagged: ${plan.length} | skipped: ${skipped} | distinct tags: ${tagDefs.size}\n`);
  const tally: Record<string, number> = {};
  for (const p of plan) {
    console.log(`  ${p.id}\n      ${p.tags.map((t) => `${t.def.label}[${t.def.slug}·w${t.weight}]`).join("  ")}`);
    for (const t of p.tags) tally[t.def.slug] = (tally[t.def.slug] ?? 0) + 1;
  }
  console.log(`\n=== TAG USAGE ===`);
  for (const [slug, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${tagDefs.get(slug)?.label}  (${slug})`);
  }

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    await pool.end();
    return;
  }

  await withTransaction(pool, async (tx) => {
    for (const def of tagDefs.values()) {
      await tx.query(
        `insert into tags (id, slug, label, kind) values ($1, $2, $3, $4)
           on conflict (slug) do update set label = excluded.label, kind = excluded.kind, updated_at = now()`,
        [tagIdForSlug(def.slug), def.slug, def.label, def.kind ?? null]
      );
    }
    for (const p of plan) {
      for (const t of p.tags) {
        await tx.query(
          `insert into market_tags (market_id, tag_id, weight) values ($1, $2, $3)
             on conflict (market_id, tag_id) do update set weight = excluded.weight`,
          [p.id, tagIdForSlug(t.def.slug), t.weight]
        );
      }
    }
  });
  console.log(`\nApplied: ${tagDefs.size} tags, ${plan.reduce((n, p) => n + p.tags.length, 0)} market_tags across ${plan.length} markets.\n`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
