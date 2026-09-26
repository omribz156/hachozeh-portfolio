import type { Queryable } from "../../db/client/pool";
import {
  suggestMarketTags,
  tagIdForSlug,
  type MarketTagSuggestionInput,
  type SuggestedMarketTag
} from "./tag-suggestions";

export async function upsertSuggestedMarketTags(
  client: Queryable,
  market: MarketTagSuggestionInput
): Promise<SuggestedMarketTag[]> {
  const tags = suggestMarketTags(market);

  for (const { def } of tags) {
    await client.query(
      `
        insert into tags (id, slug, label, kind)
        values ($1, $2, $3, $4)
        on conflict (slug) do update
        set label = excluded.label,
            kind = excluded.kind,
            updated_at = now()
      `,
      [tagIdForSlug(def.slug), def.slug, def.label, def.kind ?? null]
    );
  }

  for (const tag of tags) {
    await client.query(
      `
        insert into market_tags (market_id, tag_id, weight)
        values ($1, $2, $3)
        on conflict (market_id, tag_id) do update
        set weight = excluded.weight
      `,
      [market.id, tagIdForSlug(tag.def.slug), tag.weight]
    );
  }

  return tags;
}
