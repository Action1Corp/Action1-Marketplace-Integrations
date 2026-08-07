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
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupMessage, setGroupMessage] = useState('');
  const [deviceGroups, setDeviceGroups] = useState([]);
  const [loadingAction1Groups, setLoadingAction1Groups] = useState(false);
  const [action1GroupMessage, setAction1GroupMessage] = useState('');
  const [action1EndpointGroups, setAction1EndpointGroups] = useState([]);
  const [validatingAssignments, setValidatingAssignments] = useState(false);
  const [assignmentValidation, setAssignmentValidation] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [attemptedAutoLoadGroups, setAttemptedAutoLoadGroups] = useState(false);
  const [attemptedAutoLoadAction1Groups, setAttemptedAutoLoadAction1Groups] = useState(false);
  const sensitiveSettings = useMemo(() => new Set(settingsSchema.filter(setting => setting.type === 'secret' || setting.sensitive).map(setting => setting.key)), [settingsSchema]);
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
    payload.IntuneDeviceGroupMap = settings.IntuneDeviceGroupMap || '';
    payload.IntuneProvisioningAction1GroupMap = settings.IntuneProvisioningAction1GroupMap || '';
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

  const parseJsonListSetting = (key) => {
    const value = settings[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    const text = String(value || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {}
    return text.split(',').map(item => item.trim()).filter(Boolean);
  };

  const parseJsonMapSetting = (key) => {
    const value = settings[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    const text = String(value || '').trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {}
    return {};
  };

  const parseSelectedGroupIds = () => parseJsonListSetting('IntuneDeviceGroupIds');
  const parseSelectedGroupMap = () => parseJsonMapSetting('IntuneDeviceGroupMap');
  const parseSelectedAction1GroupIds = () => parseJsonListSetting('IntuneProvisioningAction1GroupIds');
  const parseSelectedAction1GroupMap = () => parseJsonMapSetting('IntuneProvisioningAction1GroupMap');

  const setSelectedGroupIds = (ids) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const groupMap = {};
    for (const group of deviceGroups) {
      if (uniqueIds.includes(group.id)) groupMap[group.id] = group.displayName || group.id;
    }
    setSettings(current => ({
      ...current,
      IntuneDeviceGroupIds: JSON.stringify(uniqueIds),
      IntuneDeviceGroupMap: JSON.stringify({ ...parseSelectedGroupMap(), ...groupMap })
    }));
  };

  const setSelectedAction1GroupIds = (ids) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const groupMap = {};
    for (const group of action1EndpointGroups) {
      if (uniqueIds.includes(group.id)) groupMap[group.id] = group.name || group.id;
    }
    setSettings(current => ({
      ...current,
      IntuneProvisioningAction1GroupIds: JSON.stringify(uniqueIds),
      IntuneProvisioningAction1GroupMap: JSON.stringify({ ...parseSelectedAction1GroupMap(), ...groupMap })
    }));
  };

  const loadDeviceGroups = async () => {
    setLoadingGroups(true);
    setGroupMessage('');
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/list-device-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: validationPayload(), trackHistory: false })
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Unable to load Intune device groups.');
      const groups = data.groups || [];
      const selectedGroupIds = parseSelectedGroupIds();
      const nextGroupMap = { ...parseSelectedGroupMap() };
      for (const group of groups) {
        if (selectedGroupIds.includes(group.id)) nextGroupMap[group.id] = group.displayName || group.id;
      }
      setDeviceGroups(groups);
      setSettings(current => ({ ...current, IntuneDeviceGroupMap: JSON.stringify(nextGroupMap) }));
      setGroupMessage(data.message || `Loaded ${(data.groups || []).length} groups.`);
    } catch (error) {
      setGroupMessage(error.message);
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadAction1EndpointGroups = async () => {
    setLoadingAction1Groups(true);
    setAction1GroupMessage('');
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/list-action1-endpoint-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: validationPayload(), trackHistory: false })
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Unable to load Action1 endpoint groups.');
      const groups = data.groups || [];
      const selectedGroupIds = parseSelectedAction1GroupIds();
      const nextGroupMap = { ...parseSelectedAction1GroupMap() };
      for (const group of groups) {
        if (selectedGroupIds.includes(group.id)) nextGroupMap[group.id] = group.name || group.id;
      }
      setAction1EndpointGroups(groups);
      setSettings(current => ({ ...current, IntuneProvisioningAction1GroupMap: JSON.stringify(nextGroupMap) }));
      setAction1GroupMessage(data.message || `Loaded ${groups.length} endpoint groups.`);
    } catch (error) {
      setAction1GroupMessage(error.message);
    } finally {
      setLoadingAction1Groups(false);
    }
  };

  useEffect(() => {
    if (!meta || attemptedAutoLoadGroups || loadingGroups) return;
    if ((settings.IntuneAssignmentTargetMode || 'allDevices') !== 'selectedGroups') return;
    if (parseSelectedGroupIds().length === 0 || deviceGroups.length > 0) return;
    setAttemptedAutoLoadGroups(true);
    loadDeviceGroups();
  }, [meta, settings.IntuneAssignmentTargetMode, settings.IntuneDeviceGroupIds, attemptedAutoLoadGroups, loadingGroups, deviceGroups.length]);

  useEffect(() => {
    if (!meta || attemptedAutoLoadAction1Groups || loadingAction1Groups) return;
    if (parseSelectedAction1GroupIds().length === 0 || action1EndpointGroups.length > 0) return;
    setAttemptedAutoLoadAction1Groups(true);
    loadAction1EndpointGroups();
  }, [meta, settings.IntuneProvisioningAction1GroupIds, attemptedAutoLoadAction1Groups, loadingAction1Groups, action1EndpointGroups.length]);

  const validateAssignments = async () => {
    setValidatingAssignments(true);
    setAssignmentValidation(null);
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/validate-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: validationPayload(), trackHistory: false })
      });
      const data = await response.json();
      setAssignmentValidation(data);
    } catch (error) {
      setAssignmentValidation({ ok: false, message: error.message });
    } finally {
      setValidatingAssignments(false);
    }
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
  const assignmentMode = settings.IntuneAssignmentTargetMode || 'allDevices';
  const selectedGroupIds = parseSelectedGroupIds();
  const selectedGroupSet = new Set(selectedGroupIds);
  const selectedGroupMap = parseSelectedGroupMap();
  const selectedGroupLabels = selectedGroupIds.map(groupId => deviceGroups.find(group => group.id === groupId)?.displayName || selectedGroupMap[groupId] || (loadingGroups ? 'Loading selected group...' : 'Group name unavailable'));
  const selectedAction1GroupIds = parseSelectedAction1GroupIds();
  const selectedAction1GroupSet = new Set(selectedAction1GroupIds);
  const selectedAction1GroupMap = parseSelectedAction1GroupMap();
  const selectedAction1GroupLabels = selectedAction1GroupIds.map(groupId => action1EndpointGroups.find(group => group.id === groupId)?.name || selectedAction1GroupMap[groupId] || (loadingAction1Groups ? 'Loading selected group...' : 'Group name unavailable'));
  const savedAction1Groups = selectedAction1GroupIds
    .filter(groupId => !action1EndpointGroups.some(group => group.id === groupId))
    .map(groupId => ({ id: groupId, name: selectedAction1GroupMap[groupId] || groupId }));
  const displayedAction1EndpointGroups = action1EndpointGroups.length ? action1EndpointGroups : savedAction1Groups;
  const hiddenSettingKeys = new Set(['IntuneDeviceGroupIds', 'IntuneProvisioningAction1GroupIds', 'IntuneProvisioningAction1GroupMap']);

  return (
    <div style={{ maxWidth: 760 }}>
      <form onSubmit={save}>
        {Object.entries(grouped).map(([groupName, fields]) => (
          <div key={groupName} className="glass-panel" style={{ marginBottom: '1.5rem' }}>
            <h3>{groupName}</h3>
            {fields.filter(setting => !hiddenSettingKeys.has(setting.key)).map(setting => (
              <div key={setting.key} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>{setting.label}{setting.required && <span style={{ color: '#DC2626' }}> *</span>}</label>
                {setting.type === 'select' ? (
                  <select
                    value={settings[setting.key] || setting.defaultValue || ''}
                    onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff', color: '#111827', boxSizing: 'border-box' }}
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
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff', color: '#111827', boxSizing: 'border-box' }}
                  />
                )}
                {storedSecrets[setting.key] && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#6B7280' }}>A secret value is stored. Keep *** to leave it unchanged.</div>}
              </div>
            ))}
            {groupName === 'Action1 Agent Assignments' && (
              <div style={{ marginTop: '0.5rem' }}>
                <p style={{ marginTop: 0, color: '#4B5563', fontSize: '0.9rem', lineHeight: 1.45 }}>
                  Select the Intune device groups whose devices should receive the Action1 Agent app.
                </p>
                {assignmentMode === 'selectedGroups' ? (
                  <>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <button className="btn-section-action action1-action" type="button" onClick={loadDeviceGroups} disabled={loadingGroups}>
                        {loadingGroups ? 'Loading groups...' : 'Load Device Groups'}
                      </button>
                      <span style={{ fontSize: '0.82rem', color: groupMessage.includes('Unable') || groupMessage.includes('Failed') ? '#DC2626' : '#6B7280' }}>{groupMessage}</span>
                    </div>
                    {selectedGroupIds.length > 0 && (
                      <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: '#374151' }}>
                        Selected: {selectedGroupLabels.join(', ')}
                      </div>
                    )}
                    <div style={{ border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff', maxHeight: 260, overflowY: 'auto' }}>
                      {deviceGroups.length === 0 ? (
                        <div style={{ padding: '0.85rem', color: '#6B7280', fontSize: '0.85rem' }}>Load groups to choose assignment targets.</div>
                      ) : deviceGroups.map(group => (
                        <label key={group.id} style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', padding: '0.7rem 0.85rem', borderBottom: '1px solid #EEF2F7', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selectedGroupSet.has(group.id)}
                            onChange={event => {
                              setSelectedGroupIds(event.target.checked
                                ? [...selectedGroupIds, group.id]
                                : selectedGroupIds.filter(groupId => groupId !== group.id));
                            }}
                          />
                          <span>
                            <span style={{ display: 'block', fontWeight: 700 }}>{group.displayName}</span>
                            <span style={{ display: 'block', color: '#6B7280', fontSize: '0.78rem' }}>
                              {group.dynamic ? 'Dynamic group' : 'Assigned group'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '0.85rem', border: '1px solid #BFDBFE', borderRadius: 4, background: '#EFF6FF', color: '#1E3A8A', fontSize: '0.85rem' }}>
                    The single Action1 Agent Win32 app will be assigned as required to Intune All devices.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
                  <button className="btn-section-action action1-action" type="button" onClick={validateAssignments} disabled={validatingAssignments}>
                    {validatingAssignments ? 'Validating assignments...' : 'Validate Assignments'}
                  </button>
                  {assignmentValidation && (
                    <span style={{ color: assignmentValidation.ok === false ? '#DC2626' : '#15803D', fontSize: '0.85rem' }}>
                      {assignmentValidation.message || JSON.stringify(assignmentValidation)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {groupName === 'Action1 Provisioning' && (
              <div style={{ marginTop: '0.5rem' }}>
                <p style={{ marginTop: 0, color: '#4B5563', fontSize: '0.9rem', lineHeight: 1.45 }}>
                  Select the Action1 endpoint groups whose automations should be treated as provisioning automations.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <button className="btn-section-action action1-action" type="button" onClick={loadAction1EndpointGroups} disabled={loadingAction1Groups}>
                    {loadingAction1Groups ? 'Loading endpoint groups...' : 'Load Action1 Endpoint Groups'}
                  </button>
                  <span style={{ fontSize: '0.82rem', color: action1GroupMessage.includes('Unable') || action1GroupMessage.includes('Failed') || action1GroupMessage.includes('required') ? '#DC2626' : '#6B7280' }}>{action1GroupMessage}</span>
                </div>
                {selectedAction1GroupIds.length > 0 && (
                  <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: '#374151' }}>
                    Selected: {selectedAction1GroupLabels.join(', ')}
                  </div>
                )}
                <div style={{ border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff', maxHeight: 260, overflowY: 'auto' }}>
                  {displayedAction1EndpointGroups.length === 0 ? (
                    <div style={{ padding: '0.85rem', color: '#6B7280', fontSize: '0.85rem' }}>Load Action1 endpoint groups to choose provisioning groups.</div>
                  ) : displayedAction1EndpointGroups.map(group => (
                    <label key={group.id} style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', padding: '0.7rem 0.85rem', borderBottom: '1px solid #EEF2F7', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedAction1GroupSet.has(group.id)}
                        onChange={event => {
                          setSelectedAction1GroupIds(event.target.checked
                            ? [...selectedAction1GroupIds, group.id]
                            : selectedAction1GroupIds.filter(groupId => groupId !== group.id));
                        }}
                      />
                      <span style={{ display: 'block', fontWeight: 700 }}>{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {supportsValidation && groupName.toLowerCase().includes('configuration') && (
              <button className="btn-section-action action1-action" type="button" onClick={validate} disabled={validating}>
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
        <button className="btn-section-action action1-action" type="submit">Save Settings</button>
        {message && <span style={{ marginLeft: '1rem', color: message.includes('Unable') ? '#DC2626' : '#15803D' }}>{message}</span>}
      </form>
    </div>
  );
}

export default Settings;

