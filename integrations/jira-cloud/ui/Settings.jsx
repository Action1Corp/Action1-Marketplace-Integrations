import { useEffect, useMemo, useState } from 'react';
import settingsSchema from './settingsSchema.json';
import {
  getEffectiveSettingValue as resolveEffectiveSettingValue,
  serializeSettingValue as resolveSerializedSettingValue
} from './settingsValueHelpers';

const SECRET_MASK = '***';
const CONNECTION_SETTING_KEYS = [
  'JiraCloudSiteUrl',
  'JiraCloudUserEmail',
  'JiraCloudApiToken'
];
const SIGNAL_FILTER_SETTING_KEYS = [
  'JiraCloudOfflineEnabled',
  'JiraCloudOfflineThresholdDays',
  'JiraCloudRebootRequiredEnabled',
  'JiraCloudAutomationFailedEnabled',
  'JiraCloudVulnerabilitySeverities',
  'JiraCloudVulnerabilityRemediationStatuses',
  'JiraCloudUpdateSeverities',
  'JiraCloudUpdateRemediationStatuses'
];
const MULTI_SELECT_EMPTY_MARKER_KEYS = {
  JiraCloudVulnerabilitySeverities: 'JiraCloudVulnerabilitySeveritiesExplicit',
  JiraCloudVulnerabilityRemediationStatuses: 'JiraCloudVulnerabilityRemediationStatusesExplicit',
  JiraCloudUpdateSeverities: 'JiraCloudUpdateSeveritiesExplicit',
  JiraCloudUpdateRemediationStatuses: 'JiraCloudUpdateRemediationStatusesExplicit'
};
const TICKET_MODEL_SETTING_KEYS = [
  'JiraCloudVulnerabilityTicketModel',
  'JiraCloudUpdateTicketModel',
  'JiraCloudAutomationFailedTicketModel',
  'JiraCloudMaxImpactedEndpointsInGroupedTicket'
];
const OPERATIONAL_SAFEGUARD_SETTING_KEYS = [
  'JiraCloudExistingOpenIssueBehavior',
  'JiraCloudMaxOpenTicketsPerOrganization'
];
const DIAGNOSTIC_SETTING_KEYS = [
  'JiraCloudDiagnosticLoggingEnabled'
];
const INLINE_TOOLTIP_KEYS = new Set([
  'JiraCloudSiteUrl',
  'JiraCloudUserEmail',
  'JiraCloudApiToken',
  'JiraCloudExistingOpenIssueBehavior',
  'JiraCloudMaxOpenTicketsPerOrganization',
  'JiraCloudDiagnosticLoggingEnabled'
]);
const EXISTING_OPEN_BEHAVIOR_OPTIONS = [
  {
    value: 'update_existing_open',
    title: 'Update existing open Jira issues',
    help: 'Keep linked open issues current when the Action1 signal details change.'
  },
  {
    value: 'skip_existing_open',
    title: 'Skip updating existing open Jira issues',
    help: 'Create issues initially, but do not modify linked open issues after creation.'
  }
];
const VULNERABILITY_SEVERITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VULNERABILITY_REMEDIATION_OPTIONS = ['OVERDUE', 'DUE_SOON'];
const UPDATE_SEVERITY_OPTIONS = ['CRITICAL', 'IMPORTANT', 'MODERATE', 'LOW', 'UNSPECIFIED'];
const UPDATE_REMEDIATION_OPTIONS = ['OVERDUE', 'DUE_SOON'];
const LIGHT_RADIO_CARD_STYLE = {
  display: 'flex',
  gap: '0.7rem',
  alignItems: 'flex-start',
  padding: '0.8rem 0.9rem',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background-color 120ms ease'
};
const SIGNAL_FILTER_CARD_STYLE = {
  border: '1px solid var(--border-color)',
  borderRadius: 12,
  background: '#FBFCFE',
  padding: '0.95rem 1rem',
  display: 'grid',
  gridTemplateRows: 'auto auto 1fr auto auto'
};
const pageStyles = {
  page: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
    display: 'grid',
    gap: '0.5rem'
  },
  header: {
    display: 'grid',
    gap: '0.35rem'
  },
  form: {
    display: 'grid',
    gap: '0.5rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    lineHeight: 1.2
  },
  description: {
    margin: 0,
    color: '#526173',
    fontSize: '0.92rem',
    lineHeight: 1.6,
    maxWidth: 760
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.25
  }
};

function isChecked(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getEffectiveValue(setting, currentSettings) {
  const hasCurrentValue = Boolean(
    currentSettings &&
    Object.prototype.hasOwnProperty.call(currentSettings, setting.key)
  );

  return resolveEffectiveSettingValue(setting, currentSettings, {
    hasCurrentValue,
    secretMask: SECRET_MASK,
    settingsSchema
  });
}

function serializeSettingValue(setting, currentSettings) {
  return resolveSerializedSettingValue(setting, currentSettings, {
    secretMask: SECRET_MASK,
    settingsSchema
  });
}

function parseCsvValues(value) {
  return String(value || '')
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
}

function hasSelectedCsvValues(value) {
  return parseCsvValues(value).length > 0;
}

function formatEnumLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deriveSharedSignalTicketModel(currentSettings) {
  const vulnerability = String(currentSettings?.JiraCloudVulnerabilityTicketModel || 'grouped').toLowerCase();
  const update = String(currentSettings?.JiraCloudUpdateTicketModel || 'grouped').toLowerCase();
  const automation = String(currentSettings?.JiraCloudAutomationFailedTicketModel || 'grouped').toLowerCase();
  return vulnerability === 'grouped' && update === 'grouped' && automation === 'grouped' ? 'grouped' : 'endpoint';
}

function InfoTip({ text }) {
  return (
    <span
      className="halo-psa-info-tip"
      tabIndex={0}
      title={text}
      aria-label={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        marginLeft: '0.4rem',
        borderRadius: '999px',
        border: '1px solid #CBD5E1',
        color: '#475569',
        fontSize: '0.7rem',
        fontWeight: 700,
        lineHeight: 1,
        cursor: 'help',
        background: '#F8FAFC',
        verticalAlign: 'middle'
      }}
    >
      i
    </span>
  );
}

function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({});
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [connectionExpanded, setConnectionExpanded] = useState(true);
  const visibleSettingsSchema = useMemo(
    () => settingsSchema.filter((setting) => setting.visible !== false),
    []
  );
  const sensitiveSettings = useMemo(() => new Set(
    settingsSchema
      .filter((setting) => setting.type === 'secret' || setting.sensitive)
      .map((setting) => setting.key)
  ), []);
  const supportsValidation = Boolean(meta?.operations?.validate);
  const isConnectionConfigured = CONNECTION_SETTING_KEYS.every((key) => {
    if (key === 'JiraCloudApiToken') {
      return Boolean(storedSecrets[key] || String(settings[key] || '').trim());
    }
    return Boolean(String(settings[key] || '').trim());
  });
  const connectionSummarySiteUrl = String(settings.JiraCloudSiteUrl || '').trim() || 'Configured';

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/marketplace/${integration}`).then((response) => response.json()),
      fetch('/api/settings').then((response) => response.json())
    ])
      .then(([nextMeta, data]) => {
        if (cancelled) return;

        const nextSettings = { ...(data.settings || {}) };
        for (const setting of settingsSchema) {
          if (sensitiveSettings.has(setting.key) && data.storedSecrets?.[setting.key]) {
            nextSettings[setting.key] = SECRET_MASK;
          }
        }

        setMeta(nextMeta);
        setSettings(nextSettings);
        setSavedSettingsSnapshot(nextSettings);
        setStoredSecrets(data.storedSecrets || {});
        setConnectionExpanded(!CONNECTION_SETTING_KEYS.every((key) => {
          if (key === 'JiraCloudApiToken') {
            return Boolean(data.storedSecrets?.[key] || String(nextSettings[key] || '').trim());
          }
          return Boolean(String(nextSettings[key] || '').trim());
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setMeta(null);
        setSettings({});
        setSavedSettingsSnapshot({});
        setStoredSecrets({});
        setConnectionExpanded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [integration, sensitiveSettings]);

  const save = async (event) => {
    event.preventDefault();
    const payload = { _integration: integration };
    for (const setting of settingsSchema) {
      if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) continue;
      payload[setting.key] = serializeSettingValue(setting, settings);
    }

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      setSavedSettingsSnapshot(settings);
      if (isConnectionConfigured) {
        setConnectionExpanded(false);
      }
    }
    setMessage(response.ok ? 'Settings saved successfully.' : 'Unable to save settings.');
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const payload = { _secretModes: {} };
      for (const setting of settingsSchema) {
        const value = getEffectiveValue(setting, settings);
        if (sensitiveSettings.has(setting.key) && value === SECRET_MASK) {
          payload._secretModes[setting.key] = 'stored';
          continue;
        }
        payload[setting.key] = serializeSettingValue(setting, settings);
      }

      const response = await fetch(`/api/integrations/${integration}/actions/validate-configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload })
      });
      const data = await response.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ ok: false, message: 'Failed: Unable to validate Jira Cloud configuration.' });
    } finally {
      setValidating(false);
    }
  };

  const cancelConnectionEdit = () => {
    setSettings(savedSettingsSnapshot);
    setValidationResult(null);
    setConnectionExpanded(false);
  };

  const updateCsvSetting = (settingKey, optionValue, checked) => {
    setSettings((current) => {
      const nextValues = new Set(parseCsvValues(current[settingKey]));
      if (checked) nextValues.add(optionValue);
      else nextValues.delete(optionValue);
      const nextSettings = {
        ...current,
        [settingKey]: Array.from(nextValues).join(',')
      };
      const emptySelectionMarkerKey = MULTI_SELECT_EMPTY_MARKER_KEYS[settingKey];
      if (emptySelectionMarkerKey) {
        nextSettings[emptySelectionMarkerKey] = 'true';
      }

      if (settingKey === 'JiraCloudVulnerabilitySeverities') {
        nextSettings.JiraCloudVulnerabilityEnabled = hasSelectedCsvValues(nextSettings.JiraCloudVulnerabilitySeverities) ? 'true' : 'false';
      }

      if (settingKey === 'JiraCloudUpdateSeverities') {
        nextSettings.JiraCloudUpdateEnabled = hasSelectedCsvValues(nextSettings.JiraCloudUpdateSeverities) ? 'true' : 'false';
      }

      return nextSettings;
    });
  };

  const setSharedSignalTicketMode = (mode) => {
    setSettings((current) => ({
      ...current,
      JiraCloudVulnerabilityTicketModel: mode,
      JiraCloudUpdateTicketModel: mode,
      JiraCloudAutomationFailedTicketModel: mode
    }));
  };

  const renderCheckboxGroup = (settingKey, options) => {
    const selectedValues = new Set(parseCsvValues(settings[settingKey]));
    return (
      <div style={{ display: 'grid', gap: '0.55rem' }}>
        {options.map((option) => (
          <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={selectedValues.has(option)}
              onChange={(event) => updateCsvSetting(settingKey, option, event.target.checked)}
            />
            <span>{formatEnumLabel(option)}</span>
          </label>
        ))}
      </div>
    );
  };

  const renderExistingOpenBehavior = (setting) => {
    const currentValue = getEffectiveValue(setting, settings) || 'update_existing_open';
    return (
      <div style={{ display: 'grid', gap: '0.65rem' }}>
        {EXISTING_OPEN_BEHAVIOR_OPTIONS.map((option) => (
          <label
            key={option.value}
            style={{
              ...LIGHT_RADIO_CARD_STYLE,
              border: currentValue === option.value ? '1px solid #CBD5E1' : '1px solid var(--border-color)',
              background: currentValue === option.value ? '#F8FAFC' : '#fff'
            }}
          >
            <input
              type="radio"
              name="jira-existing-open-issue-behavior"
              value={option.value}
              checked={currentValue === option.value}
              onChange={() => setSettings((current) => ({ ...current, [setting.key]: option.value }))}
              style={{ marginTop: 2 }}
            />
            <span style={{ display: 'grid', gap: '0.2rem' }}>
              <span style={{ fontWeight: 700, lineHeight: 1.35 }}>{option.title}</span>
              <span style={{ color: '#526173', fontSize: '0.84rem', lineHeight: 1.45 }}>{option.help}</span>
            </span>
          </label>
        ))}
      </div>
    );
  };

  const renderGenericField = (setting) => {
    if (setting.key === 'JiraCloudExistingOpenIssueBehavior') {
      return renderExistingOpenBehavior(setting);
    }
    if (setting.type === 'checkbox') {
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={isChecked(getEffectiveValue(setting, settings))}
            onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.checked ? 'true' : 'false' }))}
          />
          Enabled
        </label>
      );
    }

    return (
      <input
        type={setting.type === 'secret' ? 'password' : (setting.type === 'url' ? 'url' : setting.type === 'number' ? 'number' : 'text')}
        value={getEffectiveValue(setting, settings)}
        placeholder={setting.type === 'secret' && storedSecrets[setting.key] ? 'Saved (leave unchanged)' : undefined}
        min={setting.type === 'number' && setting.min !== undefined ? setting.min : undefined}
        max={setting.type === 'number' && setting.max !== undefined ? setting.max : undefined}
        onFocus={() => {
          if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) {
            setSettings((current) => ({ ...current, [setting.key]: '' }));
          }
        }}
        onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
        style={{ width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
      />
    );
  };

  const renderField = (setting) => (
    <div key={setting.key} style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 700 }}>
        {setting.label}
        {setting.required && <span style={{ color: '#DC2626' }}> *</span>}
        {setting.helpText && INLINE_TOOLTIP_KEYS.has(setting.key) && <InfoTip text={setting.helpText} />}
      </label>
      {renderGenericField(setting)}
      {storedSecrets[setting.key] && (
        <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: '#6B7280' }}>
          A secret value is stored. Keep *** to leave it unchanged.
        </div>
      )}
      {setting.helpText && !INLINE_TOOLTIP_KEYS.has(setting.key) && (
        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#6B7280', lineHeight: 1.45 }}>
          {setting.helpText}
        </div>
      )}
    </div>
  );

  const renderAction1SignalsSection = (fields) => {
    const offlineThresholdSetting = fields.find((setting) => setting.key === 'JiraCloudOfflineThresholdDays') || null;
    return (
      <div className="glass-panel">
        <h3 style={pageStyles.cardTitle}>Action1 Signals</h3>
        <p style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
          Choose which Action1 endpoint signals should create or maintain Jira issues.
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={isChecked(getEffectiveValue({ key: 'JiraCloudOfflineEnabled' }, settings))}
                onChange={(event) => setSettings((current) => ({ ...current, JiraCloudOfflineEnabled: event.target.checked ? 'true' : 'false' }))}
              />
              <span>Create issue after endpoint is offline for at least (days)</span>
            </label>
            {offlineThresholdSetting && (
              <input
                type="number"
                min={offlineThresholdSetting.min}
                value={getEffectiveValue(offlineThresholdSetting, settings)}
                onChange={(event) => setSettings((current) => ({ ...current, [offlineThresholdSetting.key]: event.target.value }))}
                style={{ width: 92, padding: '0.55rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
              />
            )}
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={isChecked(getEffectiveValue({ key: 'JiraCloudRebootRequiredEnabled' }, settings))}
              onChange={(event) => setSettings((current) => ({ ...current, JiraCloudRebootRequiredEnabled: event.target.checked ? 'true' : 'false' }))}
            />
            <span>Create issue for reboot required endpoints</span>
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={isChecked(getEffectiveValue({ key: 'JiraCloudAutomationFailedEnabled' }, settings))}
              onChange={(event) => setSettings((current) => ({ ...current, JiraCloudAutomationFailedEnabled: event.target.checked ? 'true' : 'false' }))}
            />
            <span>Create issue for automation failures</span>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', alignItems: 'stretch' }}>
          <div style={SIGNAL_FILTER_CARD_STYLE}>
            <h4 style={{ margin: '0 0 0.8rem' }}>Vulnerabilities</h4>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', marginBottom: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Severity
            </div>
            {renderCheckboxGroup('JiraCloudVulnerabilitySeverities', VULNERABILITY_SEVERITY_OPTIONS)}
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', margin: '0.95rem 0 0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Remediation status
            </div>
            {renderCheckboxGroup('JiraCloudVulnerabilityRemediationStatuses', VULNERABILITY_REMEDIATION_OPTIONS)}
          </div>

          <div style={SIGNAL_FILTER_CARD_STYLE}>
            <h4 style={{ margin: '0 0 0.8rem' }}>Missing Updates</h4>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', marginBottom: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Severity
            </div>
            {renderCheckboxGroup('JiraCloudUpdateSeverities', UPDATE_SEVERITY_OPTIONS)}
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', margin: '0.95rem 0 0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Remediation status
            </div>
            {renderCheckboxGroup('JiraCloudUpdateRemediationStatuses', UPDATE_REMEDIATION_OPTIONS)}
          </div>
        </div>
      </div>
    );
  };

  const renderTicketModelSection = (fields) => {
    const fieldsByKey = new Map(fields.map((setting) => [setting.key, setting]));
    const maxEndpointsSetting = fieldsByKey.get('JiraCloudMaxImpactedEndpointsInGroupedTicket') || null;
    const groupedModeSelected = deriveSharedSignalTicketModel(settings) === 'grouped';

    return (
      <div className="glass-panel">
        <h3 style={pageStyles.cardTitle}>Ticket Model</h3>
        <p style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
          Choose how Jira issues are created for vulnerabilities, missing updates, and automation failures.
        </p>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label
            style={{
              ...LIGHT_RADIO_CARD_STYLE,
              border: groupedModeSelected ? '1px solid #94A3B8' : '1px solid var(--border-color)',
              background: groupedModeSelected ? '#F8FAFC' : '#fff'
            }}
          >
            <input
              type="radio"
              name="jira-ticket-mode"
              value="grouped"
              checked={groupedModeSelected}
              onChange={() => setSharedSignalTicketMode('grouped')}
              style={{ marginTop: 2 }}
            />
            <span style={{ display: 'grid', gap: '0.2rem' }}>
              <span style={{ fontWeight: 700, lineHeight: 1.35 }}>Create issues per issue</span>
              <span style={{ color: '#526173', fontSize: '0.84rem', lineHeight: 1.45 }}>
                Creates one Jira issue per vulnerability, missing update, or automation run, with affected endpoints listed inside.
              </span>
            </span>
          </label>
          <label
            style={{
              ...LIGHT_RADIO_CARD_STYLE,
              border: !groupedModeSelected ? '1px solid #94A3B8' : '1px solid var(--border-color)',
              background: !groupedModeSelected ? '#F8FAFC' : '#fff'
            }}
          >
            <input
              type="radio"
              name="jira-ticket-mode"
              value="endpoint"
              checked={!groupedModeSelected}
              onChange={() => setSharedSignalTicketMode('endpoint')}
              style={{ marginTop: 2 }}
            />
            <span style={{ display: 'grid', gap: '0.2rem' }}>
              <span style={{ fontWeight: 700, lineHeight: 1.35 }}>Create issues per endpoint</span>
              <span style={{ color: '#526173', fontSize: '0.84rem', lineHeight: 1.45 }}>
                Creates one Jira issue for each affected endpoint.
              </span>
            </span>
          </label>
        </div>

        {maxEndpointsSetting && (
          <>
            <div style={{ height: 1, background: 'var(--border-color)', margin: '1rem 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '0.9rem 1rem', alignItems: 'center' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 700 }}>
                  {maxEndpointsSetting.label}
                  <InfoTip text={maxEndpointsSetting.helpText} />
                </label>
              </div>
              <input
                type="number"
                min={maxEndpointsSetting.min}
                max={maxEndpointsSetting.max}
                disabled={!groupedModeSelected}
                value={getEffectiveValue(maxEndpointsSetting, settings)}
                onChange={(event) => setSettings((current) => ({ ...current, [maxEndpointsSetting.key]: event.target.value }))}
                style={{ width: 110, padding: '0.55rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 6, background: groupedModeSelected ? '#fff' : '#F8FAFC' }}
              />
            </div>
            <div style={{ marginTop: '0.45rem', color: '#526173', fontSize: '0.84rem' }}>
              Applies when "Create issues per issue" is selected.
            </div>
          </>
        )}
      </div>
    );
  };

  const renderOperationalSafeguardsSection = (fields) => (
    <div className="glass-panel">
      <h3 style={pageStyles.cardTitle}>Issue Handling</h3>
      <p style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
        Choose how linked Jira issues are maintained and limit how many open issues Action1 may keep per mapped organization.
      </p>
      {fields.map((setting) => {
        if (setting.key === 'JiraCloudMaxOpenTicketsPerOrganization') {
          return (
            <div key={setting.key} style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 700 }}>
                {setting.label}
                {setting.helpText && <InfoTip text={setting.helpText} />}
              </label>
              <input
                type="number"
                min={setting.min !== undefined ? setting.min : undefined}
                max={setting.max !== undefined ? setting.max : undefined}
                value={getEffectiveValue(setting, settings)}
                onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
                style={{ width: 120, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
              />
            </div>
          );
        }
        return renderField(setting);
      })}
    </div>
  );

  const renderDiagnosticsSection = (fields) => (
    <div className="glass-panel">
      <h3 style={pageStyles.cardTitle}>Diagnostics</h3>
      <p style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
        Enable additional sanitized runtime diagnostics when support troubleshooting is needed.
      </p>
      {fields.map((setting) => (
        <div key={setting.key} style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={isChecked(getEffectiveValue(setting, settings))}
              onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.checked ? 'true' : 'false' }))}
            />
            <span>{setting.label}</span>
            {setting.helpText && <InfoTip text={setting.helpText} />}
          </label>
        </div>
      ))}
    </div>
  );

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;

  const grouped = new Map(Object.entries(
    visibleSettingsSchema.reduce((groups, setting) => {
      const group = setting.group || 'Configuration';
      if (!groups[group]) groups[group] = [];
      groups[group].push(setting);
      return groups;
    }, {})
  ));

  return (
    <div style={pageStyles.page}>
      <div style={pageStyles.header}>
        <h1 className="page-title" style={pageStyles.title}>Settings</h1>
        <p style={pageStyles.description}>
          Configure the Jira Cloud API connection, Action1 signal behavior, ticket model, operational safeguards, and diagnostics used by this integration.
        </p>
      </div>
      <form onSubmit={save} style={pageStyles.form}>
        <div className="glass-panel">
          <h3 style={pageStyles.cardTitle}>Jira Cloud API Configuration</h3>
          {connectionExpanded ? (
            <>
              <p style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
                Configure access to your Jira Cloud site using an Atlassian account email and API token.
              </p>
              {(grouped.get('Jira Cloud Configuration') || []).map((setting) => renderField(setting))}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn-primary" type="submit">Save Settings</button>
                {isConnectionConfigured && (
                  <button className="btn-secondary" type="button" onClick={cancelConnectionEdit}>
                    Cancel
                  </button>
                )}
                {supportsValidation && (
                  <button className="btn-secondary" type="button" onClick={validate} disabled={validating}>
                    {validating ? 'Testing connection...' : 'Test Connection'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                background: '#F8FAFC',
                padding: '1rem 1rem 0.95rem'
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Jira Cloud connection configured</div>
              <div style={{ color: '#526173', fontSize: '0.92rem', marginBottom: '0.9rem' }}>
                Jira Site URL: {connectionSummarySiteUrl}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn-primary" type="button" onClick={() => setConnectionExpanded(true)}>
                  Change Settings
                </button>
                {supportsValidation && (
                  <button className="btn-secondary" type="button" onClick={validate} disabled={validating}>
                    {validating ? 'Testing connection...' : 'Test Connection'}
                  </button>
                )}
              </div>
            </div>
          )}
          {validationResult && (
            <div style={{ marginTop: '0.75rem', color: validationResult.ok === false ? '#DC2626' : '#15803D' }}>
              {validationResult.message || JSON.stringify(validationResult)}
            </div>
          )}
        </div>

        {renderAction1SignalsSection((grouped.get('Action1 Signals') || []).filter((setting) => SIGNAL_FILTER_SETTING_KEYS.includes(setting.key)))}
        {renderTicketModelSection((grouped.get('Ticket Model') || []).filter((setting) => TICKET_MODEL_SETTING_KEYS.includes(setting.key)))}
        {renderOperationalSafeguardsSection((grouped.get('Operational Safeguards') || []).filter((setting) => OPERATIONAL_SAFEGUARD_SETTING_KEYS.includes(setting.key)))}
        {renderDiagnosticsSection((grouped.get('Diagnostics') || []).filter((setting) => DIAGNOSTIC_SETTING_KEYS.includes(setting.key)))}

        <div
          className="halo-psa-settings-bottom-spacer"
          aria-hidden="true"
          style={{ height: 12 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button className="btn-primary" type="submit">Save Settings</button>
          {message && (
            <span style={{ color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

export default Settings;
