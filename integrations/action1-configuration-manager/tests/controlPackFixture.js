const fs = require('fs');
const path = require('path');

const releaseRoot = path.join(__dirname, '..', 'control-packs', 'windows-endpoint-configuration', '0.5.0');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(releaseRoot, name), 'utf8'));
}

function loadControlPackFixture() {
  return {
    packId: read('pack.json').packId,
    packVersion: read('pack.json').packVersion,
    catalog: read('control-catalog.json'),
    baselines: read('baselines.json').baselines
  };
}

module.exports = { loadControlPackFixture };
