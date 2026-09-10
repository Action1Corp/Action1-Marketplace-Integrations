const fs = require('fs');
const path = require('path');

const PACK_ID = 'windows-endpoint-configuration';
const artifactCache = new Map();

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Control Pack ${label} is missing or invalid: ${error.message}`);
  }
}

function defaultPackRoot() {
  return path.join(__dirname, 'control-packs', PACK_ID);
}

function resolveControlPack(options = {}) {
  const packRoot = options.packRoot || defaultPackRoot();
  let entries;
  try {
    entries = fs.readdirSync(packRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (error) {
    throw new Error(`Control Pack root is missing or unreadable: ${error.message}`);
  }

  if (entries.length !== 1) {
    throw new Error(`Control Pack root must contain exactly one release directory; found ${entries.length}.`);
  }

  const releaseDirectory = entries[0].name;
  const releaseRoot = path.join(packRoot, releaseDirectory);
  const pack = readJson(path.join(releaseRoot, 'pack.json'), 'pack.json');
  const packVersion = typeof pack.packVersion === 'string' ? pack.packVersion.trim() : '';

  if (pack.packId !== PACK_ID) {
    throw new Error(`Control Pack packId must be ${PACK_ID}.`);
  }
  if (!packVersion) {
    throw new Error('Control Pack packVersion is required.');
  }
  if (releaseDirectory !== packVersion) {
    throw new Error(`Control Pack release directory ${releaseDirectory} must match packVersion ${packVersion}.`);
  }

  return { packId: PACK_ID, packVersion, releaseRoot, pack };
}

function loadControlPackArtifacts(options = {}) {
  const resolved = resolveControlPack(options);
  const cached = artifactCache.get(resolved.releaseRoot);
  if (cached) return cached;
  const catalog = readJson(path.join(resolved.releaseRoot, 'control-catalog.json'), 'control-catalog.json');
  const baselinesArtifact = readJson(path.join(resolved.releaseRoot, 'baselines.json'), 'baselines.json');

  if (catalog.packId !== resolved.packId || catalog.packVersion !== resolved.packVersion) {
    throw new Error('Control Pack control-catalog.json identity does not match pack.json.');
  }
  if (!Array.isArray(baselinesArtifact.baselines)) {
    throw new Error('Control Pack baselines.json must contain a baselines array.');
  }

  const artifacts = { ...resolved, catalog, baselinesArtifact };
  artifactCache.set(resolved.releaseRoot, artifacts);
  return artifacts;
}

module.exports = { PACK_ID, resolveControlPack, loadControlPackArtifacts };
