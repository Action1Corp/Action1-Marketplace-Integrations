const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const module = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'policies', 'controlStepCopy.js')).href);
  assert.strictEqual(module.controlsStepDescription({ packVersion: '0.7.0' }), 'Choose Control Families and Controls from Control Pack 0.7.0.');
  assert.strictEqual(module.controlsStepDescription({ packVersion: '0.8.0' }), 'Choose Control Families and Controls from Control Pack 0.8.0.');
  assert.strictEqual(module.controlsStepDescription({}), 'Choose Control Families and Controls from the released catalog metadata.');

  const editor = fs.readFileSync(path.join(__dirname, '..', 'ui', 'policies', 'PolicyEditorView.jsx'), 'utf8');
  assert(editor.includes('controlsStepDescription'), 'Create and Edit must use the shared dynamic Controls-step copy.');
}

run().catch((error) => { console.error(error); process.exit(1); });
