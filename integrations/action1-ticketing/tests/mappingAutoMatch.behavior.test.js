const assert = require('assert');
const { normalizeAutoMatchName, classifyAutoMatches } = require('../mappingAutoMatch');

function run() {
  assert.strictEqual(normalizeAutoMatchName('  ACME   Corporation  '), 'acme corporation');
  assert.strictEqual(normalizeAutoMatchName('Northwind, Inc.'), 'northwind, inc.', 'punctuation and company suffixes remain part of the name');

  const exact = classifyAutoMatches(
    [{ id: 'org-1', name: ' Acme   Corporation ' }, { id: 'org-2', name: 'Missing Co' }],
    [{ id: 'dest-1', name: 'acme corporation' }], [], []
  );
  assert.strictEqual(exact.analyzedCount, 2);
  assert.deepStrictEqual(exact.exactMatches.map((match) => [match.action1OrgId, match.destinationId]), [['org-1', 'dest-1']]);
  assert.deepStrictEqual(exact.unmatched.map((row) => row.action1OrgId), ['org-2']);
  assert.deepStrictEqual(exact.ambiguous, []);

  const duplicateDestinations = classifyAutoMatches(
    [{ id: 'org-1', name: 'Acme' }],
    [{ id: 'dest-1', name: 'Acme' }, { id: 'dest-2', name: ' ACME ' }], [], []
  );
  assert.strictEqual(duplicateDestinations.exactMatches.length, 0);
  assert.strictEqual(duplicateDestinations.ambiguous[0].reason, 'duplicate_destination_names');

  const sourceCollision = classifyAutoMatches(
    [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: ' ACME ' }],
    [{ id: 'dest-1', name: 'Acme' }], [], []
  );
  assert.strictEqual(sourceCollision.ambiguous.length, 2, 'one destination matching multiple sources is ambiguous for each source');

  const assignedDestination = classifyAutoMatches(
    [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Contoso' }],
    [{ id: 'dest-1', name: 'Acme' }, { id: 'dest-2', name: 'Contoso' }],
    [{ id: 10, action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'dest-2', destinationName: 'Contoso' }], []
  );
  assert.strictEqual(assignedDestination.analyzedCount, 1);
  assert.strictEqual(assignedDestination.ambiguous[0].reason, 'destination_already_assigned');

  const draftExcluded = classifyAutoMatches(
    [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Contoso' }],
    [{ id: 'dest-1', name: 'Acme' }, { id: 'dest-2', name: 'Contoso' }], [], [
      { action1OrgId: 'org-1', action1OrgName: 'Acme', destinationId: 'dest-1', destinationName: 'Acme' },
      { action1OrgId: 'org-2', action1OrgName: 'Contoso' }
    ]
  );
  assert.strictEqual(draftExcluded.analyzedCount, 1, 'complete draft mappings are excluded');
  assert.strictEqual(draftExcluded.exactMatches[0].action1OrgId, 'org-2');
  assert.deepStrictEqual(draftExcluded.exactMatches[0].draftSnapshot, { id: null, action1OrgId: 'org-2', action1OrgName: 'Contoso', destinationId: '', destinationName: '' }, 'an incomplete source draft remains eligible and carries a safe apply snapshot');
}

try {
  run();
  console.log('Action1 Ticketing Auto Match classification behavior tests passed.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
