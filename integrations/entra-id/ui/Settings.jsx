import { useEffect, useMemo, useState } from 'react';
import settingsSchema from './settingsSchema.json';
import {
  ATTRIBUTE_GROUP,
  CONNECTION_GROUP,
  SECRET_MASK,
  buildLoadedSettingsState,
  buildSavePayload,
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
  const [connectionSettings, setConnectionSettings] = useState({});
  const [savedConnectionSettings, setSavedConnectionSettings] = useState({});
  const [attributeSettings, setAttributeSettings] = useState({});
  const [connectionEditing, setConnectionEditing] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [attributeMessage, setAttributeMessage] = useState('');
  const [connectionValidationResult, setConnectionValidationResult] = useState(null);
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

  useEffect(() => {
    let cancelled = false;

    fetch('/api/settings')
      .then((response) => response.json())
      .then((data) => {
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

        setConnectionSettings(nextState.connectionSettings);
        setSavedConnectionSettings(nextState.connectionSettings);
        setAttributeSettings(nextState.attributeSettings);
        setStoredSecrets(nextStoredSecrets);
        setConnectionEditing(nextState.connectionEditing);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
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
    setConnectionValidationResult({ ok: true, message: 'Configuration values are present.' });
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
        <button className="btn-primary" type="button" onClick={() => setConnectionEditing(true)}>Edit</button>
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
              Enter the Microsoft Entra tenant and application credentials used to read device and group membership data.
            </p>
          </div>

          {connectionEditing ? (
            <>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {groupedSettings['Entra Configuration'].map((setting) => renderField(setting, connectionSettings, setConnectionSettings))}
              </div>

              {connectionValidationResult ? (
                <p style={{ margin: 0, color: connectionValidationResult.ok ? '#166534' : '#B42318' }}>{connectionValidationResult.message}</p>
              ) : null}
              {connectionMessage ? (
                <p style={{ margin: 0, color: connectionMessage.includes('successfully') ? '#166534' : '#B42318' }}>{connectionMessage}</p>
              ) : null}

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button className="btn-primary" type="button" onClick={saveConnectionSettings}>Save Connection Settings</button>
                {connectionConfigured && connectionEditing ? (
                  <button className="btn-secondary" type="button" onClick={cancelConnectionEdit}>Cancel</button>
                ) : null}
              </div>
            </>
          ) : renderConnectionSummary()}
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
