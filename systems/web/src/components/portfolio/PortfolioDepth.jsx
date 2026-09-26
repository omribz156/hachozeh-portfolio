import { useState } from 'preact/hooks';
import PositionsTable from './PositionsTable.jsx';
import HistoryTable from './HistoryTable.jsx';
import { nextSortState } from './depth-shared.js';
import usePortfolioModel from './usePortfolioModel.js';
import { readParam, writeParam } from '../../lib/url-view-state.js';

// Owns the portfolio depth section — tab bar + search + the positions / history
// tables — and its local interaction state. Self-sufficient: reads the model
// from the SAME shared vanilla data layer the orchestrator uses
// (window.NaviPortfolio*), and refreshes on the same events. The data layer
// stays vanilla; only the view becomes Preact.
//
// Model + view + auth logic extracted into usePortfolioModel for reuse across
// card islands.

const TABS = [
  { id: 'positions', label: 'פוזיציות' },
  // orders ("הזמנות פתוחות") stays hidden until the feature ships.
  { id: 'history', label: 'היסטוריה' },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_TAB = 'positions';
const SEARCH_PLACEHOLDER = {
  positions: 'חפש לפי שוק, תוצאה...',
  history: 'חפש באירועים...',
};

export default function PortfolioDepth() {
  const { model } = usePortfolioModel();
  // Init FROM the URL at first render — never setState-after-mount, that
  // flashes the default tab before snapping to the requested one.
  const [activeTab, setActiveTab] = useState(() => readParam('tab', DEFAULT_TAB, TAB_IDS));
  const [searchQuery, setSearchQuery] = useState('');
  // Per-tab sort default — re-reads the same param so a deep link to
  // ?tab=history paints with the right sort from first render.
  const [sortBy, setSortBy] = useState(() => (readParam('tab', DEFAULT_TAB, TAB_IDS) === 'history' ? 'time' : 'value'));
  const [sortDir, setSortDir] = useState(null);

  function selectTab(id) {
    setActiveTab(id);
    setSearchQuery('');
    setSortBy(id === 'history' ? 'time' : 'value'); // per-tab default
    setSortDir(null);
    writeParam('tab', id, DEFAULT_TAB);
  }

  function handleSort(columnId) {
    const next = nextSortState({ sortBy, sortDir }, columnId);
    setSortBy(next.sortBy);
    setSortDir(next.sortDir);
  }

  // Signed-out / no model yet → render nothing; the orchestrator owns the gate
  // and loading states.
  if (!model) return null;

  return (
    <div class="pf-depth">
      <div class="pf-depth-bar">
        <div
          class="pf-tablist"
          role="tablist"
          onKeyDown={(e) => {
            const idx = TABS.findIndex((t) => t.id === activeTab);
            let next = idx;
            if (e.key === 'ArrowLeft')  { next = (idx + 1) % TABS.length; }
            else if (e.key === 'ArrowRight') { next = (idx - 1 + TABS.length) % TABS.length; }
            else if (e.key === 'Home')  { next = 0; }
            else if (e.key === 'End')   { next = TABS.length - 1; }
            else { return; }
            e.preventDefault();
            selectTab(TABS[next].id);
            // Move focus to the newly active tab button
            const tablistEl = e.currentTarget;
            const btns = tablistEl.querySelectorAll('[role="tab"]');
            if (btns[next]) btns[next].focus();
          }}
        >
          {TABS.map((t) => (
            <button
              class={`pf-tab ${t.id === activeTab ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={t.id === activeTab}
              onClick={() => selectTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <div class="pf-depth-search" data-portfolio-search>
          <span class="material-symbols-outlined pf-depth-search-icon" aria-hidden="true">search</span>
          <input
            aria-label="חיפוש בתיק"
            placeholder={SEARCH_PLACEHOLDER[activeTab]}
            type="search"
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="pf-depth-body">
        {activeTab === 'positions'
          ? <PositionsTable
              positions={model.positions}
              searchQuery={searchQuery}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          : <HistoryTable
              history={model.history}
              searchQuery={searchQuery}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />}
      </div>
    </div>
  );
}
