import assert from 'node:assert/strict';
import {
  buildMappingSavePlan,
  buildPersistRows,
  executeMappingSavePlan,
  isCurrentMappingRequest,
  mappingOptionsForRow
} from '../ui/mappingState.mjs';

const saved = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  action1OrgId: `org-${index + 1}`,
  action1OrgName: `Org ${index + 1}`,
  destinationId: `dest-${index + 1}`,
  destinationName: `Destination ${index + 1}`
}));

const refreshed = saved.map((row, index) => ({
  ...row,
  destinationName: index === 2 ? 'Renamed Destination' : row.destinationName
}));
refreshed.push({ id: null, action1OrgId: 'org-6', action1OrgName: 'Org 6', destinationId: 'dest-6', destinationName: 'Destination 6' });

const options = buildPersistRows(refreshed, refreshed.map(({ action1OrgId, action1OrgName }) => ({ id: action1OrgId, name: action1OrgName })), refreshed.map(({ destinationId, destinationName }) => ({ id: destinationId, name: destinationName })));
assert.deepEqual(options.errors, []);

const plan = buildMappingSavePlan(saved, options.persistRows);
assert.deepEqual(plan.deletes, [], 'label refresh plus a new row must not delete existing relationships');
assert.deepEqual(plan.saves.map((row) => row.id), [3, null], 'label update preserves ID and new mapping has no inherited ID');

const operations = [];
await executeMappingSavePlan(plan, {
  async delete(id) { operations.push(['delete', id]); },
  async save(row) { operations.push(['save', row.id, row.destinationId]); }
});
assert.deepEqual(operations, [['save', 3, 'dest-3'], ['save', null, 'dest-6']]);

assert.deepEqual(buildMappingSavePlan(saved, saved).saves, [], 'refresh without changed labels is read-only');
assert.equal(isCurrentMappingRequest({ providerId: 'provider-b', generation: 2 }, { providerId: 'provider-a', generation: 2 }), false, 'late results from another provider are discarded');
assert.equal(isCurrentMappingRequest({ providerId: 'provider-a', generation: 2 }, { providerId: 'provider-a', generation: 2 }), true);

const changedRelationship = [{ ...saved[0], destinationId: 'dest-new', destinationName: 'New Destination' }];
const replacementPlan = buildMappingSavePlan([saved[0]], changedRelationship);
assert.deepEqual(replacementPlan.deletes.map((row) => row.id), [saved[0].id]);
assert.equal(replacementPlan.saves[0].id, null, 'replacement cannot reuse the old mapping ID');

const retainedOptionRows = [{ id: 4, action1OrgId: 'org-4', action1OrgName: 'Old Org Label', destinationId: 'dest-4', destinationName: 'Old Destination Label' }];
assert.deepEqual(mappingOptionsForRow([], retainedOptionRows, 0, 'destinationId', 'destinationName'), [
  { value: 'dest-4', label: 'Old Destination Label', name: 'Old Destination Label' }
], 'failed discovery retains the saved destination selection');

const validation = buildPersistRows([
  { action1OrgId: '', destinationId: '' },
  { action1OrgId: 'org-1', destinationId: '' },
  { action1OrgId: 'org-1', action1OrgName: 'Org 1', destinationId: 'dest-1', destinationName: 'D1' },
  { action1OrgId: 'org-1', action1OrgName: 'Org 1', destinationId: 'dest-2', destinationName: 'D2' }
], [], []);
assert.equal(validation.persistRows.length, 2, 'wholly empty rows are ignored while complete rows remain candidates');
assert(validation.errors.some((message) => /incomplete/i.test(message)));
assert(validation.errors.some((message) => /Action1 organization.*once/i.test(message)));

const partial = [];
await assert.rejects(() => executeMappingSavePlan({ deletes: [{ id: 1 }], saves: [{ id: null }] }, {
  async delete(id) { partial.push(['delete', id]); },
  async save(row) { partial.push(['save', row.id]); throw new Error('controlled save failure'); }
}), /controlled save failure/);
assert.deepEqual(partial, [['delete', 1], ['save', null]], 'save sequence remains sequential and partial failures are not hidden');

console.log('Action1 Ticketing Mapping state behavior tests passed.');
