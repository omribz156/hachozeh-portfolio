const params = new URLSearchParams(location.search);
const feed = document.querySelector('[data-archive-feed]');
if (feed) {
  const stream = feed.querySelector('[data-market-stream]');
  const cards = [...stream.querySelectorAll('.hz-card')];
  const inputs = [...document.querySelectorAll('input[name=q]')];
  let category = params.get('category') || '';
  let query = params.get('q') || '';
  const sort = feed.querySelector('[data-sort]');
  if ([...sort.options].some(o => o.value === params.get('sort'))) sort.value = params.get('sort');
  function update() {
    const search = query.trim().toLocaleLowerCase('he');
    for (const card of cards) card.hidden = Boolean(category && card.dataset.category !== category) || !card.textContent.toLocaleLowerCase('he').includes(search);
    feed.querySelector('[data-empty]').hidden = cards.some(c => !c.hidden);
    feed.querySelector('.hz-trending__hero-zone')?.toggleAttribute('hidden', Boolean(category || search));
    document.querySelectorAll('[data-category-filter]').forEach(button => {
      const active = button.dataset.categoryFilter === category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    inputs.forEach(input => { if (input.value !== query) input.value = query; });
    const ordered = [...cards];
    if (sort.value === 'volume') ordered.sort((a, b) => Number(b.dataset.volume) - Number(a.dataset.volume));
    if (sort.value === 'new') ordered.sort((a, b) => Number(b.dataset.publishedAt) - Number(a.dataset.publishedAt));
    if (sort.value === 'closing') ordered.sort((a, b) => Number(a.dataset.closeAt) - Number(b.dataset.closeAt));
    ordered.forEach(card => stream.append(card));
    const url = new URL(location.href);
    for (const [key, value] of [['category', category], ['q', query], ['sort', sort.value === 'trending' ? '' : sort.value]]) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.replaceState(null, '', url);
  }
  document.querySelectorAll('[data-category-filter]').forEach(button => button.addEventListener('click', () => { category = button.dataset.categoryFilter; update(); }));
  inputs.forEach(input => { input.value = query; input.addEventListener('input', () => { query = input.value; update(); }); input.form.addEventListener('submit', event => { event.preventDefault(); update(); }); });
  sort.addEventListener('change', update);
  update();
  if (params.has('search')) inputs.find(input => input.getClientRects().length)?.focus();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-quickbuy]');
  if (button) {
    const key = button.dataset.quickbuyMarketKey;
    if (key) location.assign(`/markets/${encodeURIComponent(key)}/`);
  }
  const bookmark = event.target.closest('.hz-card__bookmark');
  if (bookmark) {
    const pressed = bookmark.getAttribute('aria-pressed') !== 'true';
    bookmark.setAttribute('aria-pressed', String(pressed));
    bookmark.title = pressed ? 'סומן לביקור זה' : 'סימון לביקור זה';
  }
});
