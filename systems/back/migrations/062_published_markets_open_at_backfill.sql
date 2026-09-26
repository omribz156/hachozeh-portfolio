update markets
set open_at = published_at,
    updated_at = now()
where published_at is not null
  and published_at < close_at
  and open_at is distinct from published_at;
