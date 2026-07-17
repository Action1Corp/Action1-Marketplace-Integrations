import { useEffect, useMemo, useState } from 'react';
import settingsSchema from './settingsSchema.json';
import {
  ATTRIBUTE_GROUP,
  CONNECTION_GROUP,
  SECRET_MASK,
  buildLoadedSettingsState,
  buildSavePayload,
  buildValidationRequestSettings,
  getConnectionSummary,
  getDisplayedSettingValue,
  getSettingsGroup,
  groupSettings,
  isConnectionConfigured,
  missingRequiredSettings,
  pickSettingsValues
} from '../settingsResolver.mjs';
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
  cards: {
    display: 'grid',
    gap: '0.5rem'
  },
  card: {
    display: 'grid',
    gap: '0.9rem'
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

function Settings({ integration }) {
  const [meta, setMeta] = useState(null);
  const [connectionSettings, setConnectionSettings] = useState({});
  const [savedConnectionSettings, setSavedConnectionSettings] = useState({});
  const [attributeSettings, setAttributeSettings] = useState({});
  const [connectionEditing, setConnectionEditing] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [attributeMessage, setAttributeMessage] = useState('');
  const [connectionValidationResult, setConnectionValidationResult] = useState(null);
  const [validatingConnection, setValidatingConnection] = useState(false);
  const [storedSecrets, setStoredSecrets] = useState({});

  const groupedSettings = useMemo(() => groupSettings(settingsSchema), []);
  const connectionSchema = useMemo(() => getSettingsGroup(settingsSchema, CONNECTION_GROUP), []);
  const attributeSchema = useMemo(() => getSettingsGroup(settingsSchema, ATTRIBUTE_GROUP), []);
  const sensitiveSettings = useMemo(() => new Set(
    settingsSchema
      .filter((setting) => setting.type === 'secret' || setting.sensitive)
      .map((setting) => setting.key)
  ), []);
  const connectionConfigured = isConnectionConfigured(connectionSchema, connectionSettings, {
    storedSecrets,
    secretMask: SECRET_MASK
  });
  const supportsValidation = Boolean(meta?.operations?.validate);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/marketplace/${integration}`).then((response) => response.json()),
      fetch('/api/settings').then((response) => response.json())
    ])
      .then(([nextMeta, data]) => {
        if (cancelled) return;

        const nextStoredSecrets = data.storedSecrets || {};
        const nextState = buildLoadedSettingsState(
          settingsSchema,
          data.settings || {},
          {
            storedSecrets: nextStoredSecrets,
            secretMask: SECRET_MASK
          }
        );

        setMeta(nextMeta);
        setConnectionSettings(nextState.connectionSettings);
        setSavedConnectionSettings(nextState.connectionSettings);
        setAttributeSettings(nextState.attributeSettings);
        setStoredSecrets(nextStoredSecrets);
        setConnectionEditing(nextState.connectionEditing);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMeta(null);
        const nextState = buildLoadedSettingsState(settingsSchema, {}, {
          storedSecrets: {},
          secretMask: SECRET_MASK
        });
        setConnectionSettings(nextState.connectionSettings);
        setSavedConnectionSettings(nextState.connectionSettings);
        setAttributeSettings(nextState.attributeSettings);
        setStoredSecrets({});
        setConnectionEditing(nextState.connectionEditing);
        setSettingsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attributeSchema, connectionSchema, integration]);

  const updateConnectionSettings = (updater) => {
    setConnectionSettings((current) => (typeof updater === 'function' ? updater(current) : updater));
    setConnectionValidationResult(null);
    setConnectionMessage('');
  };

  const saveConnectionSettings = async () => {
    const missing = missingRequiredSettings(connectionSchema, connectionSettings, {
      storedSecrets,
      secretMask: SECRET_MASK
    });
    if (missing.length > 0) {
      setConnectionValidationResult({
        ok: false,
        message: `Missing required Microsoft Entra settings: ${missing.join(', ')}`
      });
      setConnectionMessage('');
      setConnectionEditing(true);
      return;
    }

    const payload = buildSavePayload(connectionSchema, integration, connectionSettings, {
      sensitiveKeys: sensitiveSettings,
      secretMask: SECRET_MASK
    });

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setConnectionMessage('Unable to save connection settings.');
      setConnectionEditing(true);
      return;
    }

    const nextStoredSecrets = payload.EntraClientSecret ? { ...storedSecrets, EntraClientSecret: true } : storedSecrets;
    const nextConnectionSettings = payload.EntraClientSecret
      ? { ...connectionSettings, EntraClientSecret: SECRET_MASK }
      : connectionSettings;

    setStoredSecrets(nextStoredSecrets);
    setSavedConnectionSettings(nextConnectionSettings);
    setConnectionSettings(nextConnectionSettings);
    setConnectionMessage('Connection settings saved successfully.');
    setConnectionValidationResult(null);
    setConnectionEditing(false);
  };

  const saveAttributeSettings = async () => {
    const missing = missingRequiredSettings(attributeSchema, attributeSettings);
    if (missing.length > 0) {
      setAttributeMessage(`Missing required Action1 custom attribute settings: ${missing.join(', ')}`);
      return;
    }

    const payload = buildSavePayload(attributeSchema, integration, attributeSettings, {
      sensitiveKeys: sensitiveSettings,
      secretMask: SECRET_MASK
    });

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    setAttributeMessage(response.ok ? 'Attribute settings saved successfully.' : 'Unable to save attribute settings.');
  };

  const cancelConnectionEdit = () => {
    setConnectionSettings(savedConnectionSettings);
    setConnectionMessage('');
    setConnectionValidationResult(null);
    setConnectionEditing(false);
  };

  const testConnection = async (settingsSnapshot = connectionSettings) => {
    if (validatingConnection || !supportsValidation) {
      return;
    }

    setValidatingConnection(true);
    setConnectionValidationResult(null);
    setConnectionMessage('');

    try {
      const payload = buildValidationRequestSettings(connectionSchema, settingsSnapshot, {
        sensitiveKeys: sensitiveSettings,
        secretMask: SECRET_MASK,
        storedSecrets
      });

      const response = await fetch(`/api/integrations/${integration}/actions/validate-configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload })
      });
      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Malformed validation response.');
      }

      setConnectionValidationResult({
        ok: data.ok !== false,
        message: String(data.message || 'Microsoft Entra connection failed: Unexpected validation response.')
      });
    } catch {
      setConnectionValidationResult({
        ok: false,
        message: 'Microsoft Entra connection failed: Unable to validate Microsoft Graph access.'
      });
    } finally {
      setValidatingConnection(false);
    }
  };

  const renderField = (setting, values, onChange) => (
    <label key={setting.key} style={{ display: 'grid', gap: '0.35rem' }}>
      <span style={{ fontWeight: 600 }}>{setting.label}</span>
      <input
        type={setting.type === 'secret' ? 'password' : 'text'}
        value={getDisplayedSettingValue(setting, values)}
        placeholder={setting.type === 'secret' && storedSecrets[setting.key] ? 'Saved (leave unchanged)' : undefined}
        onChange={(event) => onChange((current) => ({ ...current, [setting.key]: event.target.value }))}
        style={{
          padding: '0.7rem',
          border: '1px solid var(--border-color)',
          borderRadius: 6
        }}
      />
      {setting.helpText ? (
        <span style={{ color: '#526173', fontSize: '0.86rem', lineHeight: 1.5 }}>{setting.helpText}</span>
      ) : null}
    </label>
  );

  const renderConnectionSummary = () => (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {getConnectionSummary(connectionSettings).map((line, index) => (
        <p
          key={line}
          style={{
            margin: 0,
            color: index === 0 ? '#166534' : '#526173',
            fontWeight: index === 0 ? 600 : 400,
            fontSize: index === 0 ? undefined : '0.9rem'
          }}
        >
          {line}
        </p>
      ))}
      <div>
        <button className="btn-primary" type="button" onClick={() => {
          setConnectionSettings(savedConnectionSettings);
          setConnectionEditing(true);
          setConnectionValidationResult(null);
          setConnectionMessage('');
        }}>Edit</button>
        {supportsValidation ? (
          <button className="btn-secondary" type="button" onClick={() => testConnection(savedConnectionSettings)} disabled={validatingConnection} style={{ marginLeft: '0.6rem' }}>
            {validatingConnection ? 'Testing connection...' : 'Test Connection'}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (!settingsLoaded) {
    return (
      <div style={pageStyles.page}>
        <div style={pageStyles.header}>
          <h1 className="page-title" style={pageStyles.title}>Settings</h1>
          <p style={pageStyles.description}>
            Set up Microsoft Entra credentials and choose the Action1 custom attributes used for synced device data.
          </p>
        </div>

        <section className="glass-panel" style={pageStyles.card}>
          <p style={{ margin: 0, color: '#526173' }}>Loading settings...</p>
        </section>
      </div>
    );
  }

  return (
    <div style={pageStyles.page}>
      <div style={pageStyles.header}>
        <h1 className="page-title" style={pageStyles.title}>Settings</h1>
        <p style={pageStyles.description}>
          Set up Microsoft Entra credentials and choose the Action1 custom attributes used for synced device data.
        </p>
      </div>

      <div style={pageStyles.cards}>
        <section className="glass-panel" style={pageStyles.card}>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <h2 style={pageStyles.cardTitle}>Entra Connection</h2>
            <p style={{ margin: 0, color: '#526173', fontSize: '0.9rem', lineHeight: 1.55 }}>
              Enter the Microsoft Entra directory and application credentials used to read device and group membership data.
            </p>
          </div>

          {connectionEditing ? (
            <>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {groupedSettings['Entra Configuration'].map((setting) => renderField(setting, connectionSettings, updateConnectionSettings))}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button className="btn-primary" type="button" onClick={saveConnectionSettings}>Save Connection Settings</button>
                {supportsValidation ? (
                  <button className="btn-secondary" type="button" onClick={() => testConnection(connectionSettings)} disabled={validatingConnection}>
                    {validatingConnection ? 'Testing connection...' : 'Test Connection'}
                  </button>
                ) : null}
                {connectionConfigured && connectionEditing ? (
                  <button className="btn-secondary" type="button" onClick={cancelConnectionEdit}>Cancel</button>
                ) : null}
              </div>
            </>
          ) : renderConnectionSummary()}

          {connectionValidationResult ? (
            <p style={{ margin: 0, color: connectionValidationResult.ok ? '#166534' : '#B42318' }}>{connectionValidationResult.message}</p>
          ) : null}
          {connectionMessage ? (
            <p style={{ margin: 0, color: connectionMessage.includes('successfully') ? '#166534' : '#B42318' }}>{connectionMessage}</p>
          ) : null}
        </section>

        <section className="glass-panel" style={pageStyles.card}>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <h2 style={pageStyles.cardTitle}>Action1 Custom Attributes</h2>
            <p style={{ margin: 0, color: '#526173', fontSize: '0.9rem', lineHeight: 1.55 }}>
              Create these custom attributes in every mapped Action1 organization before running sync. Names are case-sensitive.
            </p>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {groupedSettings['Action1 Custom Attributes'].map((setting) => renderField(setting, attributeSettings, setAttributeSettings))}
          </div>

          {attributeMessage ? (
            <p style={{ margin: 0, color: attributeMessage.includes('successfully') ? '#166534' : '#B42318' }}>{attributeMessage}</p>
          ) : null}

          <div>
            <button className="btn-primary" type="button" onClick={saveAttributeSettings}>Save Attribute Settings</button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
