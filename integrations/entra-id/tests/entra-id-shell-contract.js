const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const integrationDir = path.join(root, 'integrations', 'entra-id');

function fileExists(relativePath) {
  return fs.existsSync(path.join(integrationDir, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(integrationDir, relativePath), 'utf8');
}

function main() {
  assert(fs.existsSync(integrationDir), 'entra-id: integration shell directory should exist');

  const requiredFiles = [
    'manifest.json',
    'display.json',
    'index.js',
    'actions.js',
    'ui/index.jsx',
    'ui/settingsSchema.json',
    'migrations/001_create_schema.sql',
    'README.md'
  ];

  for (const relativePath of requiredFiles) {
    assert(fileExists(relativePath), `entra-id: missing required shell file ${relativePath}`);
  }

  const manifest = JSON.parse(read('manifest.json'));
  assert.strictEqual(manifest.id, 'entra-id', 'entra-id: manifest id should match the folder name');

  const display = JSON.parse(read('display.json'));
  const uiIndexSource = read(path.join('ui', 'index.jsx'));
  for (const entry of display.navigation || []) {
    const quotedPath = `'${entry.path}'`;
    const unquotedPath = `${entry.path}:`;
    assert(
      uiIndexSource.includes(quotedPath) || uiIndexSource.includes(unquotedPath),
      `entra-id: display path ${entry.path} should have a matching ui/index.jsx export`
    );
  }

  const indexSource = read('index.js');
  assert(
    indexSource.includes("require('./actions')"),
    'entra-id: index.js should load action handlers from ./actions'
  );

  const handler = require(path.join(integrationDir, 'actions.js'));
  assert(handler.actions && typeof handler.actions === 'object', 'entra-id: actions.js should export an actions map');
  for (const action of manifest.actions || []) {
    assert.strictEqual(typeof handler.actions[action.id], 'function', `entra-id: action ${action.id} should have a handler`);
  }

  const migrationSource = read(path.join('migrations', '001_create_schema.sql'));
  assert(
    migrationSource.includes('entra_id_'),
    'entra-id: initial migration should use entra_id-prefixed integration-owned table names'
  );

  console.log('Entra ID shell contract tests passed.');
}

main();
