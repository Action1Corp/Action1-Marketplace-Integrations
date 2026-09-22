const fs = require('fs');
const path = require('path');
const { writeAction1RuntimeLog } = require('./runtimeLogging');

const PACK_ID = 'windows-endpoint-configuration';
const artifactCache = new Map();

function log(options, level, message) {
  void writeAction1RuntimeLog(options?.context || options, level, message);
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 240);
}

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
  log(options, 'debug', `Control Pack discovery started | root="${packRoot}"`);
  let entries;
  try {
    entries = fs.readdirSync(packRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (error) {
    log(options, 'error', `Control Pack load failed | stage=discovery | root="${packRoot}" | error="${safeError(error)}"`);
    throw new Error(`Control Pack root is missing or unreadable: ${error.message}`);
  }

  if (entries.length !== 1) {
    log(options, 'error', `Control Pack load failed | stage=discovery | root="${packRoot}" | error="expected exactly one release directory; found ${entries.length}"`);
    throw new Error(`Control Pack root must contain exactly one release directory; found ${entries.length}.`);
  }

  const releaseDirectory = entries[0].name;
  const releaseRoot = path.join(packRoot, releaseDirectory);
  let pack;
  try {
    pack = readJson(path.join(releaseRoot, 'pack.json'), 'pack.json');
  } catch (error) {
    log(options, 'error', `Control Pack load failed | stage=pack-parsing | root="${packRoot}" | error="${safeError(error)}"`);
    throw error;
  }
  const packVersion = typeof pack.packVersion === 'string' ? pack.packVersion.trim() : '';

  if (pack.packId !== PACK_ID) {
    log(options, 'error', `Control Pack load failed | stage=pack-validation | root="${packRoot}" | error="packId must be ${PACK_ID}"`);
    throw new Error(`Control Pack packId must be ${PACK_ID}.`);
  }
  if (!packVersion) {
    log(options, 'error', `Control Pack load failed | stage=pack-validation | root="${packRoot}" | error="packVersion is required"`);
    throw new Error('Control Pack packVersion is required.');
  }
  if (releaseDirectory !== packVersion) {
    log(options, 'error', `Control Pack load failed | stage=pack-validation | root="${packRoot}" | error="release directory ${releaseDirectory} does not match packVersion ${packVersion}"`);
    throw new Error(`Control Pack release directory ${releaseDirectory} must match packVersion ${packVersion}.`);
  }

  return { packId: PACK_ID, packVersion, releaseRoot, pack };
}

function loadControlPackArtifacts(options = {}) {
  const resolved = resolveControlPack(options);
  const cached = artifactCache.get(resolved.releaseRoot);
  if (cached) return cached;
  let catalog;
  let baselinesArtifact;
  try {
    catalog = readJson(path.join(resolved.releaseRoot, 'control-catalog.json'), 'control-catalog.json');
    baselinesArtifact = readJson(path.join(resolved.releaseRoot, 'baselines.json'), 'baselines.json');
  } catch (error) {
    log(options, 'error', `Control Pack load failed | stage=artifact-parsing | root="${resolved.releaseRoot}" | error="${safeError(error)}"`);
    throw error;
  }

  if (catalog.packId !== resolved.packId || catalog.packVersion !== resolved.packVersion) {
    log(options, 'error', `Control Pack load failed | stage=catalog-validation | root="${resolved.releaseRoot}" | error="catalog identity does not match pack.json"`);
    throw new Error('Control Pack control-catalog.json identity does not match pack.json.');
  }
  if (!Array.isArray(baselinesArtifact.baselines)) {
    log(options, 'error', `Control Pack load failed | stage=baseline-validation | root="${resolved.releaseRoot}" | error="baselines.json must contain a baselines array"`);
    throw new Error('Control Pack baselines.json must contain a baselines array.');
  }

  const artifacts = { ...resolved, catalog, baselinesArtifact };
  artifactCache.set(resolved.releaseRoot, artifacts);
  log(options, 'info', `Control Pack loaded | packId=${resolved.packId} | version=${resolved.packVersion} | controls=${Array.isArray(catalog.controls) ? catalog.controls.length : 0} | automationGroups=${Array.isArray(catalog.automationGroups) ? catalog.automationGroups.length : 0} | baselines=${baselinesArtifact.baselines.length}`);
  return artifacts;
}

module.exports = { PACK_ID, resolveControlPack, loadControlPackArtifacts };
