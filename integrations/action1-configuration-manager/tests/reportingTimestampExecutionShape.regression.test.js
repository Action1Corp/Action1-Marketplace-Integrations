const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scriptPath = path.join(__dirname, '..', 'reporting', 'configuration-management-control-status.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');
const wrapperPath = path.join(os.tmpdir(), `action1-cm-reporting-wrapper-${process.pid}.ps1`);

// Action1 evaluates a Data Source as script text inside a wrapper ScriptBlock.
// The preamble models wrapper-owned setup that precedes the published source.
const wrappedSource = `$ErrorActionPreference = 'Stop'\n${source}`;
fs.writeFileSync(wrapperPath, `& ([scriptblock]::Create(@'\n${wrappedSource}\n'@))`, 'utf8');

try {
  assert.doesNotThrow(() => childProcess.execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', wrapperPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }), 'published Data Source must execute when embedded after the Action1 wrapper preamble');
} finally {
  fs.rmSync(wrapperPath, { force: true });
}

console.log('Reporting timestamp execution-shape regression passed.');
