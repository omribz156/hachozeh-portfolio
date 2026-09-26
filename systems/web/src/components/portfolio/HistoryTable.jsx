import { applySearch } from './depth-shared.js';
import { VShekelText } from '../currency/VShekel.jsx';

// 1:1 port of public/scripts/portfolio/history-tab.js — same columns, classes,
// search fields, and empty state. Sort stays delegated to the vanilla
// view-model's sortHistory (data layer unchanged); relative time + cash labels
// come from the shared formatters global.

const SEARCH_FIELDS = ['marketTitle', 'description', 'typeChipLabel', 'outcomeChipLabel'];
const SORT_DEFAULTS = { type: 'asc', market: 'asc', amount: 'desc', time: 'desc' };

function SortIcon({ columnId, sortBy, sortDir }) {
  if (columnId !== sortBy) {
    return <span class="material-symbols-outlined pf-sort-icon">unfold_more</span>;
  }
  const dir = sortDir || SORT_DEFAULTS[sortBy] || 'desc';
  return (
    <span class="material-symbols-outlined pf-sort-icon pf-sort-icon--active">
      {dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}
    </span>
  );
}

function Header({ columnId, label, sortBy, sortDir, onSort }) {
  return (
    <button
      class={`pf-position-header ${columnId === sortBy ? 'is-active' : ''}`}
      data-portfolio-sort={columnId}
      type="button"
      role="columnheader"
      onClick={() => onSort(columnId)}
    >{label}<SortIcon columnId={columnId} sortBy={sortBy} sortDir={sortDir} /></button>
  );
}

function EventRow({ event }) {
  const f = window.NaviPortfolioFormatters;
  const relativeLabel = f.formatHebrewRelative(event.occurredAt);
  const marketHref = event.marketKey ? `/markets/${encodeURIComponent(event.marketKey)}` : '/';
  return (
    <li class="pf-history-row" role="row">
      <div class="pf-history-cell pf-history-cell--type" role="cell">
        <span class={`pf-state-chip pf-tone-${event.typeChipTone}`}>{event.typeChipLabel}</span>
      </div>
      <div class="pf-history-cell pf-history-cell--market" role="cell">
        <a class="pf-history-market-link" href={marketHref}>
          <span class="pf-history-market-title" title={event.marketTitle}>{event.marketTitle}</span>
          <span class="pf-history-market-sub">
            {event.outcomeChipLabel
              ? <span class="pf-state-chip pf-tone-info">{event.outcomeChipLabel}</span>
              : null}
            {event.quantityLabel
              ? <span class="pf-history-quantity">{event.quantityLabel}</span>
              : null}
          </span>
        </a>
      </div>
      <div class="pf-history-cell pf-history-cell--time" role="cell">
        <span class="pf-history-time">{relativeLabel}</span>
      </div>
      <div class="pf-history-cell pf-history-cell--amount" role="cell">
        <span class="pf-history-amount"><VShekelText text={event.cashLabel} /></span>
      </div>
    </li>
  );
}

export default function HistoryTable({ history, searchQuery, sortBy, sortDir, onSort }) {
  const vm = window.NaviPortfolioViewModel;
  if (!vm?.sortHistory) return null; // defensive: data layer must be present
  let visible = vm.sortHistory(history, sortBy, sortDir);
  visible = applySearch(visible, searchQuery, SEARCH_FIELDS);

  if (visible.length === 0) {
    return <div class="pf-empty pf-empty--padded">אין אירועים להצגה.</div>;
  }

  return (
    <div class="pf-history" role="table" aria-label="פעילות">
      <div class="pf-history-head" role="row">
        <Header columnId="type" label="סוג" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="market" label="שוק" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="time" label="זמן" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="amount" label="סכום" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
      </div>
      <ul class="pf-history-list" role="rowgroup">
        {visible.map((e, i) => <EventRow key={e.id || i} event={e} />)}
      </ul>
    </div>
  );
}
