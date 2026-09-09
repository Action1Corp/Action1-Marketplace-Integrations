import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Package,
  RefreshCw,
  Search
} from 'lucide-react';

const endpointColumns = [
  { key: 'deviceName', label: 'Endpoint', minWidth: 220, maxWidth: 360 },
  { key: 'source', label: 'Enrollment Status', nowrap: true },
  { key: 'provisioningStatus', label: 'Provisioning Status', nowrap: true },
  { key: 'action1EndpointGroups', label: 'Action1 Provisioning Groups', minWidth: 150, maxWidth: 260 },
  { key: 'deviceGroups', label: 'Intune Groups', minWidth: 180, maxWidth: 320 },
  { key: 'os', label: 'OS', nowrap: true }
];

const DASHBOARD_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_ENDPOINT_FILTER = 'assignmentTarget';

const baseTableCellStyle = {
  padding: '0.6rem',
  borderBottom: '1px solid var(--border-color)'
};

function columnCellStyle(column, extra = {}) {
  return {
    ...baseTableCellStyle,
    width: column.nowrap ? '1%' : undefined,
    minWidth: column.minWidth,
    maxWidth: column.maxWidth,
    whiteSpace: column.nowrap ? 'nowrap' : 'normal',
    overflowWrap: column.nowrap ? undefined : 'anywhere',
    verticalAlign: 'middle',
    ...extra
  };
}

function parseSelectedGroupIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function parseSelectedGroupMap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {}
  return {};
}

function getText(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const action1Timestamp = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  const parsed = action1Timestamp
    ? new Date(Date.UTC(
        Number(action1Timestamp[1]),
        Number(action1Timestamp[2]) - 1,
        Number(action1Timestamp[3]),
        Number(action1Timestamp[4]),
        Number(action1Timestamp[5]),
        Number(action1Timestamp[6])
      ))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed).replace(/, (?=\d{1,2}:\d{2} )/, ' ');
}

function formatFinishedDateTime(value) {
  return value ? formatDateTime(value) : 'Never';
}

function buildDefaultIntuneAppName(organizationName) {
  const name = String(organizationName || '').trim();
  return name ? `Action1 Agent - ${name}` : 'Action1 Agent';
}

function getConfigurationPolicyInfo(result) {
  const text = String(result?.automationName || '').trim();
  const explicitPolicyId = String(result?.configurationPolicyId || '').trim();
  const match = explicitPolicyId ? [explicitPolicyId] : text.match(/\bPOL-\d{6,}\b/i);
  if (!match) return null;
  const policyId = match[0].toUpperCase();
  const parts = /^A1CM\b/i.test(text) ? text.split(/\s+[—-]\s+/).map(part => part.trim()).filter(Boolean) : [];
  const policyIndex = parts.findIndex(part => part.toUpperCase() === policyId);
  const policyName = result?.configurationPolicyName || result?.policyControls?.find(control => control.policyName)?.policyName || (policyIndex >= 0 ? parts[policyIndex + 1] : '') || policyId;
  return {
    policyId,
    policyName,
    url: `/apps/action1-configuration-manager/policies?policyId=${encodeURIComponent(policyId)}`
  };
}

function AutomationItemLabel({ result }) {
  const policyInfo = getConfigurationPolicyInfo(result);
  const automationName = String(result?.automationName || 'Unnamed automation').trim();
  const showAutomationContext = policyInfo && automationName && automationName !== policyInfo.policyName;
  const metaParts = policyInfo ? [policyInfo.policyId] : [];
  if (result?.scheduleId && result.scheduleId !== automationName) metaParts.push(result.scheduleId);
  return (
    <div>
      {policyInfo ? (
        <a
          href={policyInfo.url}
          onClick={(event) => event.stopPropagation()}
          style={{ color: '#003DA6', textDecoration: 'none' }}
        >
          {policyInfo.policyName}
        </a>
      ) : result?.automationUrl ? (
        <a
          href={result.automationUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          style={{ color: '#003DA6', textDecoration: 'none' }}
        >
          {automationName}
        </a>
      ) : (
        automationName
      )}
      {metaParts.length > 0 && (
        <div style={{ marginTop: 3, color: '#6B7280', fontSize: '0.74rem', fontWeight: 600 }}>
          {metaParts.join(' | ')}
        </div>
      )}
      {showAutomationContext && (
        <div style={{ marginTop: 3, color: '#4B5563', fontSize: '0.74rem', fontWeight: 500, lineHeight: 1.25 }}>
          {automationName}
        </div>
      )}
    </div>
  );
}

function FilterCard({ label, value, icon: Icon, active, onClick, tone = '#0B4EA2' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={active}
      style={{
        width: '100%',
        minHeight: 88,
        padding: '0.85rem',
        background: active ? '#EAF3FF' : '#F9FAFB',
        border: active ? '2px solid #0B4EA2' : '1px solid var(--border-color)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 700 }}>{label}</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, marginTop: '0.3rem', color: tone }}>{value ?? 0}</div>
        </div>
        <Icon size={18} color={tone} />
      </div>
    </button>
  );
}

function SourcePill({ source }) {
  const config = {
    Synced: { color: '#166534', bg: '#DCFCE7' },
    Action1: { color: '#0B4EA2', bg: '#EAF3FF' },
    Intune: { color: '#92400E', bg: '#FEF3C7' }
  }[source] || { color: '#374151', bg: '#F3F4F6' };

  return (
    <span style={{
      display: 'inline-flex',
      padding: '0.18rem 0.5rem',
      borderRadius: 999,
      color: config.color,
      background: config.bg,
      fontSize: '0.76rem',
      fontWeight: 700
    }}>
      {source || 'Unknown'}
    </span>
  );
}

function ProvisioningStatusPill({ status }) {
  const config = {
    'In progress': { color: '#92400E', bg: '#FEF3C7' },
    Completed: { color: '#166534', bg: '#DCFCE7' },
    Failed: { color: '#991B1B', bg: '#FEE2E2' },
    'Awaiting Enrollment': { color: '#0B4EA2', bg: '#EAF3FF' },
    'No automation result': { color: '#374151', bg: '#F3F4F6' },
    'N/A': { color: '#374151', bg: '#F3F4F6' }
  }[status] || { color: '#374151', bg: '#F3F4F6' };

  return (
    <span style={{
      display: 'inline-flex',
      padding: '0.18rem 0.5rem',
      borderRadius: 999,
      color: config.color,
      background: config.bg,
      fontSize: '0.76rem',
      fontWeight: 700,
      whiteSpace: 'nowrap'
    }}>
      {status || 'N/A'}
    </span>
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Request failed with HTTP ${response.status}`);
  }
  return json;
}

async function loadPolicyDefinitions() {
  const result = await fetchJson('/api/integrations/intune/actions/list-policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {}, trackHistory: false })
  });
  return Array.isArray(result.policies) ? result.policies : [];
}

function mergePoliciesIntoDashboard(statusData, policies) {
  const currentPolicies = Array.isArray(statusData?.policies) ? statusData.policies : [];
  if (currentPolicies.length || !policies.length) return statusData;

  const enabledPolicy = policies.find(policy => policy.enabled !== false) || policies[0];
  return {
    ...statusData,
    status: statusData?.status || 'never_run',
    policies,
    selectedPolicyId: statusData?.selectedPolicyId || enabledPolicy?.policyId || '',
    selectedAction1OrgId: statusData?.selectedAction1OrgId || enabledPolicy?.organizationId || '',
    selectedAction1OrgName: statusData?.selectedAction1OrgName || enabledPolicy?.organizationName || '',
    selectedGroupIds: Array.isArray(statusData?.selectedGroupIds) && statusData.selectedGroupIds.length
      ? statusData.selectedGroupIds
      : enabledPolicy?.intuneDeviceGroupIds || [],
    selectedGroupMap: statusData?.selectedGroupMap || enabledPolicy?.intuneDeviceGroupMap || {},
    assignmentMode: statusData?.assignmentMode || enabledPolicy?.assignmentMode || 'selectedGroups',
    policyResults: statusData?.policyResults || {}
  };
}

function IntuneDashboard({ syncing, runSync, canRunSync }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [endpointFilter, setEndpointFilter] = useState(DEFAULT_ENDPOINT_FILTER);
  const [columnFilters, setColumnFilters] = useState({});
  const [expandedEndpointId, setExpandedEndpointId] = useState('');
  const [markingEndpointId, setMarkingEndpointId] = useState('');
  const [markCompleteMessage, setMarkCompleteMessage] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async ({ retry = true, showLoading = false } = {}) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const statusJson = await fetchJson('/api/intune/status');
        let dashboardJson = statusJson;
        if (!Array.isArray(statusJson?.policies) || statusJson.policies.length === 0) {
          const policies = await loadPolicyDefinitions();
          dashboardJson = mergePoliciesIntoDashboard(statusJson, policies);
        }
        if (!cancelled) setData(dashboardJson);
      } catch (loadError) {
        if (retry && !cancelled) {
          window.setTimeout(() => loadDashboard(false), 600);
          return;
        }
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadDashboard({ retry: false });
    };

    loadDashboard({ showLoading: true });
    const refreshTimer = window.setInterval(() => loadDashboard({ retry: false }), DASHBOARD_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [syncing]);

  useEffect(() => {
    if (!selectedPolicyId && data?.selectedPolicyId) setSelectedPolicyId(data.selectedPolicyId);
  }, [data?.selectedPolicyId, selectedPolicyId]);

  const policies = Array.isArray(data?.policies) ? data.policies : [];
  const selectedPolicy = policies.find(policy => policy.policyId === selectedPolicyId) || policies.find(policy => policy.policyId === data?.selectedPolicyId) || null;
  const policyResults = data?.policyResults && typeof data.policyResults === 'object' ? data.policyResults : {};
  const selectedPolicyResult = selectedPolicy?.policyId ? policyResults[selectedPolicy.policyId] : null;
  const selectedPolicyIsActive = Boolean(selectedPolicy?.policyId && selectedPolicy.policyId === data?.selectedPolicyId);
  const selectedDeployment = selectedPolicyResult?.intuneDeployment || (selectedPolicyIsActive ? data : selectedPolicyResult) || {};
  const endpointRegistration = selectedPolicyResult?.endpointRegistration || data?.endpointRegistration || {};
  const missingDevices = Array.isArray(endpointRegistration.missingDevices) ? endpointRegistration.missingDevices : [];
  const endpointRows = useMemo(() => {
    const endpoints = Array.isArray(endpointRegistration.endpoints) ? endpointRegistration.endpoints : [];
    if (endpoints.length) return endpoints;
    return missingDevices.map(device => ({ ...device, source: 'Intune' }));
  }, [endpointRegistration.endpoints, missingDevices]);
  const selectedGroupIds = parseSelectedGroupIds(selectedPolicy?.intuneDeviceGroupIds || (selectedPolicyIsActive ? data?.selectedGroupIds : []));
  const selectedGroupMap = parseSelectedGroupMap(selectedPolicy?.intuneDeviceGroupMap || (selectedPolicyIsActive ? data?.selectedGroupMap : {}));
  const selectedGroupLabels = selectedGroupIds.map(groupId => selectedGroupMap[groupId] || 'Group name unavailable');
  const usesSelectedGroups = (selectedDeployment.assignmentMode || selectedPolicy?.assignmentMode || (selectedPolicyIsActive ? data?.assignmentMode : '')) === 'selectedGroups';
  const selectedGroupLabelSet = useMemo(
    () => new Set(selectedGroupLabels.map(label => String(label || '').trim().toLowerCase()).filter(Boolean)),
    [selectedGroupLabels]
  );
  const isEndpointInAssignmentTarget = (endpoint) => {
    if (endpoint.inAssignmentTarget) return true;
    if (!usesSelectedGroups) return endpoint.source === 'Intune' || endpoint.source === 'Synced';
    const deviceGroups = Array.isArray(endpoint.deviceGroups) ? endpoint.deviceGroups : [];
    return deviceGroups.some(groupName => selectedGroupLabelSet.has(String(groupName || '').trim().toLowerCase()));
  };
  const targetEndpointRows = useMemo(
    () => endpointRows.filter(endpoint => isEndpointInAssignmentTarget(endpoint)),
    [endpointRows, selectedGroupLabelSet, usesSelectedGroups]
  );
  const totalProvisioned = targetEndpointRows.filter(endpoint => endpoint.provisioningStatus === 'Completed').length;
  const totalNotProvisioned = targetEndpointRows.filter(endpoint => endpoint.provisioningStatus !== 'Completed').length;
  const filteredEndpointRows = useMemo(() => {
    const sourceFiltered = endpointRows.filter(endpoint => {
      if (endpointFilter === 'assignmentTarget') return isEndpointInAssignmentTarget(endpoint);
      if (endpointFilter === 'provisioned') return isEndpointInAssignmentTarget(endpoint) && endpoint.provisioningStatus === 'Completed';
      if (endpointFilter === 'notProvisioned') return isEndpointInAssignmentTarget(endpoint) && endpoint.provisioningStatus !== 'Completed';
      if (endpointFilter === 'intune') return endpoint.source === 'Intune' || endpoint.source === 'Synced';
      if (endpointFilter === 'action1') return endpoint.source === 'Action1' || endpoint.source === 'Synced';
      if (endpointFilter === 'synced') return endpoint.source === 'Synced' && isEndpointInAssignmentTarget(endpoint);
      if (endpointFilter === 'intuneOnly') return endpoint.source === 'Intune';
      if (endpointFilter === 'action1Only') return endpoint.source === 'Action1';
      return true;
    });
    return sourceFiltered.filter(endpoint => endpointColumns.every(column => {
      const filterValue = String(columnFilters[column.key] || '').trim().toLowerCase();
      if (!filterValue) return true;
      const value = column.key === 'lastSyncDateTime' ? formatDateTime(endpoint[column.key]) : getText(endpoint[column.key]);
      return value.toLowerCase().includes(filterValue);
    }));
  }, [columnFilters, endpointFilter, endpointRows, selectedGroupLabelSet, usesSelectedGroups]);

  if (loading) return <div style={{ padding: '2rem' }}>Loading Intune Agent Status...</div>;
  if (error) {
    return (
      <div className="glass-panel" style={{ borderLeft: '4px solid #ef4444', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle color="#ef4444" size={20} />
          <strong style={{ color: '#991B1B' }}>Unable to load Intune dashboard</strong>
        </div>
        <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#B91C1C' }}>{error}</p>
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <div style={{ width: '100%', maxWidth: '100%', margin: 0 }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Windows Device Enrollment and Provisioning</h1>
          <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: '#6B7280' }}>
            Create an Enrollment and Provisioning Profile before dashboard results are shown.
          </div>
        </div>
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <Package size={48} style={{ color: '#9CA3AF', marginBottom: '1rem' }} />
          <h2 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>No Enrollment Profiles</h2>
          <p style={{ color: 'var(--text-light)', margin: 0 }}>
            Use Profiles to choose an Action1 organization, Intune enrollment group, and Action1 provisioning groups.
          </p>
        </div>
      </div>
    );
  }

  const neverRun = data?.status === 'never_run';
  const selectedOrganizationName = selectedPolicyResult?.organizationName || selectedPolicy?.organizationName || (selectedPolicyIsActive ? data?.selectedAction1OrgName : '');
  const latestVersion = selectedDeployment.latestVersion || 'Unknown';
  const intuneVersion = selectedDeployment.intuneVersion || 'Not Found';
  const versionStatus = selectedDeployment.versionStatus || 'unknown';
  const intuneAppName = selectedDeployment.intuneAppName || buildDefaultIntuneAppName(selectedOrganizationName);
  const lastRun = data?.lastRun ? new Date(data.lastRun).toLocaleString() : 'Never';
  const assignmentModeLabel = usesSelectedGroups ? 'Selected Device Groups' : 'All Devices';
  const assignmentStatus = selectedDeployment.assignmentStatus || 'not_checked';
  const assignmentMessage = selectedDeployment.assignmentMessage || 'Assignments have not been checked.';
  const assignmentColor = assignmentStatus === 'configured' ? '#10b981' : assignmentStatus === 'failed' ? '#ef4444' : '#6B7280';
  const assignmentTargetDeviceCount = targetEndpointRows.length;
  const registrationStatus = endpointRegistration.status || 'not_checked';
  const registrationColor = registrationStatus === 'checked'
    ? (endpointRegistration.missingFromAction1 > 0 ? '#f59e0b' : '#10b981')
    : registrationStatus === 'failed' ? '#ef4444' : '#6B7280';
  const groupMembershipLimited = endpointRegistration.groupMembershipStatus === 'limited_permissions';
  const endpointFailureMessage = endpointRegistration.staleEndpointDataReason || endpointRegistration.provisioningMessage || endpointRegistration.message || '';
  const endpointDataStale = registrationStatus === 'failed' && endpointRegistration.usingStaleEndpointData;

  const statusConfig = {
    up_to_date: { label: 'Up to Date', color: '#10b981' },
    update_available: { label: 'Update Available', color: '#f59e0b' },
    not_deployed: { label: 'Not Deployed', color: '#ef4444' },
    unknown: { label: 'Unknown', color: '#6B7280' }
  };

  const status = statusConfig[versionStatus] || statusConfig.unknown;
  const intuneVersionColor = versionStatus === 'up_to_date' ? '#10b981' : '#ef4444';
  const hasActiveFilters = endpointFilter !== DEFAULT_ENDPOINT_FILTER || Object.values(columnFilters).some(Boolean);
  const updateColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const toggleEndpointFilter = filter => setEndpointFilter(current => current === filter ? 'all' : filter);
  const rowKey = (device, index) => device.id || device.intuneDeviceId || device.action1EndpointId || `${device.deviceName}-${index}`;
  const toggleEndpointDetails = key => setExpandedEndpointId(current => current === key ? '' : key);
  const markProvisioningComplete = async (device) => {
    const endpointId = String(device?.action1EndpointId || '').trim();
    const endpointName = String(device?.deviceName || '').trim();
    if (!endpointId) {
      setMarkCompleteMessage('This endpoint does not have an Action1 endpoint ID.');
      return;
    }

    setMarkingEndpointId(endpointId);
    setMarkCompleteMessage('');
    try {
      const response = await fetch('/api/integrations/intune/actions/mark-provisioning-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: { endpointId, endpointName, organizationId: selectedPolicy?.organizationId || data?.selectedAction1OrgId || '' },
          trackHistory: false
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || result.message || 'Unable to mark provisioning complete.');
      }

      setData(current => {
        if (!current?.endpointRegistration?.endpoints) return current;
        return {
          ...current,
          endpointRegistration: {
            ...current.endpointRegistration,
            endpoints: current.endpointRegistration.endpoints.map(endpoint => {
              const idMatches = String(endpoint.action1EndpointId || '').trim() === endpointId;
              const nameMatches = endpointName && String(endpoint.deviceName || '').trim().toLowerCase() === endpointName.toLowerCase();
              if (!idMatches && !nameMatches) return endpoint;
              return {
                ...endpoint,
                provisioningCompletedByAttribute: true,
                provisioningStatus: 'Completed',
                provisioningDetail: 'Action1 Provisioning Status set to Completed by manual override.',
                provisioningAttributeStatus: 'completed',
                provisioningAttributeMessage: 'Action1 Provisioning Status set to Completed by manual override.',
                automationResults: []
              };
            })
          }
        };
      });
      setMarkCompleteMessage(result.message || `${endpointName || 'Endpoint'} was marked as provisioning complete.`);
    } catch (markError) {
      setMarkCompleteMessage(markError.message);
    } finally {
      setMarkingEndpointId('');
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>Windows Device Enrollment and Provisioning</h1>
          <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: '#6B7280' }}>Status refreshes automatically every 15 minutes.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {policies.length > 0 && (
            <select
              value={selectedPolicyId || data?.selectedPolicyId || ''}
              onChange={event => setSelectedPolicyId(event.target.value)}
              title="Choose which Action1 organization profile to display"
              style={{ minHeight: 34, padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff', color: '#111827', fontSize: '0.8rem' }}
            >
              {policies.map(policy => (
                <option key={policy.policyId} value={policy.policyId}>
                  {policy.organizationName || policy.name}
                </option>
              ))}
            </select>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8rem',
            color: 'var(--text-light)',
            background: '#fff',
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid var(--border-color)'
          }}>
            <Calendar size={14} />
            Last Synced: {lastRun}
          </div>
          {canRunSync && (
            <button
              className="btn-primary"
              onClick={runSync}
              disabled={syncing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
        </div>
      </div>

      {neverRun ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <Package size={48} style={{ color: '#9CA3AF', marginBottom: '1rem' }} />
          <h2 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>No Check Performed Yet</h2>
          <p style={{ color: 'var(--text-light)', margin: 0 }}>
            {canRunSync ? 'Click "Sync Now" to verify the Action1 Agent version in Intune.' : 'No check has been performed yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {selectedPolicy && selectedPolicy.policyId !== data?.selectedPolicyId && !selectedPolicyResult && (
            <div style={{ padding: '0.85rem 1rem', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, color: '#9A3412', fontSize: '0.85rem', marginBottom: '1rem', order: 0 }}>
              Results for {selectedPolicy.organizationName || selectedPolicy.name} have not been synced in this dashboard payload yet. Run Sync Now after selecting or enabling this profile.
            </div>
          )}
          <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem', order: 2 }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Application Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Latest Action1 Agent Version</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.25rem', fontFamily: 'monospace' }}>{latestVersion}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Action1 Agent Version in Intune</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.25rem', fontFamily: 'monospace', color: intuneVersionColor }}>{intuneVersion}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Intune App Name</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{intuneAppName}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Version Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: status.color }}>{status.label}</div>
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Target</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '0.25rem' }}>{assignmentModeLabel}</div>
                {usesSelectedGroups && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.55rem' }}>
                    {(selectedGroupLabels.length ? selectedGroupLabels : ['No device groups selected']).map(groupName => (
                      <span key={groupName} style={{ display: 'inline-flex', maxWidth: '100%', padding: '0.22rem 0.5rem', borderRadius: 999, background: '#EAF3FF', color: '#0B4EA2', border: '1px solid #BFDBFE', fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.25 }}>{groupName}</span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Assignment Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem', color: assignmentColor }}>{assignmentMessage}</div>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem', marginTop: 0, order: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <FilterCard label="Total Target Enrollment Devices" value={assignmentTargetDeviceCount} icon={Package} active={endpointFilter === 'assignmentTarget'} onClick={() => toggleEndpointFilter('assignmentTarget')} tone="#0B4EA2" />
              <FilterCard label="Total Provisioned" value={totalProvisioned} icon={CheckCircle2} active={endpointFilter === 'provisioned'} onClick={() => toggleEndpointFilter('provisioned')} tone="#10b981" />
              <FilterCard label="Total Not Provisioned" value={totalNotProvisioned} icon={AlertTriangle} active={endpointFilter === 'notProvisioned'} onClick={() => toggleEndpointFilter('notProvisioned')} tone={registrationColor} />
            </div>
            {groupMembershipLimited && (
              <div style={{ fontSize: '0.85rem', color: '#B45309', marginBottom: '1rem' }}>{endpointRegistration.groupMembershipMessage}</div>
            )}
            {registrationStatus === 'failed' && endpointFailureMessage && (
              <div style={{ padding: '0.85rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#991B1B', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {endpointDataStale
                  ? `Latest endpoint status refresh failed: ${endpointFailureMessage}. Showing the last successfully loaded endpoint details.`
                  : `Endpoint details could not be loaded: ${endpointFailureMessage}`}
              </div>
            )}

            {endpointRows.length > 0 ? (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'visible' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', padding: '0.7rem 0.8rem', background: '#fff', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#374151', fontSize: '0.85rem', fontWeight: 700 }}>
                    <Search size={15} />
                    Showing {filteredEndpointRows.length} of {endpointRows.length} endpoints
                  </div>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEndpointFilter(DEFAULT_ENDPOINT_FILTER);
                        setColumnFilters({});
                      }}
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
                      {endpointColumns.map(column => (
                        <th key={column.key} style={columnCellStyle(column)}>{column.label}</th>
                      ))}
                    </tr>
                    <tr style={{ background: '#fff' }}>
                      {endpointColumns.map(column => (
                        <th key={column.key} style={columnCellStyle(column, { padding: '0.45rem 0.6rem' })}>
                          <input
                            value={columnFilters[column.key] || ''}
                            onChange={event => updateColumnFilter(column.key, event.target.value)}
                            placeholder={`Filter ${column.label}`}
                            style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '0.35rem 0.45rem', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.78rem' }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEndpointRows.slice(0, 100).map((device, index) => {
                      const key = rowKey(device, index);
                      const expanded = expandedEndpointId === key;
                      const automationResults = Array.isArray(device.automationResults) ? device.automationResults : [];
                      return (
                        <Fragment key={key}>
                          <tr
                            onClick={() => toggleEndpointDetails(key)}
                            aria-expanded={expanded}
                            style={{ cursor: 'pointer', background: expanded ? '#F8FBFF' : '#fff' }}
                          >
                            <td style={columnCellStyle(endpointColumns[0], { fontWeight: 600 })}>
                              <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.35rem', minWidth: 0 }}>
                                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                <span style={{ overflowWrap: 'anywhere' }}>{device.deviceName}</span>
                              </span>
                            </td>
                            <td style={columnCellStyle(endpointColumns[1])}><SourcePill source={device.source} /></td>
                            <td style={columnCellStyle(endpointColumns[2])} title={device.provisioningDetail || ''}><ProvisioningStatusPill status={device.provisioningStatus || 'N/A'} /></td>
                            <td style={columnCellStyle(endpointColumns[3])}>{Array.isArray(device.action1EndpointGroups) && device.action1EndpointGroups.length ? device.action1EndpointGroups.join(', ') : 'N/A'}</td>
                            <td style={columnCellStyle(endpointColumns[4])}>{Array.isArray(device.deviceGroups) && device.deviceGroups.length ? device.deviceGroups.join(', ') : groupMembershipLimited && device.source !== 'Action1' ? 'Permission required' : 'N/A'}</td>
                            <td style={columnCellStyle(endpointColumns[5])}>{device.os || 'N/A'}</td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={endpointColumns.length} style={{ padding: 0, borderBottom: '1px solid var(--border-color)', background: '#F8FBFF' }}>
                                <div style={{ padding: '0.85rem 1rem 1rem 2.1rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.55rem' }}>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#374151' }}>Provisioning Items</div>
                                    {device.action1EndpointId && device.provisioningStatus !== 'Completed' && (
                                      <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          markProvisioningComplete(device);
                                        }}
                                        disabled={markingEndpointId === device.action1EndpointId}
                                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                                      >
                                        {markingEndpointId === device.action1EndpointId ? 'Marking...' : 'Mark Provisioning Complete'}
                                      </button>
                                    )}
                                  </div>
                                  {markCompleteMessage && (
                                    <div style={{ padding: '0.55rem 0.7rem', marginBottom: '0.7rem', background: '#EAF3FF', border: '1px solid #BFDBFE', borderRadius: 6, color: '#0B4EA2', fontSize: '0.8rem', fontWeight: 600 }}>
                                      {markCompleteMessage}
                                    </div>
                                  )}
                                  {automationResults.length ? (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', background: '#fff', border: '1px solid #E5E7EB' }}>
                                      <thead>
                                        <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB' }}>Item</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 140 }}>Status</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 160 }}>Action</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 90 }}>Complete</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 190, whiteSpace: 'nowrap' }}>Started</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB', width: 190, whiteSpace: 'nowrap' }}>Finished</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB' }}>Details</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {automationResults.map((result, resultIndex) => {
                                          const nonCompliantControls = Array.isArray(result.nonCompliantControls) ? result.nonCompliantControls : [];
                                          const details = [result.statusDetail, result.policyComplianceDetail].filter(Boolean).join(' ');
                                          return (
                                            <Fragment key={`${key}-automation-${resultIndex}`}>
                                              <tr>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', fontWeight: 600 }}>
                                                  <AutomationItemLabel result={result} />
                                                </td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}><ProvisioningStatusPill status={result.status || 'N/A'} /></td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}>{result.actionName || 'N/A'}</td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6' }}>{result.percentCompleted ? `${result.percentCompleted}%` : 'N/A'}</td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>{formatDateTime(result.startedAt)}</td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>{formatFinishedDateTime(result.completedAt)}</td>
                                                <td style={{ padding: '0.5rem', borderBottom: '1px solid #F3F4F6', color: '#4B5563' }}>{details || 'N/A'}</td>
                                              </tr>
                                              {nonCompliantControls.length > 0 && (
                                                <tr>
                                                  <td colSpan={7} style={{ padding: '0.55rem 0.75rem 0.85rem', borderBottom: '1px solid #F3F4F6', background: '#FEF2F2' }}>
                                                    <div style={{ fontWeight: 800, color: '#991B1B', marginBottom: '0.45rem' }}>Non-compliant policy controls</div>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #FECACA' }}>
                                                      <thead>
                                                        <tr style={{ background: '#FFF1F2', color: '#7F1D1D', textAlign: 'left' }}>
                                                          <th style={{ padding: '0.45rem', borderBottom: '1px solid #FECACA' }}>Control</th>
                                                          <th style={{ padding: '0.45rem', borderBottom: '1px solid #FECACA', width: 120 }}>Status</th>
                                                          <th style={{ padding: '0.45rem', borderBottom: '1px solid #FECACA', width: 170 }}>Last Checked</th>
                                                          <th style={{ padding: '0.45rem', borderBottom: '1px solid #FECACA' }}>Message</th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {nonCompliantControls.map((control, controlIndex) => (
                                                          <tr key={`${key}-automation-${resultIndex}-control-${controlIndex}`}>
                                                            <td style={{ padding: '0.45rem', borderBottom: '1px solid #FEE2E2', fontWeight: 700 }}>{control.controlName || 'Unnamed control'}</td>
                                                            <td style={{ padding: '0.45rem', borderBottom: '1px solid #FEE2E2' }}>{control.status || 'N/A'}</td>
                                                            <td style={{ padding: '0.45rem', borderBottom: '1px solid #FEE2E2', whiteSpace: 'nowrap' }}>{formatDateTime(control.lastCheckedAt)}</td>
                                                            <td style={{ padding: '0.45rem', borderBottom: '1px solid #FEE2E2', color: '#4B5563' }}>{control.message || 'N/A'}</td>
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  </td>
                                                </tr>
                                              )}
                                            </Fragment>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div style={{ padding: '0.75rem', background: '#fff', border: '1px solid #E5E7EB', color: '#6B7280', borderRadius: 6 }}>
                                      No Action1 automation results were found for this endpoint in the latest sync.
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {filteredEndpointRows.length === 0 && (
                      <tr>
                        <td colSpan={endpointColumns.length} style={{ padding: '1rem', color: '#6B7280', textAlign: 'center' }}>No endpoints match the current filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {filteredEndpointRows.length > 100 && (
                  <div style={{ padding: '0.65rem', color: '#6B7280', fontSize: '0.8rem', background: '#F9FAFB' }}>
                    Showing 100 of {filteredEndpointRows.length} filtered endpoints from the latest check.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '1rem', background: '#F9FAFB', borderRadius: 8, color: '#6B7280', fontSize: '0.85rem' }}>
                {registrationStatus === 'failed' && endpointFailureMessage
                  ? `Endpoint details could not be loaded: ${endpointFailureMessage}`
                  : 'Endpoint details will appear after a successful check with Action1 API credentials configured.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default IntuneDashboard;
