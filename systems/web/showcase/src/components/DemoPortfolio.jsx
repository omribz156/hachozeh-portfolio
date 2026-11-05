import { useState } from 'preact/hooks';
import { TotalCard, ChangeCard } from '../../../src/components/portfolio/PortfolioCards.jsx';
import PositionsTable from '../../../src/components/portfolio/PositionsTable.jsx';

export default function DemoPortfolio({ positions, change, summary }) {
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('value');
  const [sortDir, setSortDir] = useState('desc');
  return <>
    <div class="pf-top-fold"><TotalCard summary={summary} asOfLabel="תיק סינתטי · אינו שייך למשתמש" /><ChangeCard change={change} activeTimeframeId={range} pendingTf={null} onTimeframeSelect={setRange} /></div>
    <div class="pf-depth">
      <div class="pf-depth-bar"><h2>פוזיציות לדוגמה</h2><div class="pf-depth-search"><input type="search" aria-label="חיפוש בתיק לדוגמה" placeholder="חפש לפי שוק, תוצאה..." value={query} onInput={e => setQuery(e.currentTarget.value)} /></div></div>
      <PositionsTable positions={positions} searchQuery={query} sortBy={sortBy} sortDir={sortDir} onSort={key => { setSortBy(key); setSortDir(key === sortBy && sortDir === 'desc' ? 'asc' : 'desc'); }} />
    </div>
  </>;
}
