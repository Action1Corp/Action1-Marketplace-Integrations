const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const scriptPath = path.join(__dirname, '..', '_reference', 'marketplace-local', 'restart-marketplace.local.ps1');
  const source = fs.readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');

  assert(
    source.includes('$connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)'),
    'restart wrapper should normalize listener results to an array before counting them'
  );

  assert(
    source.includes('$owningProcesses = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)'),
    'restart wrapper should normalize expanded OwningProcess values to an array before reading .Count under StrictMode'
  );

  assert(
    !source.includes('$owningProcesses = $connections | Select-Object -ExpandProperty OwningProcess -Unique'),
    'restart wrapper should not leave OwningProcess expansion as a scalar pipeline result'
  );
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
