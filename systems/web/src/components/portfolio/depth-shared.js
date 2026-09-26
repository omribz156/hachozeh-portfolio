// Framework-agnostic sort/filter helpers shared by the depth tables
// (PositionsTable, HistoryTable). Lifted verbatim from the vanilla
// positions-tab.js / history-tab.js so the sort + search semantics can't drift
// during the Preact migration. Pure functions — no DOM, no Preact.

// applySort(rows, sortBy, sortDir, sortKeys, fallbackKey)
//   sortKeys: { [columnId]: { fn(row), defaultDir: 'asc'|'desc', type: 'string'|'number' } }
//   Returns a sorted COPY. String columns localeCompare in Hebrew; numeric
//   columns coerce null/NaN → 0. Direction falls back to the column default.
export function applySort(rows, sortBy, sortDir, sortKeys, fallbackKey) {
  const cfg = sortKeys[sortBy] || sortKeys[fallbackKey];
  const dir = sortDir || cfg.defaultDir;
  return [...rows].sort((a, b) => {
    const ka = cfg.fn(a);
    const kb = cfg.fn(b);
    if (cfg.type === 'string') {
      const cmp = String(ka).localeCompare(String(kb), 'he');
      return dir === 'asc' ? cmp : -cmp;
    }
    const numA = ka || 0;
    const numB = kb || 0;
    return dir === 'asc' ? numA - numB : numB - numA;
  });
}

// applySearch(rows, query, fields)
//   fields: array of field names read off each row; case-insensitive contains.
//   Empty/whitespace query → returns rows unchanged.
export function applySearch(rows, query, fields) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    fields
      .map((f) => row[f])
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle))
  );
}

// The two columns whose sort direction the header toggles: given a click on a
// column, returns the next { sortBy, sortDir }. Same column → flip direction
// (default 'desc' on first flip); different column → switch and reset to the
// column's default direction (sortDir = null).
export function nextSortState(current, columnId) {
  if (current.sortBy === columnId) {
    return { sortBy: columnId, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { sortBy: columnId, sortDir: null };
}
