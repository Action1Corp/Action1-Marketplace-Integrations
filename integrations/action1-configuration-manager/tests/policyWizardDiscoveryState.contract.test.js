const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function run() {
  const source = readSource('ui/policies/PolicyEditorView.jsx');
  const availabilitySource = readSource('ui/policies/policyScopeAvailability.js');
  assert(source.includes('Loading Action1 organizations...'), 'wizard should render organization-loading placeholder copy');
  assert(source.includes('Loading endpoint groups...'), 'wizard should render endpoint-group loading placeholder copy');
  assert(source.includes('organizationsError'), 'wizard should surface organization discovery errors');
  assert(source.includes('endpointGroupsError'), 'wizard should surface endpoint-group discovery errors');
  assert(source.includes('allEndpointsAvailable'), 'wizard should consume all-endpoints availability state');
  assert(availabilitySource.includes('All endpoints is unavailable because this organization already has group-scoped Policies.'), 'wizard availability model should explain reserved all-endpoints unavailability');
  assert(source.includes('No endpoint groups are currently available for a new Policy in this organization.'), 'wizard should show the compact empty-availability hint');
  assert(source.includes('readOnly={isEditMode}'), 'wizard should keep immutable edit target fields read-only');
  assert(source.includes('disabled={isEditMode}'), 'wizard should keep immutable edit target fields disabled');
  assert(!source.includes('retry panel'), 'wizard should not invent a new retry-panel layout');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
