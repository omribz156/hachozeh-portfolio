import { useState, useEffect } from 'preact/hooks';

// Hydration-order note: both OutcomeLadder and ResolvedRail are client:load,
// so they hydrate in DOM order (OutcomeLadder comes first in the page).
// The useEffect here runs after mount — by then OutcomeLadder has already
// hydrated and its rows are in the DOM. The querySelector for
// [data-hz-outcome-ladder] [data-outcome-row] therefore finds live elements.

export default function ResolvedRail({ winnerLabel = '' }) {
  // verdict and name are reactive so clicking a row rerenders the display.
  const [verdict, setVerdict] = useState('תוצאה: כן');
  const [name, setName] = useState(winnerLabel);

  useEffect(() => {
    // Mirror of the inline <script> from ResolvedRail.astro.
    const rows = Array.from(
      document.querySelectorAll('[data-hz-outcome-ladder] [data-outcome-row]'),
    );
    if (!rows.length) return; // binary resolved: no outcome ladder → winner-only

    function show(row) {
      const won = row.classList.contains('hz-outcome-row--winner');
      setVerdict('תוצאה: ' + (won ? 'כן' : 'לא'));
      setName(row.querySelector('.hz-outcome-row__title')?.textContent?.trim() || '');
      rows.forEach((r) =>
        r.classList.toggle('hz-outcome-row--rail-active', r === row),
      );
    }

    rows.forEach((row) => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => show(row));
    });

    const winner = rows.find((r) => r.classList.contains('hz-outcome-row--winner'));
    if (winner) {
      winner.classList.add('hz-outcome-row--rail-active');
      // Sync initial state to the winner row's label so name is consistent
      // even if winnerLabel prop was undefined.
      const won = winner.classList.contains('hz-outcome-row--winner');
      setVerdict('תוצאה: ' + (won ? 'כן' : 'לא'));
      setName(winner.querySelector('.hz-outcome-row__title')?.textContent?.trim() || winnerLabel);
    }

    // Cleanup: remove click listeners on unmount.
    return () => {
      rows.forEach((row) => {
        // Clone-replace to shed the anonymous listener without a ref.
        // Since this component rarely unmounts, the overhead is negligible.
        const clone = row.cloneNode(true);
        row.parentNode?.replaceChild(clone, row);
      });
    };
  }, []);

  return (
    <div class="hz-resolved-rail" data-resolved-rail>
      <span class="hz-resolved-rail__check" aria-hidden="true">✓</span>
      <span class="hz-resolved-rail__verdict" data-rail-verdict>{verdict}</span>
      <span class="hz-resolved-rail__name" data-rail-name>{name}</span>
    </div>
  );
}
