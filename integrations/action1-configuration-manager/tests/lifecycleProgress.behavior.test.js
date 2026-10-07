const assert = require('assert');
const { PREFIX, progressCheckpoint } = require('../lifecycleProgress');

const operationId = '11111111-2222-4333-8444-555555555555';
const checkpoint = progressCheckpoint({ operation: 'create', completed: 3, total: 7, operationId });
assert(checkpoint.startsWith(`${PREFIX} `));
const payload = JSON.parse(checkpoint.slice(PREFIX.length + 1));
assert.deepStrictEqual(payload, { operation: 'create', completed: 3, total: 7, operationId });
assert(!Object.keys(payload).some((key) => /policy|endpoint|automation.?id|secret|token/i.test(key)));
assert.strictEqual(progressCheckpoint({ operation: 'delete', completed: 0, total: 0 }), `${PREFIX} {"operation":"delete","completed":0,"total":0}`);
assert.strictEqual(progressCheckpoint({ operation: 'create', completed: 2, total: 1 }), null);
console.log('Configuration Manager lifecycle progress checkpoint behavior passed.');
