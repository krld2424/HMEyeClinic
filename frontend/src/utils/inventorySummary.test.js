import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeInventoryByBrand } from './inventorySummary.js';

test('totals stored beginning and ending balances for each brand', () => {
  const records = [
    { data: { brand: 'ZETA', beginningBalance: 8, receipt: 100, sold: 90, endingBalance: 12 } },
    { data: { brand: 'ALPHA', beginningBalance: 4, endingBalance: 3 } },
    { data: { brand: 'ZETA', beginningBalance: 2, receipt: 1, sold: 1, endingBalance: 5 } },
  ];

  assert.deepEqual(summarizeInventoryByBrand(records), [
    { brand: 'ALPHA', beginningBalance: 4, endingBalance: 3 },
    { brand: 'ZETA', beginningBalance: 10, endingBalance: 17 },
  ]);
});

test('omits records without a brand or stored balances instead of inventing totals', () => {
  const records = [
    { data: { beginningBalance: 5, endingBalance: 5 } },
    { data: { brand: 'MISSING ENDING', beginningBalance: 3 } },
    { data: { brand: 'MISSING BEGINNING', endingBalance: 2 } },
    { data: { brand: 'VALID ZERO', beginningBalance: 0, endingBalance: 0 } },
    { data: { brand: 'VALID ZERO', material: 'SUBTOTAL', beginningBalance: 5, endingBalance: 4 } },
  ];

  assert.deepEqual(summarizeInventoryByBrand(records), [
    { brand: 'VALID ZERO', beginningBalance: 0, endingBalance: 0 },
  ]);
});
