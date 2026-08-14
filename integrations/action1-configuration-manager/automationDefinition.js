const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadPolicyCatalogContract } = require('./policyCatalogContract');
const { normalizeDateValue, normalizeTimeValue, positiveInteger, serializeAction1Time } = require('./scheduleModel.cjs');
const { formatUtcSchedule } = require('./timezoneModel.cjs');

const PACK_ID = 'windows-endpoint-configuration';
const PACK_VERSION = '0.5.0';
const PLACEHOLDER = '__A1CM_POLICY_CONFIGURATION_BASE64__';

function defaultReleaseRoot() {
  return path.join(__dirname, 'control-packs', PACK_ID, PACK_VERSION);
}

function serializeAction1Schedule(input = {}) {
  const runEveryHours = positiveInteger(input.runEveryHours, 'Run every');
  const startDate = normalizeDateValue(input.startDate);
  const startTime = normalizeTimeValue(input.startTime);
  const completionDeadlineMinutes = positiveInteger(input.completionDeadlineMinutes, 'Completion deadline');
  const timezone = String(input.timezone || '').trim();
  if (!timezone || timezone === 'Local Endpoint Time' || timezone === 'LOCALTIME') throw new Error('Marketplace IANA timezone is required.');
  const utcSchedule = formatUtcSchedule(startDate, startTime, timezone);
  return {
    settings: `ENABLED EVERY:${runEveryHours * 60} AT:${serializeAction1Time(utcSchedule.time)} DATE:${utcSchedule.date}`,
    settings_timezone: 'UTC',
    retry_minutes: String(completionDeadlineMinutes)
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildEnvelope(policy, group, controls) {
  return {
    schemaVersion: 1,
    policyId: String(policy.policyId),
    policyName: String(policy.displayName),
    policyMode: String(policy.policyMode),
    automationGroupId: String(group.automationGroupId),
    automationGroupVersion: String(group.version),
    controls: controls.map((control) => ({
      controlId: control.controlId,
      controlVersion: control.controlVersion,
      parameters: control.parameters || {}
    }))
  };
}

function buildAutomationDefinitions(policy, options = {}) {
  const releaseRoot = options.releaseRoot || defaultReleaseRoot();
  const pack = readJson(path.join(releaseRoot, 'pack.json'));
  if (pack.packId !== PACK_ID || pack.packVersion !== PACK_VERSION) throw new Error('Policy must use the pinned released Control Pack.');
  const catalog = loadPolicyCatalogContract();
  const groups = new Map();
  for (const selected of policy.selectedControls || []) {
    const group = catalog.controlFamiliesById[selected.automationGroupId];
    const control = catalog.controlsById[selected.controlId];
    if (!group || !control || selected.automationGroupVersion !== group.version || selected.controlVersion !== control.version || control.automationGroupId !== group.automationGroupId) {
      throw new Error('Selected Control or Automation Group does not match the pinned release.');
    }
    if (!groups.has(group.automationGroupId)) groups.set(group.automationGroupId, { group, controls: [] });
    groups.get(group.automationGroupId).controls.push(selected);
  }
  const schedule = serializeAction1Schedule({ ...policy.runSchedule, completionDeadlineMinutes: policy.completionDeadlineMinutes });
  return [...groups.values()].sort((left, right) => left.group.automationGroupId.localeCompare(right.group.automationGroupId)).map(({ group, controls }) => {
    const bundlePath = path.join(releaseRoot, 'bundles', `${group.automationGroupId}.bundle.ps1`);
    if (!fs.existsSync(bundlePath)) throw new Error(`Released bundle is missing for ${group.automationGroupId}.`);
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    const occurrences = bundle.split(PLACEHOLDER).length - 1;
    if (occurrences !== 1) throw new Error(`Released bundle must contain exactly one policy placeholder for ${group.automationGroupId}.`);
    const envelope = buildEnvelope(policy, group, controls);
    const envelopeJson = JSON.stringify(envelope);
    const envelopeBase64 = Buffer.from(envelopeJson, 'utf8').toString('base64');
    const scriptText = bundle.replace(PLACEHOLDER, envelopeBase64);
    const familyName = String(group.name || group.controlFamilyName || group.automationGroupId);
    const name = `A1CM — ${policy.baseName || policy.displayName} — ${familyName}`;
    const target = [{ id: policy.scopeType === 'ALL_ENDPOINTS' ? 'ALL' : policy.endpointGroupId, type: 'EndpointGroup' }];
    const payload = {
      name,
      endpoints: target,
      actions: [{
        name: 'Run PowerShell', template_id: 'run_script', params: {
          display_summary: '', condition_script_text: '', condition_script_language: 'PowerShell',
          run_script_params: [], run_script_text: scriptText, run_script_language: 'PowerShell',
          reboot_exit_codes: '', reboot_options: { auto_reboot: 'no', show_message: 'no', message_text: '', timeout: 240 }
        }
      }],
      settings: schedule.settings,
      settings_timezone: schedule.settings_timezone,
      retry_minutes: schedule.retry_minutes
    };
    const fingerprintInput = JSON.stringify({ policyId: policy.policyId, group: group.automationGroupId, payload: { ...payload, actions: [{ ...payload.actions[0], params: { ...payload.actions[0].params, run_script_text: envelopeJson } }] } });
    return { automationGroupId: group.automationGroupId, automationGroupVersion: group.version, familyName, name, target, envelope, envelopeBase64, scriptText, payload, fingerprint: `sha256:${crypto.createHash('sha256').update(fingerprintInput).digest('hex')}` };
  });
}

module.exports = { PACK_ID, PACK_VERSION, PLACEHOLDER, buildAutomationDefinitions, serializeAction1Schedule };
