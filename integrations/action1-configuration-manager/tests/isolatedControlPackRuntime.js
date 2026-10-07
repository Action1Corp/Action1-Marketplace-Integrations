const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadControlPackFixture } = require('./controlPackFixture');

const PLACEHOLDER = '__A1CM_POLICY_CONFIGURATION_BASE64__';

async function withIsolatedControlPackRuntime(callback) {
  const fixture = loadControlPackFixture();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a1cm-test-control-pack-'));
  const releaseRoot = path.join(temporaryRoot, fixture.packVersion);
  const bundlesRoot = path.join(releaseRoot, 'bundles');
  fs.mkdirSync(bundlesRoot, { recursive: true });
  for (const group of fixture.catalog.automationGroups) {
    fs.writeFileSync(path.join(bundlesRoot, `${group.automationGroupId}.bundle.ps1`), `# ${PLACEHOLDER}\n`);
  }

  const contract = {
    packId: fixture.packId,
    packVersion: fixture.packVersion,
    releaseRoot,
    catalog: fixture.catalog,
    baselines: fixture.baselines,
    controlsById: Object.fromEntries(fixture.catalog.controls.map((control) => [control.controlId, control])),
    controlFamiliesById: Object.fromEntries(fixture.catalog.automationGroups.map((group) => [group.automationGroupId, group]))
  };
  const contractModule = require('../policyCatalogContract');
  const resolverModule = require('../controlPackResolver');
  const previousLoader = contractModule.loadPolicyCatalogContract;
  const previousArtifactLoader = resolverModule.loadControlPackArtifacts;
  contractModule.loadPolicyCatalogContract = () => contract;
  resolverModule.loadControlPackArtifacts = (options = {}) => options.packRoot
    ? previousArtifactLoader(options)
    : { ...contract, baselinesArtifact: { baselines: fixture.baselines } };
  const modulePaths = [
    require.resolve('../automationDefinition'),
    require.resolve('../lifecycleMutations'),
    require.resolve('../policyActions'),
    require.resolve('../policyStore'),
    require.resolve('../reconciliation')
  ];
  const previousModules = new Map(modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  for (const modulePath of modulePaths) delete require.cache[modulePath];

  try {
    return await callback({ fixture, contract, releaseRoot });
  } finally {
    contractModule.loadPolicyCatalogContract = previousLoader;
    resolverModule.loadControlPackArtifacts = previousArtifactLoader;
    for (const modulePath of modulePaths) {
      delete require.cache[modulePath];
      if (previousModules.get(modulePath)) require.cache[modulePath] = previousModules.get(modulePath);
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = { withIsolatedControlPackRuntime };
