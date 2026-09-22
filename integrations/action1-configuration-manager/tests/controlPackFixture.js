const PACK_ID = 'windows-endpoint-configuration';
const PACK_VERSION = '9.9.1-test';
const family = (automationGroupId, displayOrder = 1) => ({ automationGroupId, version: '0.1.0', name: ({ 'identity.password-policy': 'Password Policy', 'identity.interactive-sign-in': 'Interactive Sign-in', 'audit-policy.policy-and-firewall-changes': 'Policy and Firewall Changes', 'defender.protection': 'Defender Protection', 'identity.account-lockout': 'Account Lockout', 'defender.scanning': 'Defender Scanning' }[automationGroupId] || automationGroupId), familyId: automationGroupId.startsWith('identity.') ? 'identity-and-sign-in' : automationGroupId.startsWith('defender.') || automationGroupId.startsWith('audit-') ? 'threat-protection' : 'identity-and-sign-in', displayOrder });
function control(controlId, automationGroupId, parameters = [], displayOrder = 1) {
  return { controlId, version: '0.1.0', name: controlId, description: `Synthetic fixture control ${controlId}`, familyId: automationGroupId, automationGroupId, displayOrder, parameters, policy: { kind: 'SecurityPolicy', scope: 'Computer' } };
}
const integer = (id, defaultValue, minimum = 0, maximum = 999) => ({ id, type: 'integer', label: id, required: true, defaultValue, minimum, maximum, step: 1 });
const boolean = (id, defaultValue = true) => ({ id, type: 'boolean', label: id, required: true, defaultValue });
const enumeration = (id, defaultValue, options) => ({ id, type: 'enum', label: id, required: true, defaultValue, options: options.map((value) => ({ value, label: value })) });
const string = (id, type = 'string') => ({ id, type, label: id, required: true, defaultValue: 'fixture value', minimumLength: 1, maximumLength: 4000 });
const controls = [
  control('identity.password.minimum-length', 'identity.password-policy', [integer('minimumLength', 14, 0, 14)], 10),
  control('identity.password.maximum-age', 'identity.password-policy', [integer('maximumAgeDays', 90)], 20),
  control('identity.sign-in.require-secure-attention', 'identity.interactive-sign-in', [], 10),
  control('audit.policy.audit-policy-change', 'audit-policy.policy-and-firewall-changes', [enumeration('auditing', 'success', ['none', 'success', 'failure', 'success-and-failure'])], 10),
  control('defender.protection.real-time', 'defender.protection', [boolean('enabled')], 10),
  control('identity.lockout.threshold', 'identity.account-lockout', [integer('failedAttempts', 10, 1)], 10),
  control('defender.scan.type', 'defender.scanning', [enumeration('scanType', 'QuickScan', ['QuickScan', 'FullScan'])], 10),
  control('identity.sign-in.legal-notice-caption', 'identity.interactive-sign-in', [string('caption')], 40),
  control('identity.sign-in.legal-notice-text', 'identity.interactive-sign-in', [string('noticeText', 'multiline-string')], 50),
  control('defender.scan.time', 'defender.scanning', [{ id: 'localTime', type: 'time', label: 'localTime', required: true, defaultValue: '02:00' }], 30)
];
controls.find((entry) => entry.controlId === 'identity.password.minimum-length').name = 'Minimum password length';
Object.assign(controls.find((entry) => entry.controlId === 'identity.password.minimum-length').parameters[0], { label: 'Minimum length', unit: 'characters' });
Object.assign(controls.find((entry) => entry.controlId === 'identity.password.maximum-age').parameters[0], { label: 'Maximum age', unit: 'days' });
const baselines = [{ id: 'microsoft-windows-11-25h2', name: 'Microsoft Security Baseline - Windows 11 25H2', provider: 'Microsoft', version: '25H2', tag: 'MS Baseline', controls: [{ controlId: 'identity.password.minimum-length', parameters: { minimumLength: 14 } }] }];
function loadControlPackFixture() {
  return { packId: PACK_ID, packVersion: PACK_VERSION, catalog: { packId: PACK_ID, packVersion: PACK_VERSION, families: [{ familyId: 'identity-and-sign-in', name: 'Identity', displayOrder: 1 }, { familyId: 'threat-protection', name: 'Threat', displayOrder: 2 }], automationGroups: [...new Map(controls.map((entry) => [entry.automationGroupId, family(entry.automationGroupId)])).values()], controls }, baselines };
}
module.exports = { PACK_ID, PACK_VERSION, loadControlPackFixture };
