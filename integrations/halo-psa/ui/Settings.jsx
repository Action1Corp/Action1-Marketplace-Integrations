import { useEffect, useMemo, useState } from 'react';
import settingsSchema from './settingsSchema.json';

const SECRET_MASK = '***';
const DISCOVERY_ACTION_ID = 'discover-halo-settings-options';

function groupSettings(schema) {
  return schema.reduce((groups, setting) => {
    const group = setting.group || 'Configuration';
    if (!groups[group]) groups[group] = [];
    groups[group].push(setting);
    return groups;
  }, {});
}

function isChecked(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getEffectiveValue(setting, currentSettings) {
  const currentValue = currentSettings?.[setting.key];
  if (currentValue === SECRET_MASK) return currentValue;
  if (currentValue !== undefined && currentValue !== null && currentValue !== '') return currentValue;
  if (setting.defaultValue !== undefined) return setting.defaultValue;
  return '';
}

function serializeSettingValue(setting, currentSettings) {
  const value = getEffectiveValue(setting, currentSettings);
  if (setting.type === 'checkbox') {
    return isChecked(value) ? 'true' : 'false';
  }
  if (setting.type === 'number') {
    return value === '' ? '' : String(value);
  }
  return value ?? '';
}

function parseCsvValues(value) {
  return String(value || '')
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
}

function mergeSavedOption(options, savedValue) {
  const value = String(savedValue || '').trim();
  if (!value) {
    return options;
  }
  if (options.some((row) => row.value === value)) {
    return options;
  }
  return [
    ...options,
    {
      value,
      label: `${value} (saved value)`
    }
  ];
}

function mergeSavedMultiOptions(options, savedValues) {
  return savedValues.reduce((current, value) => mergeSavedOption(current, value), options);
}

function asSelectOptions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const value = String(row?.id || '').trim();
      const name = String(row?.name || '').trim();
      if (!value || !name) {
        return null;
      }
      return {
        value,
        label: `${name} (${value})`
      };
    })
    .filter(Boolean);
}

function deriveRoutingChoices(discovery) {
  const detail = discovery?.ticketTypeDetail || null;
  const statuses = Array.isArray(detail?.allowedStatuses) && detail.allowedStatuses.length > 0
    ? detail.allowedStatuses
    : discovery?.statuses || [];
  const categories = Array.isArray(detail?.allowedCategories) && detail.allowedCategories.length > 0
    ? detail.allowedCategories
    : discovery?.categories || [];

  return {
    teams: discovery?.teams || [],
    ticketTypes: discovery?.ticketTypes || [],
    statuses,
    categories
  };
}

function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [discoveryState, setDiscoveryState] = useState({
    loading: false,
    error: '',
    loaded: false,
    data: {
      teams: [],
      ticketTypes: [],
      statuses: [],
      categories: [],
      ticketTypeDetail: null
    }
  });
  const sensitiveSettings = useMemo(() => new Set(
    settingsSchema
      .filter((setting) => setting.type === 'secret' || setting.sensitive)
      .map((setting) => setting.key)
  ), []);
  const supportsValidation = Boolean(meta?.operations?.validate);

  const buildActionPayload = (currentSettings) => {
    const payload = { _secretModes: {} };
    for (const setting of settingsSchema) {
      const value = getEffectiveValue(setting, currentSettings);
      if (sensitiveSettings.has(setting.key) && value === SECRET_MASK) {
        payload._secretModes[setting.key] = 'stored';
        continue;
      }
      payload[setting.key] = serializeSettingValue(setting, currentSettings);
    }
    return payload;
  };

  const loadDiscovery = async (settingsSnapshot, options = {}) => {
    const { silent = false } = options;
    setDiscoveryState((current) => ({
      ...current,
      loading: true,
      error: silent ? current.error : ''
    }));

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${DISCOVERY_ACTION_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: buildActionPayload(settingsSnapshot) })
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message || 'Unable to load HaloPSA settings options.');
      }

      setDiscoveryState({
        loading: false,
        error: '',
        loaded: true,
        data: {
          teams: Array.isArray(data?.teams) ? data.teams : [],
          ticketTypes: Array.isArray(data?.ticketTypes) ? data.ticketTypes : [],
          statuses: Array.isArray(data?.statuses) ? data.statuses : [],
          categories: Array.isArray(data?.categories) ? data.categories : [],
          ticketTypeDetail: data?.ticketTypeDetail || null
        }
      });
    } catch (error) {
      setDiscoveryState((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'Unable to load HaloPSA settings options.'
      }));
    }
  };

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
        setStoredSecrets(data.storedSecrets || {});

        loadDiscovery(nextSettings, { silent: true });
      })
      .catch(() => {
        if (cancelled) return;
        setMeta(null);
        setSettings({});
        setStoredSecrets({});
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
    setMessage(response.ok ? 'Settings saved successfully.' : 'Unable to save settings.');
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/validate-configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: buildActionPayload(settings) })
      });
      const data = await response.json();
      setValidationResult(data);
    } catch (error) {
      setValidationResult({ ok: false, message: 'Failed: Unable to validate HaloPSA configuration.' });
    } finally {
      setValidating(false);
    }
  };

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;
  const grouped = groupSettings(settingsSchema);
  const routingChoices = deriveRoutingChoices(discoveryState.data);

  const renderSingleDiscoverySelect = (setting, rows) => {
    const currentValue = getEffectiveValue(setting, settings);
    const options = mergeSavedOption(asSelectOptions(rows), currentValue);

    if (options.length === 0) {
      return (
        <input
          type="text"
          value={currentValue}
          onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
          style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
        />
      );
    }

    return (
      <select
        value={currentValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextSettings = { ...settings, [setting.key]: nextValue };
          setSettings(nextSettings);
          if (setting.key === 'HaloTicketTypeId') {
            loadDiscovery(nextSettings);
          }
        }}
        style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
      >
        <option value="">Select...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  const renderClosedStatusesControl = (setting) => {
    const currentValue = getEffectiveValue(setting, settings);
    const selectedValues = parseCsvValues(currentValue);
    const options = mergeSavedMultiOptions(asSelectOptions(routingChoices.statuses), selectedValues);

    if (options.length === 0) {
      return (
        <input
          type="text"
          value={currentValue}
          onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
          style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
        />
      );
    }

    return (
      <select
        multiple
        value={selectedValues}
        size={Math.min(Math.max(options.length, 4), 10)}
        onChange={(event) => {
          const nextValues = Array.from(event.target.selectedOptions, (option) => option.value);
          setSettings((current) => ({
            ...current,
            [setting.key]: nextValues.join(',')
          }));
        }}
        style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <form onSubmit={save}>
        {Object.entries(grouped).map(([groupName, fields]) => (
          <div key={groupName} className="glass-panel">
            <h3>{groupName}</h3>
            {fields.map((setting) => (
              <div key={setting.key} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>
                  {setting.label}
                  {setting.required && <span style={{ color: '#DC2626' }}> *</span>}
                </label>
                {setting.key === 'HaloTeamId' ? (
                  renderSingleDiscoverySelect(setting, routingChoices.teams)
                ) : setting.key === 'HaloTicketTypeId' ? (
                  renderSingleDiscoverySelect(setting, routingChoices.ticketTypes)
                ) : setting.key === 'HaloCategory1Id' ? (
                  renderSingleDiscoverySelect(setting, routingChoices.categories)
                ) : setting.key === 'HaloNewStatusId' ? (
                  renderSingleDiscoverySelect(setting, routingChoices.statuses)
                ) : setting.key === 'HaloClosedStatusIds' ? (
                  renderClosedStatusesControl(setting)
                ) : setting.type === 'select' ? (
                  <select
                    value={getEffectiveValue(setting, settings)}
                    onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
                  >
                    <option value="">Select...</option>
                    {(setting.options || []).map((option) => {
                      const value = typeof option === 'string' ? option : option.value;
                      const label = typeof option === 'string' ? option : option.label;
                      return <option key={value} value={value}>{label}</option>;
                    })}
                  </select>
                ) : setting.type === 'checkbox' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={isChecked(getEffectiveValue(setting, settings))}
                      onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.checked ? 'true' : 'false' }))}
                    />
                    Enabled
                  </label>
                ) : (
                  <input
                    type={setting.type === 'secret' ? 'password' : (setting.type === 'url' ? 'url' : setting.type === 'number' ? 'number' : 'text')}
                    value={getEffectiveValue(setting, settings)}
                    min={setting.type === 'number' && setting.min !== undefined ? setting.min : undefined}
                    max={setting.type === 'number' && setting.max !== undefined ? setting.max : undefined}
                    onFocus={() => {
                      if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) {
                        setSettings((current) => ({ ...current, [setting.key]: '' }));
                      }
                    }}
                    onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
                  />
                )}
                {storedSecrets[setting.key] && (
                  <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>
                    A secret value is stored. Keep *** to leave it unchanged.
                  </div>
                )}
                {setting.helpText && (
                  <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>
                    {setting.helpText}
                  </div>
                )}
                {setting.key === 'HaloClosedStatusIds' && routingChoices.statuses.length > 0 && (
                  <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>
                    Hold Ctrl or Cmd to select multiple statuses.
                  </div>
                )}
              </div>
            ))}
            {groupName === 'Ticket Routing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button className="btn-secondary" type="button" onClick={() => loadDiscovery(settings)} disabled={discoveryState.loading}>
                  {discoveryState.loading ? 'Refreshing Halo Options...' : 'Refresh Halo Options'}
                </button>
                {discoveryState.error && (
                  <span style={{ color: '#DC2626', fontSize: '0.85rem' }}>
                    {discoveryState.error}
                  </span>
                )}
                {!discoveryState.error && discoveryState.loaded && (
                  <span style={{ color: '#15803D', fontSize: '0.85rem' }}>
                    HaloPSA options loaded.
                  </span>
                )}
              </div>
            )}
            {supportsValidation && groupName.toLowerCase().includes('configuration') && (
              <button className="btn-primary" type="button" onClick={validate} disabled={validating}>
                {validating ? 'Validating...' : 'Validate Credentials'}
              </button>
            )}
            {validationResult && groupName.toLowerCase().includes('configuration') && (
              <div style={{ marginTop: '0.75rem', color: validationResult.ok === false ? '#DC2626' : '#15803D' }}>
                {validationResult.message || JSON.stringify(validationResult)}
              </div>
            )}
          </div>
        ))}
        <button className="btn-primary" type="submit">Save Settings</button>
        {message && (
          <span style={{ marginLeft: '1rem', color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>
            {message}
          </span>
        )}
      </form>
    </div>
  );
}

export default Settings;
