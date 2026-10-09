import test from 'node:test';
import assert from 'node:assert/strict';

import { getArchivedFetchPlan } from './archiveAccess.js';

test('owner sees archived staff and clinical records', () => {
  const plan = getArchivedFetchPlan('owner');
  assert.deepEqual(plan, [
    'appointments',
    'users',
    'operations',
    'clinical-records',
    'claim-stubs',
  ]);
});

test('optometrist sees their archived records without staff accounts', () => {
  const plan = getArchivedFetchPlan('optometrist');
  assert.deepEqual(plan, ['appointments', 'clinical-records', 'claim-stubs']);
});

test('eye care assistant sees their archived patient records', () => {
  const plan = getArchivedFetchPlan('eye-care-assistant');
  assert.deepEqual(plan, ['appointments', 'clinical-records', 'claim-stubs']);
});
