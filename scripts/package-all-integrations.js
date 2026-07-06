#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const integrationsDir = path.join(repoRoot, 'integrations');
const outputDir = path.resolve(process.argv[2] || path.join(repoRoot, 'dist', 'integrations'));

fs.mkdirSync(outputDir, { recursive: true });

const packageable = fs.readdirSync(integrationsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .filter(entry => !entry.name.startsWith('_'))
  .filter(entry => fs.existsSync(path.join(integrationsDir, entry.name, 'manifest.json')))
  .sort((a, b) => a.name.localeCompare(b.name));

if (packageable.length === 0) {
  throw new Error('No integration packages found.');
}

const results = [];
for (const entry of packageable) {
  const integrationDir = path.join(integrationsDir, entry.name);
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'package-integration.js'),
    integrationDir,
    outputDir
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Failed packaging ${entry.name}.`);
  }

  const jsonStart = result.stdout.lastIndexOf('{');
  if (jsonStart >= 0) {
    results.push(JSON.parse(result.stdout.slice(jsonStart)));
  }
}

const index = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  integrations: results.map(result => ({
    id: result.id,
    version: result.version,
    package: path.basename(result.package),
    sha256: result.sha256
  }))
};

fs.writeFileSync(path.join(outputDir, 'packages.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Packaged ${results.length} integration(s) into ${outputDir}`);
