import { useEffect, useMemo, useRef, useState } from 'react';
import settingsSchema from './settingsSchema.json';
import { UI_PROVIDER_REGISTRY, isUiProviderAvailable, listSelectableProviders } from './providerRegistry';
import { hasUnsavedProviderSettings, isCurrentProviderRequest, restoreViewedProviderSettings } from './providerSettingsState.mjs';
import {
  getEffectiveSettingValue as resolveEffectiveSettingValue,
  serializeSettingValue as resolveSerializedSettingValue,
  updateCsvSelection
} from './settingsValueHelpers';

const SECRET_MASK = '***';
const DISCOVERY_ACTION_ID = 'discover-ticketing-settings-options';
const OPTIONAL_ROUTING_DEFAULT_LABELS = {
  TicketingTeamId: 'Use Action1 Ticketing default team',
  TicketingNewStatusId: 'Use Action1 Ticketing default status',
  TicketingCategory1Id: 'Use Action1 Ticketing default category'
};
const MISSING_VALUE_LABELS = {
  TicketingTeamId: 'Saved team unavailable',
  TicketingTicketTypeId: 'Saved ticket type unavailable',
  TicketingCategory1Id: 'Saved category unavailable',
  TicketingNewStatusId: 'Saved status unavailable',
  TicketingClosedStatusIds: 'Saved closed status unavailable'
};
const EXISTING_OPEN_BEHAVIOR_OPTIONS = [
  {
    value: 'update_existing_open',
    title: 'Update existing open Action1 Ticketing tickets',
    help: 'Keep linked open tickets current when the Action1 signal details change.'
  },
  {
    value: 'skip_existing_open',
    title: 'Skip updating existing open Action1 Ticketing tickets',
    help: 'Create tickets initially, but do not modify linked open tickets after creation.'
  }
];
const INLINE_TOOLTIP_KEYS = new Set([
  'TicketingTeamId',
  'TicketingTicketTypeId',
  'TicketingNewStatusId',
  'TicketingCategory1Id',
  'TicketingClosedStatusIds',
  'TicketingExistingOpenTicketBehavior',
  'TicketingRebootRequiredAgeThresholdEnabled'
]);
const ROUTING_LAYOUT_ORDER = [
  'TicketingTeamId',
  'TicketingTicketTypeId',
  'TicketingNewStatusId',
  'TicketingCategory1Id',
  'TicketingClosedStatusIds'
];
const CONNECTION_SETTING_KEYS = [
  'TicketingResourceServer',
  'TicketingAuthorisationServer',
  'TicketingClientId',
  'TicketingClientSecret'
];
const SIGNAL_FILTER_SETTING_KEYS = [
  'TicketingOfflineEnabled',
  'TicketingOfflineThresholdDays',
  'TicketingRebootRequiredEnabled',
  'TicketingRebootRequiredAgeThresholdEnabled',
  'TicketingRebootRequiredAgeThresholdDays',
  'TicketingAutomationFailedEnabled',
  'TicketingVulnerabilitySeverities',
  'TicketingVulnerabilityRemediationStatuses',
  'TicketingUpdateSeverities',
  'TicketingUpdateRemediationStatuses',
  'TicketingVulnerabilityTicketModel',
  'TicketingUpdateTicketModel',
  'TicketingAutomationFailedTicketModel',
  'TicketingMaxImpactedEndpointsInGroupedTicket',
  'TicketingMaxOpenTicketsPerOrganization'
];
const VULNERABILITY_SEVERITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VULNERABILITY_REMEDIATION_OPTIONS = ['OVERDUE', 'DUE_SOON'];
const UPDATE_SEVERITY_OPTIONS = ['CRITICAL', 'IMPORTANT', 'MODERATE', 'LOW', 'UNSPECIFIED'];
const UPDATE_REMEDIATION_OPTIONS = ['OVERDUE', 'DUE_SOON'];
const MULTI_SELECT_EMPTY_MARKER_KEYS = {
  TicketingVulnerabilitySeverities: 'TicketingVulnerabilitySeveritiesExplicit',
  TicketingVulnerabilityRemediationStatuses: 'TicketingVulnerabilityRemediationStatusesExplicit',
  TicketingUpdateSeverities: 'TicketingUpdateSeveritiesExplicit',
  TicketingUpdateRemediationStatuses: 'TicketingUpdateRemediationStatusesExplicit'
};
const REBOOT_REQUIRED_AGE_THRESHOLD_HELP_TEXT = 'Use this to avoid creating or maintaining reboot-required tickets for endpoints rebooted more recently than the threshold.';
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

function getMissingValueLabel(settingKey) {
  return MISSING_VALUE_LABELS[settingKey] || 'Saved value unavailable';
}

function mergeSavedOption(options, savedValue, fallbackLabel) {
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
      label: fallbackLabel
    }
  ];
}

function mergeSavedMultiOptions(options, savedValues, fallbackLabel) {
  return savedValues.reduce((current, value) => mergeSavedOption(current, value, fallbackLabel), options);
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
        label: name
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

function getSelectPlaceholder(setting) {
  if (OPTIONAL_ROUTING_DEFAULT_LABELS[setting.key]) {
    return OPTIONAL_ROUTING_DEFAULT_LABELS[setting.key];
  }
  if (setting.key === 'TicketingTicketTypeId') {
    return 'Select ticket type';
  }
  return 'Select...';
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
  const vulnerability = String(currentSettings?.TicketingVulnerabilityTicketModel || 'grouped').toLowerCase();
  const update = String(currentSettings?.TicketingUpdateTicketModel || 'grouped').toLowerCase();
  const automation = String(currentSettings?.TicketingAutomationFailedTicketModel || 'grouped').toLowerCase();
  return vulnerability === 'grouped' && update === 'grouped' && automation === 'grouped' ? 'grouped' : 'endpoint';
}

function InfoTip({ text }) {
  return (
    <span
      className="action1-ticketing-info-tip"
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
  const [activeProviderId, setActiveProviderId] = useState('connectwise-psa');
  const [viewedProviderId, setViewedProviderId] = useState('connectwise-psa');
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState({});
  const [storedSecrets, setStoredSecrets] = useState({});
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [connectionExpanded, setConnectionExpanded] = useState(true);
  const [closedStatusesMenuOpen, setClosedStatusesMenuOpen] = useState(false);
  const closedStatusesMenuRef = useRef(null);
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
  const visibleSettingsSchema = useMemo(
    () => settingsSchema.filter((setting) => setting.visible !== false),
    []
  );
  const sensitiveSettings = useMemo(() => new Set([
    settingsSchema
      .filter((setting) => setting.type === 'secret' || setting.sensitive)
      .map((setting) => setting.key),
    ...Object.values(UI_PROVIDER_REGISTRY).flatMap((provider) => (provider.fields || [])
      .filter((field) => field.type === 'secret')
      .map((field) => field.settingKey || `TicketingProvider_${provider.providerId.replace(/-/g, '_')}_${field.key}`))
  ].flat()), []);
  const viewedProvider = UI_PROVIDER_REGISTRY[viewedProviderId];
  const activeProvider = UI_PROVIDER_REGISTRY[activeProviderId];
  const selectableProviders = listSelectableProviders();
  const supportsValidation = Boolean(isUiProviderAvailable(viewedProvider) && meta?.operations?.validate);
  const viewedProviderSettingKeys = viewedProvider?.settingKeys || (viewedProvider?.fields || []).map((field) => field.settingKey || `TicketingProvider_${viewedProvider.providerId.replace(/-/g, '_')}_${field.key}`);
  const customServerKey = 'TicketingProvider_connectwise_psa_CustomServer';
  const requiredConnectionKeys = viewedProviderSettingKeys.filter((key) => key !== customServerKey);
  const isCustomServerMissing = viewedProviderId === 'connectwise-psa'
    && String(settings.TicketingProvider_connectwise_psa_ApiRegion || '') === 'CUSTOM'
    && !String(settings[customServerKey] || '').trim()
    && !storedSecrets[customServerKey];
  const isConnectionConfigured = Boolean(isUiProviderAvailable(viewedProvider) && requiredConnectionKeys.length
    && requiredConnectionKeys.every((key) => String(settings[key] || '').trim() || storedSecrets[key])
    && !isCustomServerMissing);
  const hasUnsavedEdits = hasUnsavedProviderSettings(settings, savedSettingsSnapshot);
  const requestGeneration = useRef(0);
  const settingsRef = useRef(settings);
  const viewedProviderRef = useRef(viewedProviderId);
  useEffect(() => { settingsRef.current = settings; viewedProviderRef.current = viewedProviderId; }, [settings, viewedProviderId]);

  const buildActionPayload = (currentSettings) => {
    const payload = { _secretModes: {} };
    const providerKeys = viewedProviderSettingKeys;
    for (const setting of settingsSchema.filter((row) => row.key !== 'TicketingActiveProvider')) {
      const value = getEffectiveValue(setting, currentSettings);
      if (sensitiveSettings.has(setting.key) && value === SECRET_MASK) {
        payload._secretModes[setting.key] = 'stored';
        continue;
      }
      payload[setting.key] = serializeSettingValue(setting, currentSettings);
    }
    for (const key of providerKeys) {
      if (sensitiveSettings.has(key) && currentSettings[key] === SECRET_MASK) payload._secretModes[key] = 'stored';
      else if (currentSettings[key] !== undefined) payload[key] = currentSettings[key];
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
    const requestId = ++requestGeneration.current;
    const snapshotFingerprint = JSON.stringify(settingsSnapshot);
    const requestIdentity = { providerId: viewedProviderId, generation: requestId, settingsFingerprint: snapshotFingerprint };

    try {
      const response = await fetch(`/api/integrations/${integration}/actions/${DISCOVERY_ACTION_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: viewedProviderId, settings: buildActionPayload(settingsSnapshot) })
      });
      const data = await response.json();
      if (!isCurrentProviderRequest(requestIdentity, { providerId: viewedProviderRef.current, generation: requestGeneration.current, settingsFingerprint: JSON.stringify(settingsRef.current) })) return;
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message || 'Unable to load Action1 Ticketing discovery data.');
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
      if (!isCurrentProviderRequest(requestIdentity, { providerId: viewedProviderRef.current, generation: requestGeneration.current, settingsFingerprint: JSON.stringify(settingsRef.current) })) return;
      setDiscoveryState((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'Unable to load Action1 Ticketing discovery data.'
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
        const nextActiveProvider = String(nextSettings.TicketingActiveProvider || 'connectwise-psa');
        setActiveProviderId(nextActiveProvider);
        setViewedProviderId(nextActiveProvider);
        for (const setting of settingsSchema) {
          if (sensitiveSettings.has(setting.key) && data.storedSecrets?.[setting.key]) {
            nextSettings[setting.key] = SECRET_MASK;
          }
        }
        for (const provider of Object.values(UI_PROVIDER_REGISTRY)) {
          for (const field of provider.fields || []) {
            const key = field.settingKey || `TicketingProvider_${provider.providerId.replace(/-/g, '_')}_${field.key}`;
            if (field.type === 'secret' && data.storedSecrets?.[key]) nextSettings[key] = SECRET_MASK;
          }
        }

        setMeta(nextMeta);
        setSettings(nextSettings);
        setSavedSettingsSnapshot(nextSettings);
        setStoredSecrets(data.storedSecrets || {});
        setConnectionExpanded(!CONNECTION_SETTING_KEYS.every((key) => {
          if (key === 'TicketingClientSecret') {
            return Boolean(data.storedSecrets?.[key] || String(nextSettings[key] || '').trim());
          }
          return Boolean(String(nextSettings[key] || '').trim());
        }));

        loadDiscovery(nextSettings, { silent: true });
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

  useEffect(() => {
    if (!closedStatusesMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!closedStatusesMenuRef.current?.contains(event.target)) {
        setClosedStatusesMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [closedStatusesMenuOpen]);

  const save = async (event) => {
    event.preventDefault();
    const response = await fetch(`/api/integrations/${integration}/actions/save-provider-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: viewedProviderId, settings: buildActionPayload(settings) })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok !== false) {
      setSavedSettingsSnapshot(settings);
      if (isConnectionConfigured) setConnectionExpanded(false);
    }
    setMessage(response.ok && result.ok !== false ? 'Settings saved successfully.' : result.message || 'Unable to save settings.');
  };

  const validate = async () => {
    setValidating(true);
    setValidationResult(null);
    const requestId = ++requestGeneration.current;
    const snapshotFingerprint = JSON.stringify(settings);
    const requestIdentity = { providerId: viewedProviderId, generation: requestId, settingsFingerprint: snapshotFingerprint };
    try {
      const response = await fetch(`/api/integrations/${integration}/actions/validate-configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: viewedProviderId, settings: buildActionPayload(settings) })
      });
      const data = await response.json();
      if (isCurrentProviderRequest(requestIdentity, { providerId: viewedProviderRef.current, generation: requestGeneration.current, settingsFingerprint: JSON.stringify(settingsRef.current) })) setValidationResult(data);
    } catch (error) {
      setValidationResult({ ok: false, message: 'Failed: Unable to validate Action1 Ticketing configuration.' });
    } finally {
      setValidating(false);
    }
  };

  const cancelConnectionEdit = () => {
    setSettings(savedSettingsSnapshot);
    setValidationResult(null);
    setConnectionExpanded(false);
  };

  const changeViewedProvider = (nextProviderId) => {
    if (nextProviderId === viewedProviderId) return;
    if (hasUnsavedEdits && !window.confirm('Discard unsaved settings for this ticketing system?')) return;
    requestGeneration.current += 1;
    const providerKeys = UI_PROVIDER_REGISTRY[nextProviderId]?.settingKeys || [];
    const restored = restoreViewedProviderSettings(savedSettingsSnapshot, nextProviderId, providerKeys);
    setSettings(restored);
    setViewedProviderId(nextProviderId);
    setValidationResult(null);
    setDiscoveryState({ loading: false, error: '', loaded: false, data: { teams: [], ticketTypes: [], statuses: [], categories: [], ticketTypeDetail: null } });
  };

  const makeActive = async () => {
    const label = viewedProvider?.label || 'this ticketing system';
    const currentLabel = activeProvider?.label || activeProviderId;
    const confirmed = window.confirm(`Switch ticketing system? New synchronizations will use ${label}. Settings, mappings, ticket links, and checkpoints for ${currentLabel} will be kept. Shared signal rules stay unchanged. Existing tickets stay in ${currentLabel}; they will not be closed or migrated. The next sync may create tickets for signals that remain active. Switching back resumes saved state.`);
    if (!confirmed) return;
    const response = await fetch(`/api/integrations/${integration}/actions/activate-provider`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: viewedProviderId, expectedCurrentProvider: activeProviderId })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok && result.activeProviderId) {
      setActiveProviderId(result.activeProviderId);
      setMessage(`${viewedProvider?.label || result.activeProviderId} is now active. Synchronization has not started.`);
    } else setMessage(result.message || 'Unable to change the active ticketing system.');
  };

  const updateCsvSetting = (settingKey, optionValue, checked) => {
    setSettings((current) => {
      const nextSettings = {
        ...current,
        [settingKey]: updateCsvSelection(current[settingKey], optionValue, checked)
      };
      const emptySelectionMarkerKey = MULTI_SELECT_EMPTY_MARKER_KEYS[settingKey];
      if (emptySelectionMarkerKey) {
        nextSettings[emptySelectionMarkerKey] = 'true';
      }

      if (settingKey === 'TicketingVulnerabilitySeverities') {
        nextSettings.TicketingVulnerabilityEnabled = hasSelectedCsvValues(nextSettings.TicketingVulnerabilitySeverities) ? 'true' : 'false';
      }

      if (settingKey === 'TicketingUpdateSeverities') {
        nextSettings.TicketingUpdateEnabled = hasSelectedCsvValues(nextSettings.TicketingUpdateSeverities) ? 'true' : 'false';
      }

      return nextSettings;
    });
  };

  const setSharedSignalTicketMode = (mode) => {
    setSettings((current) => ({
      ...current,
      TicketingVulnerabilityTicketModel: mode,
      TicketingUpdateTicketModel: mode,
      TicketingAutomationFailedTicketModel: mode
    }));
  };

  const routingChoices = deriveRoutingChoices(discoveryState.data);
  const grouped = groupSettings(visibleSettingsSchema);

  const renderSingleDiscoverySelect = (setting, rows) => {
    const currentValue = getEffectiveValue(setting, settings);
    const options = mergeSavedOption(
      asSelectOptions(rows),
      currentValue,
      getMissingValueLabel(setting.key)
    );

    if (options.length === 0) {
      return (
        <input
          type="text"
          value={currentValue}
          onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
          style={{ width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
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
          if (setting.key === 'TicketingTicketTypeId') {
            loadDiscovery(nextSettings);
          }
        }}
        style={{ width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff' }}
      >
        <option value="">{getSelectPlaceholder(setting)}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  const renderClosedStatusesControl = (setting) => {
    const currentValue = getEffectiveValue(setting, settings);
    const selectedValues = parseCsvValues(currentValue);
    const options = mergeSavedMultiOptions(
      asSelectOptions(routingChoices.statuses),
      selectedValues,
      getMissingValueLabel(setting.key)
    );
    const selectedSet = new Set(selectedValues);
    const selectedOptions = options.filter((option) => selectedSet.has(option.value));

    if (options.length === 0) {
      return (
        <input
          type="text"
          value={currentValue}
          onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
          style={{ width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
        />
      );
    }

    return (
      <div ref={closedStatusesMenuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-expanded={closedStatusesMenuOpen ? 'true' : 'false'}
          onClick={() => setClosedStatusesMenuOpen((current) => !current)}
          style={{
            width: '100%',
            minHeight: 42,
            border: '1px solid var(--border-color)',
            background: '#fff',
            borderRadius: 8,
            padding: '0.5rem 2.25rem 0.5rem 0.75rem',
            textAlign: 'left',
            position: 'relative',
            cursor: 'pointer'
          }}
        >
          <span
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.4rem',
              alignItems: 'center',
              minHeight: 24
            }}
          >
            {selectedOptions.length > 0 ? selectedOptions.map((option) => (
              <span
                key={option.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 999,
                  background: '#E2E8F0',
                  color: '#0F172A',
                  padding: '0.22rem 0.55rem',
                  fontSize: '0.8rem'
                }}
              >
                {option.label}
              </span>
            )) : (
              <span style={{ color: '#64748B', fontSize: '0.9rem' }}>Select one or more statuses</span>
            )}
          </span>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#64748B',
              fontSize: '0.75rem'
            }}
          >
            {closedStatusesMenuOpen ? '▲' : '▼'}
          </span>
        </button>

        {closedStatusesMenuOpen && (
          <div
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
              maxHeight: 240,
              overflowY: 'auto',
              padding: '0.5rem'
            }}
          >
            {options.map((option) => {
              const checked = selectedSet.has(option.value);
              return (
                <label
                  key={option.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.45rem 0.4rem',
                    borderRadius: 6,
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextValues = new Set(selectedValues);
                      if (event.target.checked) nextValues.add(option.value);
                      else nextValues.delete(option.value);
                      setSettings((current) => ({
                        ...current,
                        [setting.key]: Array.from(nextValues).join(',')
                      }));
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderExistingOpenBehavior = (setting) => {
    const currentValue = getEffectiveValue(setting, settings) || 'update_existing_open';

    return (
      <div
        style={{
          display: 'grid',
          gap: '0.65rem',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          background: '#FBFCFE',
          padding: '0.85rem 0.9rem'
        }}
      >
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
              name="cfg-open-behavior"
              value={option.value}
              checked={currentValue === option.value}
              onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
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

  const renderCheckboxGroup = (settingKey, options) => {
    const selectedValues = new Set(parseCsvValues(getEffectiveValue({ key: settingKey }, settings)));

    return (
      <div style={{ display: 'grid', gap: '0.45rem' }}>
        {options.map((option) => (
          <label
            key={option}
            style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.92rem' }}
          >
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

  const renderSignalFiltersSection = (fields) => {
    const fieldsByKey = new Map(fields.map((setting) => [setting.key, setting]));
    const sharedTicketMode = deriveSharedSignalTicketModel(settings);
    const groupedModeSelected = sharedTicketMode === 'grouped';
    const maxEndpointsSetting = fieldsByKey.get('TicketingMaxImpactedEndpointsInGroupedTicket');
    const maxOpenTicketsSetting = fieldsByKey.get('TicketingMaxOpenTicketsPerOrganization');
    const rebootAgeThresholdSetting = fieldsByKey.get('TicketingRebootRequiredAgeThresholdEnabled');
    const rebootAgeThresholdDaysSetting = fieldsByKey.get('TicketingRebootRequiredAgeThresholdDays');
    const isRebootRequiredEnabled = isChecked(getEffectiveValue({ key: 'TicketingRebootRequiredEnabled' }, settings));
    const isRebootAgeThresholdEnabled = rebootAgeThresholdSetting
      ? isChecked(getEffectiveValue(rebootAgeThresholdSetting, settings))
      : false;

    return (
      <div className="glass-panel">
        <h3>Signal Filters</h3>
        <p style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
          Choose which Action1 endpoint signals should create or maintain Action1 Ticketing tickets.
        </p>

        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.15rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={isChecked(getEffectiveValue({ key: 'TicketingOfflineEnabled' }, settings))}
                onChange={(event) => setSettings((current) => ({ ...current, TicketingOfflineEnabled: event.target.checked ? 'true' : 'false' }))}
              />
              <span>Create ticket after endpoint is offline for at least (days)</span>
            </label>
            <input
              type="number"
              min={1}
              value={getEffectiveValue({ key: 'TicketingOfflineThresholdDays', defaultValue: '7' }, settings)}
              onChange={(event) => setSettings((current) => ({ ...current, TicketingOfflineThresholdDays: event.target.value }))}
              style={{ width: 92, padding: '0.55rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
            />
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={isRebootRequiredEnabled}
              onChange={(event) => setSettings((current) => ({ ...current, TicketingRebootRequiredEnabled: event.target.checked ? 'true' : 'false' }))}
            />
            <span>Create ticket for reboot required endpoints</span>
          </label>

          {rebootAgeThresholdSetting && rebootAgeThresholdDaysSetting && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                flexWrap: 'wrap',
                marginLeft: '1.85rem',
                color: 'var(--text-secondary, #526173)'
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={isRebootAgeThresholdEnabled}
                  disabled={!isRebootRequiredEnabled}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    [rebootAgeThresholdSetting.key]: event.target.checked ? 'true' : 'false'
                  }))}
                />
                <span>
                  Require last boot at least
                  <InfoTip text={REBOOT_REQUIRED_AGE_THRESHOLD_HELP_TEXT} />
                </span>
              </label>
              <input
                type="number"
                min={rebootAgeThresholdDaysSetting.min}
                disabled={!isRebootRequiredEnabled || !isRebootAgeThresholdEnabled}
                value={getEffectiveValue(rebootAgeThresholdDaysSetting, settings)}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  [rebootAgeThresholdDaysSetting.key]: event.target.value
                }))}
                style={{
                  width: 92,
                  padding: '0.55rem 0.65rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  background: isRebootRequiredEnabled && isRebootAgeThresholdEnabled ? '#fff' : '#F8FAFC'
                }}
              />
              <span>days ago</span>
            </div>
          )}

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={isChecked(getEffectiveValue({ key: 'TicketingAutomationFailedEnabled' }, settings))}
              onChange={(event) => setSettings((current) => ({ ...current, TicketingAutomationFailedEnabled: event.target.checked ? 'true' : 'false' }))}
            />
            <span>Create ticket for automation failures</span>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.2rem', alignItems: 'stretch' }}>
          <div style={SIGNAL_FILTER_CARD_STYLE}>
            <h4 style={{ margin: '0 0 0.8rem' }}>Vulnerabilities</h4>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', marginBottom: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Severity
            </div>
            {renderCheckboxGroup('TicketingVulnerabilitySeverities', VULNERABILITY_SEVERITY_OPTIONS)}
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', margin: '0.95rem 0 0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Remediation status
            </div>
            {renderCheckboxGroup('TicketingVulnerabilityRemediationStatuses', VULNERABILITY_REMEDIATION_OPTIONS)}
          </div>

          <div style={SIGNAL_FILTER_CARD_STYLE}>
            <h4 style={{ margin: '0 0 0.8rem' }}>Missing Updates</h4>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', marginBottom: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Severity
            </div>
            {renderCheckboxGroup('TicketingUpdateSeverities', UPDATE_SEVERITY_OPTIONS)}
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#526173', margin: '0.95rem 0 0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Remediation status
            </div>
            {renderCheckboxGroup('TicketingUpdateRemediationStatuses', UPDATE_REMEDIATION_OPTIONS)}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, background: '#FBFCFE', padding: '1rem' }}>
          <h4 style={{ margin: '0 0 0.2rem' }}>
            Ticket creation mode
            <InfoTip text="Choose how Action1 Ticketing tickets are created for vulnerabilities, missing updates, and automation failures." />
          </h4>
          <p style={{ marginTop: 0, marginBottom: '0.9rem', color: '#526173', lineHeight: 1.45 }}>
            Choose how Action1 Ticketing tickets are created for vulnerabilities, missing updates, and automation failures.
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
                name="cfg-ticket-mode"
                value="grouped"
                checked={groupedModeSelected}
                onChange={() => setSharedSignalTicketMode('grouped')}
                style={{ marginTop: 2 }}
              />
              <span style={{ display: 'grid', gap: '0.2rem' }}>
                <span style={{ fontWeight: 700, lineHeight: 1.35 }}>Create tickets per issue</span>
                <span style={{ color: '#526173', fontSize: '0.84rem', lineHeight: 1.45 }}>
                  Creates one Action1 Ticketing ticket per vulnerability, missing update, or automation run, with affected endpoints listed inside.
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
                name="cfg-ticket-mode"
                value="endpoint"
                checked={!groupedModeSelected}
                onChange={() => setSharedSignalTicketMode('endpoint')}
                style={{ marginTop: 2 }}
              />
              <span style={{ display: 'grid', gap: '0.2rem' }}>
                <span style={{ fontWeight: 700, lineHeight: 1.35 }}>Create tickets per endpoint</span>
                <span style={{ color: '#526173', fontSize: '0.84rem', lineHeight: 1.45 }}>
                  Creates one Action1 Ticketing ticket for each affected endpoint.
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
                Applies when "Create tickets per issue" is selected.
              </div>
            </>
          )}
        </div>

        {maxOpenTicketsSetting && (
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 700 }}>
              {maxOpenTicketsSetting.label}
              <InfoTip text={maxOpenTicketsSetting.helpText} />
            </label>
            <input
              type="number"
              min={maxOpenTicketsSetting.min}
              value={getEffectiveValue(maxOpenTicketsSetting, settings)}
              onChange={(event) => setSettings((current) => ({ ...current, [maxOpenTicketsSetting.key]: event.target.value }))}
              style={{ width: 120, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6 }}
            />
          </div>
        )}
      </div>
    );
  };

  const renderSettingControl = (setting) => {
    if (setting.key === 'TicketingTeamId') {
      return renderSingleDiscoverySelect(setting, routingChoices.teams);
    }
    if (setting.key === 'TicketingTicketTypeId') {
      return renderSingleDiscoverySelect(setting, routingChoices.ticketTypes);
    }
    if (setting.key === 'TicketingCategory1Id') {
      return renderSingleDiscoverySelect(setting, routingChoices.categories);
    }
    if (setting.key === 'TicketingNewStatusId') {
      return renderSingleDiscoverySelect(setting, routingChoices.statuses);
    }
    if (setting.key === 'TicketingClosedStatusIds') {
      return renderClosedStatusesControl(setting);
    }
    if (setting.key === 'TicketingExistingOpenTicketBehavior') {
      return renderExistingOpenBehavior(setting);
    }
    if (setting.type === 'select') {
      return (
        <select
          value={getEffectiveValue(setting, settings)}
          onChange={(event) => setSettings((current) => ({ ...current, [setting.key]: event.target.value }))}
          style={{ width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff' }}
        >
          <option value="">{getSelectPlaceholder(setting)}</option>
          {(setting.options || []).map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return <option key={value} value={value}>{label}</option>;
          })}
        </select>
      );
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
      {renderSettingControl(setting)}
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

  if (!meta) return <div style={{ padding: '2rem' }}>Loading settings...</div>;

  return (
    <div style={pageStyles.page}>
      <div style={pageStyles.header}>
        <h1 className="page-title" style={pageStyles.title}>Settings</h1>
        <p style={pageStyles.description}>
          Configure the ticketing connection, routing, shared lifecycle behavior, and Action1 signal rules used by this integration.
        </p>
      </div>
      <form onSubmit={save} style={pageStyles.form}>
        <div className="glass-panel">
          <h3 style={pageStyles.cardTitle}>Connection</h3>
          <p style={{ margin: '0.35rem 0 0.8rem', color: '#526173' }}>Configure the ticketing system used by this integration.</p>
          <label style={{ display: 'grid', gap: '0.35rem', maxWidth: 440 }}>
            <span>Ticketing System</span>
            <select value={viewedProviderId} onChange={(event) => changeViewedProvider(event.target.value)} disabled={selectableProviders.length === 0}>
              {[...Object.values(UI_PROVIDER_REGISTRY)].map((provider) => (
                <option key={provider.providerId} value={provider.providerId} disabled={!provider.available}>
                  {provider.label}{isUiProviderAvailable(provider) ? '' : ' — unavailable in this version'}
                </option>
              ))}
            </select>
          </label>
          <p style={{ margin: '0.8rem 0', color: '#526173' }}>
            Active ticketing system: {activeProvider?.label || activeProviderId}{activeProvider?.available ? '' : ' (not configured or unavailable)'}
          </p>
          {isUiProviderAvailable(viewedProvider) ? (
            <>
              {viewedProvider.ConnectionFields ? <viewedProvider.ConnectionFields settings={settings} setSettings={setSettings} storedSecrets={storedSecrets} /> : null}
              {connectionExpanded && <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                <button className="btn-primary" type="submit">Save Settings</button>
                <button className="btn-secondary" type="button" onClick={validate} disabled={validating}>{validating ? 'Testing connection...' : 'Test Connection'}</button>
                {isConnectionConfigured && <button className="btn-secondary" type="button" onClick={cancelConnectionEdit}>Cancel</button>}
              </div>}
              {!connectionExpanded && <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button className="btn-secondary" type="button" onClick={() => setConnectionExpanded(true)}>Change Settings</button>
                <button className="btn-secondary" type="button" onClick={validate} disabled={validating}>{validating ? 'Testing connection...' : 'Test Connection'}</button>
              </div>}
              {viewedProviderId !== activeProviderId && isConnectionConfigured && <button className="btn-primary" type="button" onClick={makeActive}>Make active</button>}
            </>
          ) : <div role="status" style={{ color: '#8A4B00' }}>
            <p>This ticketing system is not available in this package version. No destination fields are configured, and synchronization cannot use it.</p>
            <button className="btn-secondary" type="button" disabled title="A connection test is unavailable until this provider is implemented">Test Connection</button>
          </div>}
          {validationResult && <p role="status" style={{ color: validationResult.ok ? '#15803D' : '#B42318' }}>{validationResult.message}</p>}
          {message && <p role="status">{message}</p>}
        </div>
        {Object.entries(grouped).map(([groupName, fields]) => {
          if (groupName === 'Ticket Routing') {
            if (!viewedProvider?.RoutingFields) return null;
            const fieldsByKey = new Map(fields.map((setting) => [setting.key, setting]));
            const lifecycleSetting = grouped.Lifecycle?.find((setting) => setting.key === 'TicketingExistingOpenTicketBehavior') || null;
            const closedStatusesField = fieldsByKey.get('TicketingClosedStatusIds') || null;
            const teamField = fieldsByKey.get('TicketingTeamId') || null;
            const ticketTypeField = fieldsByKey.get('TicketingTicketTypeId') || null;
            const newStatusField = fieldsByKey.get('TicketingNewStatusId') || null;
            const categoryField = fieldsByKey.get('TicketingCategory1Id') || null;

            return (
              <div key={groupName} className="glass-panel">
                <h3 style={pageStyles.cardTitle}>Ticket Routing &amp; Lifecycle</h3>
                <p style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
                  Select a Action1 Ticketing ticket type for Action1-created tickets. If Team, Status, or Category are left blank, the connector will use the defaults configured in Action1 Ticketing.
                </p>
                <div style={{ display: 'grid', gap: '0.1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem 1rem' }}>
                    {[teamField, ticketTypeField].filter(Boolean).map((setting) => renderField(setting))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem 1rem' }}>
                    {[newStatusField, categoryField].filter(Boolean).map((setting) => renderField(setting))}
                  </div>
                </div>
                {closedStatusesField && (
                  <div style={{ marginTop: 0 }}>
                    {renderField(closedStatusesField)}
                  </div>
                )}
                {lifecycleSetting && (
                  <div style={{ marginTop: '0.15rem' }}>
                    {renderField(lifecycleSetting)}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                  <button className="btn-secondary" type="button" onClick={() => loadDiscovery(settings)} disabled={discoveryState.loading}>
                    {discoveryState.loading ? 'Refreshing Discovery...' : 'Refresh Discovery'}
                  </button>
                </div>
                {discoveryState.error && (
                  <div style={{ marginTop: '0.65rem', color: '#DC2626', fontSize: '0.85rem' }}>
                    {discoveryState.error}
                  </div>
                )}
                {!discoveryState.error && discoveryState.loaded && (
                  <div style={{ marginTop: '0.65rem', color: '#15803D', fontSize: '0.85rem' }}>
                    Discovery refreshed successfully.
                  </div>
                )}
              </div>
            );
          }

          if (groupName === 'Lifecycle') {
            const lifecycleSetting = fields.find((setting) => setting.key === 'TicketingExistingOpenTicketBehavior');
            return <div key={groupName} className="glass-panel">
              <h3 style={pageStyles.cardTitle}>Ticket Routing &amp; Lifecycle</h3>
              <p style={{ color: '#526173' }}>Routing fields are supplied by the selected ticketing system. Shared lifecycle behavior applies to the active system.</p>
              {viewedProvider?.RoutingFields ? <viewedProvider.RoutingFields settings={settings} setSettings={setSettings} /> : null}
              {lifecycleSetting && renderField(lifecycleSetting)}
              {discoveryState.error && <p role="status">{discoveryState.error}</p>}
            </div>;
          }

          if (groupName === 'Signal Filters') {
            const signalFields = fields.filter((setting) => SIGNAL_FILTER_SETTING_KEYS.includes(setting.key));
            return <div key={groupName}>{renderSignalFiltersSection(signalFields)}</div>;
          }

          if (groupName === 'Grouped Ticketing' || groupName === 'Operational Safeguards') {
            return null;
          }

          if (groupName === 'Action1 Ticketing Configuration') {
            if (viewedProvider?.ConnectionFields) return null;
            const connectionFields = fields.filter((setting) => CONNECTION_SETTING_KEYS.includes(setting.key));

            return (
              <div key={groupName} className="glass-panel">
              <h3 style={pageStyles.cardTitle}>Connection</h3>
                {connectionExpanded ? (
                  <>
                    <p style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary, #526173)', lineHeight: 1.5 }}>
                      Configure access to your Action1 Ticketing API.
                    </p>
                    {connectionFields.map((setting) => renderField(setting))}
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
                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Action1 Ticketing connection configured</div>
                    <div style={{ color: '#526173', fontSize: '0.92rem', marginBottom: '0.9rem' }}>
                      Resource Server: {connectionSummaryResourceServer}
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
            );
          }

          return (
            <div key={groupName} className="glass-panel">
              <h3 style={pageStyles.cardTitle}>{groupName}</h3>
              {fields.map((setting) => renderField(setting))}
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
          );
        })}
        <div
          className="action1-ticketing-settings-bottom-spacer"
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
