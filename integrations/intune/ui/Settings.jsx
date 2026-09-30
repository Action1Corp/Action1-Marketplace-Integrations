import { useEffect, useMemo, useState } from 'react';
import settingsSchema from './settingsSchema.json';
import {
  SECRET_MASK,
  groupSettings
} from './viewToolkit.jsx';

function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const sensitiveSettings = useMemo(() => new Set(settingsSchema.filter(setting => setting.type === 'secret' || setting.sensitive).map(setting => setting.key)), []);
  const supportsValidation = Boolean(meta?.operations?.validate);

  useEffect(() => {
    Promise.all([fetch(`/api/marketplace/${integration}`).then(r => r.json()), fetch('/api/settings').then(r => r.json())])
      .then(([nextMeta, data]) => {
        const nextSettings = { ...(data.settings || {}) };
        for (const setting of settingsSchema || []) {
          if ((setting.type === 'secret' || setting.sensitive) && data.storedSecrets?.[setting.key]) nextSettings[setting.key] = SECRET_MASK;
        }
        setMeta(nextMeta);
        setSettings(nextSettings);
        setStoredSecrets(data.storedSecrets || {});
      });
  }, [integration]);

  const save = async (event) => {
    event.preventDefault();
    const payload = { _integration: integration };
    for (const setting of settingsSchema) {
      if (sensitiveSettings.has(setting.key) && settings[setting.key] === SECRET_MASK) continue;
      payload[setting.key] = settings[setting.key] || '';
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
        payload[setting.key] = SECRET_MASK;
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
      const response = await fetch(`/api/integrations/${integration}/actions/validate-configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: validationPayload() })
      });
      const data = await response.json();
      setValidationResult(data);
    } catch (error) {
      setValidationResult({ ok: false, message: error.message });
    } finally {
      setValidating(false);
    }
  };

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;
  const grouped = groupSettings(settingsSchema);

  return (
    <div style={{ maxWidth: 760 }}>
      <form className="settings-form-with-sticky-save" onSubmit={save}>
        {Object.entries(grouped).map(([groupName, fields]) => (
          <div key={groupName} className="glass-panel" style={{ marginBottom: '1.5rem' }}>
            <h3>{groupName}</h3>
            <p style={{ marginTop: 0, color: '#4B5563', fontSize: '0.9rem', lineHeight: 1.45 }}>
              Enter the Microsoft Intune application credentials used to publish and assign Action1 agents. Action1 organizations and enrollment targets are configured under Profiles.
            </p>
            {fields.map(setting => (
              <div key={setting.key} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>{setting.label}{setting.required && <span style={{ color: '#DC2626' }}> *</span>}</label>
                <input
                  type={setting.type === 'secret' ? 'password' : 'text'}
                  value={settings[setting.key] || ''}
                  onFocus={() => { if (settings[setting.key] === SECRET_MASK) setSettings(current => ({ ...current, [setting.key]: '' })); }}
                  onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff', color: '#111827', boxSizing: 'border-box' }}
                />
                {storedSecrets[setting.key] && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>A secret value is stored. Keep *** to leave it unchanged.</div>}
              </div>
            ))}
            {supportsValidation && (
              <button className="btn-section-action action1-action" type="button" onClick={validate} disabled={validating}>
                {validating ? 'Validating...' : 'Validate Credentials'}
              </button>
            )}
            {validationResult && (
              <div style={{ marginTop: '0.75rem', color: validationResult.ok === false ? '#DC2626' : '#15803D' }}>
                {validationResult.message || JSON.stringify(validationResult)}
              </div>
            )}
          </div>
        ))}
        <div className="sticky-save-actions">
          <button className="btn-section-action action1-action" type="submit">Save Settings</button>
          {message && <span style={{ color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>{message}</span>}
        </div>
      </form>
    </div>
  );
}

export default Settings;
