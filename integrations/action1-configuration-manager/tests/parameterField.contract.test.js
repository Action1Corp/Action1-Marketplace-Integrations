const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const sourcePath = path.join(__dirname, '..', 'ui', 'policies', 'ParameterField.jsx');
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /case ['"]boolean['"]/, 'ParameterField should render an explicit boolean branch');
  assert.match(source, /case ['"]integer['"]/, 'ParameterField should render an explicit integer branch');
  assert.match(source, /case ['"]enum['"]/, 'ParameterField should render an explicit enum branch');
  assert.match(source, /case ['"]string['"]/, 'ParameterField should render an explicit string branch');
  assert.match(source, /case ['"]multiline-string['"]/, 'ParameterField should render an explicit multiline-string branch');
  assert.match(source, /case ['"]time['"]/, 'ParameterField should render an explicit time branch');
  assert.match(source, /Unsupported parameter type/, 'ParameterField should show a blocking unsupported-type message');
  assert.doesNotMatch(source, /default:\s*return renderTextInput/i, 'ParameterField should not silently fall back to a generic text input');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
