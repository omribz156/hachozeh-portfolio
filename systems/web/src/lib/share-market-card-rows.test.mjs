import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectResolvedEventWinner,
  selectShareMarketCardRows,
  shareMarketCardVersion,
} from './share-market-card-rows.js';

test('event share cards show only children still in contention', () => {
  const rows = selectShareMarketCardRows({
    current: {},
    outcomes: [],
    children: [
      {
        label: 'ספרד',
        status: 'open',
        outcomes: [{ side: 'yes', price: 0.46 }],
      },
      {
        label: 'ארגנטינה',
        status: 'open',
        outcomes: [{ side: 'yes', price: 0.61 }],
      },
      {
        label: 'צרפת',
        status: 'resolved',
        outcomes: [{ side: 'yes', price: 0.57 }],
      },
      {
        label: 'מרוקו',
        status: 'voided',
        outcomes: [{ side: 'yes', price: 0.5 }],
      },
    ],
  }, true);

  assert.deepEqual(rows, [
    { label: 'ספרד', probability: 0.46 },
    { label: 'ארגנטינה', probability: 0.61 },
  ]);
});

test('event share cards keep closed children that are still awaiting resolution', () => {
  const rows = selectShareMarketCardRows({
    current: {},
    outcomes: [],
    children: [
      {
        label: 'ספרד',
        status: 'closed',
        outcomes: [{ side: 'yes', price: 0.46 }],
      },
      {
        label: 'צרפת',
        status: 'resolved',
        outcomes: [{ side: 'yes', price: 0.57 }],
      },
    ],
  }, true);

  assert.deepEqual(rows, [{ label: 'ספרד', probability: 0.46 }]);
});

test('a terminal event share card selects the resolved yes winner', () => {
  const winner = selectResolvedEventWinner({
    children: [
      {
        label: 'ספרד',
        status: 'resolved',
        winner: 'no',
        outcomes: [{ side: 'yes', price: 0.46 }],
      },
      {
        label: 'ארגנטינה',
        status: 'resolved',
        winner: 'yes',
        outcomes: [{ side: 'yes', price: 0.61 }],
      },
    ],
  }, true);

  assert.equal(winner, 'ארגנטינה');
});

test('event share image version changes with child price or status', () => {
  const snapshot = {
    children: [
      {
        marketId: 'spain',
        label: 'ספרד',
        status: 'open',
        winner: null,
        outcomes: [{ side: 'yes', price: 0.46 }],
      },
      {
        marketId: 'argentina',
        label: 'ארגנטינה',
        status: 'open',
        winner: null,
        outcomes: [{ side: 'yes', price: 0.61 }],
      },
    ],
  };

  const initial = shareMarketCardVersion(snapshot, true);
  const priceChanged = shareMarketCardVersion({
    ...snapshot,
    children: snapshot.children.map((child) => (
      child.marketId === 'argentina'
        ? { ...child, outcomes: [{ side: 'yes', price: 0.62 }] }
        : child
    )),
  }, true);
  const statusChanged = shareMarketCardVersion({
    ...snapshot,
    children: snapshot.children.map((child) => (
      child.marketId === 'spain' ? { ...child, status: 'resolved', winner: 'no' } : child
    )),
  }, true);

  assert.match(initial, /^[a-f0-9]{12}$/);
  assert.notEqual(priceChanged, initial);
  assert.notEqual(statusChanged, initial);
});
