import { useEffect, useMemo, useState } from 'react';
import {
  SECRET_MASK,
  WEEKDAYS,
  browserTimezone,
  cronToSchedule,
  groupSettings,
  scheduleKey,
  scheduleToCron,
  timezoneKey
} from './viewToolkit.jsx';

function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [scheduleUi, setScheduleUi] = useState(cronToSchedule(''));
  const settingsSchema = meta?.settingsSchema || [];
  const sensitiveSettings = useMemo(() => new Set(settingsSchema.filter(setting => setting.type === 'secret' || setting.sensitive).map(setting => setting.key)), [settingsSchema]);
  const supportsSchedule = (meta?.marketplaceActions || []).includes('schedule') || (meta?.marketplaceActions || []).includes('sync');
  const supportsValidation = (meta?.marketplaceActions || []).includes('validate');

  useEffect(() => {
    Promise.all([fetch(`/api/marketplace/${integration}`).then(r => r.json()), fetch('/api/settings').then(r => r.json())])
      .then(([nextMeta, data]) => {
        const nextSettings = { ...(data.settings || {}) };
        for (const setting of nextMeta.settingsSchema || []) {
          if ((setting.type === 'secret' || setting.sensitive) && data.storedSecrets?.[setting.key]) nextSettings[setting.key] = SECRET_MASK;
        }
        if (!nextSettings[timezoneKey(integration)]) nextSettings[timezoneKey(integration)] = browserTimezone();
        setMeta(nextMeta);
        setSettings(nextSettings);
        setStoredSecrets(data.storedSecrets || {});
        setScheduleUi(cronToSchedule(nextSettings[scheduleKey(integration)]));
      });
  }, [integration]);

  const save = async (event) => {
    event.preventDefault();
    const payload = { _integration: integration };
    for (const setting of settingsSchema) {
      if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) continue;
      payload[setting.key] = settings[setting.key] || '';
    }
    if (supportsSchedule) {
      payload[scheduleKey(integration)] = settings[scheduleKey(integration)] || '';
      payload[timezoneKey(integration)] = settings[timezoneKey(integration)] || browserTimezone();
    }
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setMessage(response.ok ? 'Settings saved successfully.' : 'Unable to save settings.');
  };

  const validationPayload = () => {
    const payload = { integration, _secretModes: {} };
    for (const setting of settingsSchema) {
      const value = settings[setting.key];
      if (sensitiveSettings.has(setting.key) && value === SECRET_MASK) {
        payload._secretModes[setting.key] = 'stored';
        continue;
      }
      payload[setting.key] = value ?? '';
    }
    return payload;
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validationPayload())
      });
      const data = await response.json();
      setValidationResult(data[integration] || data);
    } catch (error) {
      setValidationResult({ ok: false, message: error.message });
    } finally {
      setValidating(false);
    }
  };

  const updateSchedule = (changes) => {
    setScheduleUi(prev => {
      const next = { ...prev, ...changes };
      setSettings(current => ({ ...current, [scheduleKey(integration)]: scheduleToCron(next), [timezoneKey(integration)]: current[timezoneKey(integration)] || browserTimezone() }));
      return next;
    });
  };

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;
  const grouped = groupSettings(settingsSchema);

  return (
    <div style={{ maxWidth: 760 }}>
      <form onSubmit={save}>
        {Object.entries(grouped).map(([groupName, fields]) => (
          <div key={groupName} className="glass-panel">
            <h3>{groupName}</h3>
            {fields.map(setting => (
              <div key={setting.key} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>{setting.label}{setting.required && <span style={{ color: '#DC2626' }}> *</span>}</label>
                {setting.type === 'select' ? (
                  <select
                    value={settings[setting.key] || setting.defaultValue || ''}
                    onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4, background: '#fff' }}
                  >
                    <option value="">Select...</option>
                    {(setting.options || []).map(option => {
                      const value = typeof option === 'string' ? option : option.value;
                      const label = typeof option === 'string' ? option : option.label;
                      return <option key={value} value={value}>{label}</option>;
                    })}
                  </select>
                ) : setting.type === 'checkbox' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={settings[setting.key] === true || settings[setting.key] === 'true' || settings[setting.key] === '1'}
                      onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.checked }))}
                    />
                    Enabled
                  </label>
                ) : (
                  <input
                    type={setting.type === 'url' ? 'url' : setting.type === 'number' ? 'number' : 'text'}
                    value={settings[setting.key] || ''}
                    onFocus={() => { if (settings[setting.key] === SECRET_MASK) setSettings(current => ({ ...current, [setting.key]: '' })); }}
                    onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: 4 }}
                  />
                )}
                {storedSecrets[setting.key] && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>A secret value is stored. Keep *** to leave it unchanged.</div>}
              </div>
            ))}
            {supportsValidation && groupName.toLowerCase().includes('configuration') && (
              <button className="btn-primary" type="button" onClick={validate} disabled={validating}>
                {validating ? 'Validating...' : (meta.display?.settings?.validateButtonLabel || 'Validate Credentials')}
              </button>
            )}
            {validationResult && groupName.toLowerCase().includes('configuration') && (
              <div style={{ marginTop: '0.75rem', color: validationResult.ok === false ? '#DC2626' : '#15803D' }}>
                {validationResult.message || JSON.stringify(validationResult)}
              </div>
            )}
          </div>
        ))}
        {supportsSchedule && (
          <div className="glass-panel">
            <h3>Schedule</h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" checked={scheduleUi.enabled} onChange={e => updateSchedule({ enabled: e.target.checked })} />
              Schedule enabled
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(54px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              {WEEKDAYS.map(day => (
                <button key={day.value} type="button" className={scheduleUi.days.includes(day.value) ? 'btn-primary' : 'btn-secondary'} onClick={() => updateSchedule({ enabled: true, days: scheduleUi.days.includes(day.value) ? scheduleUi.days.filter(value => value !== day.value) : [...scheduleUi.days, day.value] })}>
                  {day.label}
                </button>
              ))}
            </div>
            <input type="time" value={scheduleUi.time} onChange={e => updateSchedule({ enabled: true, time: e.target.value })} />
          </div>
        )}
        <button className="btn-primary" type="submit">Save Settings</button>
        {message && <span style={{ marginLeft: '1rem', color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>{message}</span>}
      </form>
    </div>
  );
}

export default Settings;
