-- Repair stale market_contract image paths written before the systems/front →
-- systems/design rename. Seer stamped image.src as
-- /systems/front/assets/images/market-buckets/*.svg; the web server now serves
-- those files from /assets/images/market-buckets/*.svg, so every stamped path
-- 404s. Replace the prefix in-place, preserving all other image JSON fields.

update markets
set
  market_contract = jsonb_set(
    market_contract,
    '{image,src}',
    to_jsonb(
      replace(
        market_contract -> 'image' ->> 'src',
        '/systems/front/assets/images/',
        '/assets/images/'
      )
    )
  ),
  updated_at = now()
where market_contract -> 'image' ->> 'src' like '/systems/front/assets/images/%';
