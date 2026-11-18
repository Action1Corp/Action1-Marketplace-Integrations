const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const packageRoot = path.resolve('integrations/action1-ticketing');
const donorRoot = path.resolve('integrations/halo-psa');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.id, 'action1-ticketing');
  assert.strictEqual(path.basename(packageRoot), manifest.id);

  const actions = require('../actions').actions;
  assert.deepStrictEqual(manifest.actions.map((action) => action.id).sort(), Object.keys(actions).sort());

  const schema = JSON.parse(fs.readFileSync(path.join(packageRoot, 'ui/settingsSchema.json'), 'utf8'));
  const keys = schema.map((field) => field.key);
  assert(keys.every((key) => key.startsWith('Ticketing')), 'every integration setting uses the Ticketing key namespace');
  assert(!keys.some((key) => /Action1(ApiKey|ApiSecret|OrganizationId)/i.test(key)), 'shared Action1 credentials are not redeclared');

  const targetFiles = fs.readdirSync(packageRoot, { recursive: true }).map((entry) => path.join(packageRoot, entry));
  const executableSql = targetFiles.filter((file) => file.endsWith('.sql'));
  assert(executableSql.length > 0);
  const sql = executableSql.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const createdNames = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w]+)/gi)]
    .map((match) => match[1]);
  assert(createdNames.length > 0);
  assert(createdNames.every((name) => name.startsWith('action1_ticketing_')), 'all created SQL objects use the Action1 Ticketing namespace');
  assert(!sql.includes('halo_psa_'), 'Ticketing migrations never address Halo tables');

  for (const file of ['correlationStore.js', 'signalWatermarkStore.js']) {
    const text = fs.readFileSync(path.join(packageRoot, file), 'utf8');
    assert(!text.includes('halo_psa_'), `${file} must not address Halo tables`);
    assert(text.includes('action1_ticketing_'), `${file} must use Action1 Ticketing tables`);
  }

  const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'tests/DONOR_PROVENANCE.json'), 'utf8'));
  assert.strictEqual(provenance.fileCount, 77);
  assert.strictEqual(provenance.files.length, provenance.fileCount);
  assert.strictEqual(provenance.copyVerified, true);
  for (const item of provenance.files) {
    const source = path.join(donorRoot, item.path);
    const target = path.join(packageRoot, item.path);
    assert(fs.existsSync(source), `donor file remains present: ${item.path}`);
    assert(fs.existsSync(target), `copied donor file remains present: ${item.path}`);
    assert.strictEqual(fs.statSync(source).size, item.bytes, `donor file size is unchanged: ${item.path}`);
    assert.strictEqual(sha256(source), item.sourceSha256, `original donor is unchanged: ${item.path}`);
    assert.strictEqual(item.initialCopySha256, item.sourceSha256, `initial copy hash matches donor: ${item.path}`);
  }
}

run();
