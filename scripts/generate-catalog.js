#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packageDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'integrations'));
const outputPath = path.resolve(process.argv[3] || path.join(packageDir, 'catalog.json'));
const baseUrl = String(process.env.INTEGRATION_PACKAGE_BASE_URL || '').replace(/\/+$/, '');
const releaseNotesUrl = process.env.INTEGRATION_RELEASE_NOTES_URL || 'https://github.com/Action1Corp/Action1-Marketplace-Integrations/releases';

if (!fs.existsSync(packageDir)) {
  throw new Error(`Package directory not found: ${packageDir}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSha(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\s+/)[0];
}

const integrations = [];
for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.tgz')) continue;

  const packagePath = path.join(packageDir, entry.name);
  const manifestPath = `${packagePath}.manifest.json`;
  const shaPath = `${packagePath}.sha256`;
  if (!fs.existsSync(manifestPath) || !fs.existsSync(shaPath)) {
    throw new Error(`Missing manifest or SHA sidecar for ${entry.name}`);
  }

  const manifest = readJson(manifestPath);
  integrations.push({
    id: manifest.id,
    name: manifest.name,
    vendor: manifest.vendor,
    description: manifest.description,
    category: manifest.category,
    latestVersion: manifest.version,
    minimumMarketplaceVersion: manifest.minimumMarketplaceVersion || '1.0.0',
    status: manifest.status || 'production',
    hasDocumentation: true,
    releaseNotesUrl: manifest.releaseNotesUrl || releaseNotesUrl,
    package: {
      url: baseUrl ? `${baseUrl}/${entry.name}` : entry.name,
      sha256: readSha(shaPath),
      signatureUrl: ''
    }
  });
}

integrations.sort((a, b) => a.id.localeCompare(b.id));

const catalog = {
  schemaVersion: 1,
  publishedAt: new Date().toISOString(),
  integrations
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
