import test from 'node:test';
import assert from 'node:assert/strict';

import { parseInventoryImportRows } from './inventoryImport.js';

const brands = ['ADIDAS', 'HYPE!'];
const materials = ['Acetate', 'TR90'];

test('parses columns by name, allows blank color, and defaults blank movement counts', () => {
  const records = parseInventoryImportRows([
    ['Item Code', 'Material', 'Brand', 'Color', 'Color Code', 'Beginning Balance', 'Receipt', 'Sold'],
    [' A-101 ', 'acetate', 'adidas', '', 'C1', 5, '', ''],
  ], brands, materials);

  assert.deepEqual(records, [{
    brand: 'ADIDAS',
    material: 'Acetate',
    itemCode: 'A-101',
    colorCode: 'C1',
    color: '',
    beginningBalance: 5,
    receipt: 0,
    sold: 0,
    endingBalance: 5,
  }]);
});

test('rejects missing required columns', () => {
  assert.throws(
    () => parseInventoryImportRows([['Brand', 'Material']], brands, materials),
    /Missing required columns/,
  );
});

test('rejects empty inventory data', () => {
  assert.throws(
    () => parseInventoryImportRows([['Brand', 'Material', 'Item Code', 'Color Code', 'Color', 'Beginning Balance', 'Receipt', 'Sold']], brands, materials),
    /no inventory rows/,
  );
});

test('rejects blank beginning balance', () => {
  assert.throws(
    () => parseInventoryImportRows([
      ['Brand', 'Material', 'Item Code', 'Color Code', 'Color', 'Beginning Balance', 'Receipt', 'Sold'],
      ['ADIDAS', 'Acetate', 'A-101', 'C1', '', '', '', ''],
    ], brands, materials),
    /non-negative numbers on row 2/,
  );
});

test('accepts blank color codes for different color variants', () => {
  const records = parseInventoryImportRows([
    ['Brand', 'Material', 'Item Code', 'Color Code', 'Color', 'Beginning Balance', 'Receipt', 'Sold'],
    ['HYPE!', 'TR90', 'A-101', '', 'Black', 1, '', ''],
    ['HYPE!', 'TR90', 'A-101', '', 'Rosegold', 2, '', ''],
  ], brands, materials);

  assert.deepEqual(records.map(({ colorCode, color }) => ({ colorCode, color })), [
    { colorCode: '', color: 'Black' },
    { colorCode: '', color: 'Rosegold' },
  ]);
});