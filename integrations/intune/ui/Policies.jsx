import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const tokens = {
  accent: '#0337A1',
  accentHover: '#022d87',
  accentBackground: '#CEE5FD',
  accentBorder: '#9fc9f3',
  success: '#4d7c0f',
  danger: '#b91c1c',
  textPrimary: '#313752',
  textSecondary: '#57606a',
  textMuted: '#8b949e',
  mutedBackground: '#F0F2F7',
  surfaceBackground: '#ffffff',
  borderColor: '#D1D7E2',
  inputBorderColor: '#D1D7E2'
};

const instructionListStyle = {
  margin: '0.45rem 0 0.85rem 1.15rem',
  padding: 0,
  color: tokens.textSecondary,
  fontSize: 12,
  lineHeight: 1.45
};

const PROFILE_TYPE_ENROLLMENT_ONLY = 'enrollmentOnly';
const PROFILE_TYPE_ENROLLMENT_AND_PROVISIONING = 'enrollmentAndProvisioning';

const FULL_PROFILE_STEPS = [
  { id: 'organization', label: 'Organization' },
  { id: 'intune', label: 'Enrollment Groups' },
  { id: 'action1', label: 'Provisioning Groups' },
  { id: 'provisioning', label: 'Provisioning Actions' },
  { id: 'review', label: 'Review' }
];

const ENROLLMENT_ONLY_STEPS = FULL_PROFILE_STEPS.filter(step => ['organization', 'intune', 'review'].includes(step.id));

const PROFILE_CSS = `
.a1-profile-ui {
  --accent: #0337A1;
  --accent-hover: #022d87;
  --accent-bg: #CEE5FD;
  --accent-border: #9fc9f3;
  --danger: #b91c1c;
  --danger-bg: #fee2e2;
  --text: #313752;
  --text-2: #57606a;
  --text-3: #8b949e;
  --bg-card: #ffffff;
  --bg-muted: #F0F2F7;
  --border: #D1D7E2;
  --border-input: #D1D7E2;
  --radius: 4px;
  --radius-card: 8px;
  --fs-title: 18px;
  --fs-section: 15px;
  --fs-body: 14px;
  --fs-label: 13px;
  --fs-hint: 12px;
  --font: RooftopBook, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-family: var(--font);
  font-size: var(--fs-body);
  color: var(--text);
  line-height: 1.45;
}
.a1-profile-ui, .a1-profile-ui * { box-sizing: border-box; }
.a1-profile-ui .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 24px 28px; }
.a1-profile-ui .card-title { font-size: var(--fs-title); font-weight: 600; margin: 0; }
.a1-profile-ui .card-sub { font-size: var(--fs-hint); color: var(--text-3); margin: 4px 0 0; }
.a1-profile-ui .stepper { display: flex; align-items: center; gap: 8px; margin: 20px 0 24px; border-bottom: 1px solid var(--border); padding-bottom: 20px; overflow-x: auto; }
.a1-profile-ui .step { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); color: var(--text-3); cursor: default; background: none; border: none; padding: 0; font-family: inherit; white-space: nowrap; }
.a1-profile-ui .step .num { width: 24px; height: 24px; flex: none; border-radius: 50%; border: 1px solid var(--border-input); display: inline-flex; align-items: center; justify-content: center; font-size: var(--fs-hint); font-weight: 600; background: var(--bg-card); }
.a1-profile-ui .step.active { color: var(--text); font-weight: 600; }
.a1-profile-ui .step.active .num { background: var(--accent); border-color: var(--accent); color: #fff; }
.a1-profile-ui .step.done { color: var(--text-2); cursor: pointer; }
.a1-profile-ui .step.done .num { background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent); }
.a1-profile-ui .step.done:hover { color: var(--text); }
.a1-profile-ui .step-sep { flex: 1; height: 1px; background: var(--border); min-width: 16px; }
.a1-profile-ui .section { border-top: 1px solid var(--border); margin-top: 24px; padding-top: 18px; }
.a1-profile-ui .section:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
.a1-profile-ui .section-title { font-size: var(--fs-section); font-weight: 600; margin: 0 0 4px; }
.a1-profile-ui .section-sub { font-size: var(--fs-hint); color: var(--text-3); margin: 0 0 14px; }
.a1-profile-ui .field { margin-bottom: 14px; }
.a1-profile-ui .field:last-child { margin-bottom: 0; }
.a1-profile-ui label { display: block; font-size: var(--fs-label); font-weight: 600; margin-bottom: 6px; }
.a1-profile-ui .req { color: var(--danger); }
.a1-profile-ui input[type="text"],
.a1-profile-ui select,
.a1-profile-ui textarea {
  width: 100%;
  height: 34px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  padding: 0 10px;
  font-size: var(--fs-body);
  font-family: inherit;
  background: var(--bg-card);
  color: var(--text);
}
.a1-profile-ui textarea { height: 64px; padding: 8px 10px; resize: vertical; }
.a1-profile-ui input:focus,
.a1-profile-ui select:focus,
.a1-profile-ui textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.a1-profile-ui input[type="radio"], .a1-profile-ui input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; flex: none; }
.a1-profile-ui .radio-row { display: flex; gap: 16px; align-items: center; height: 34px; }
.a1-profile-ui .radio-item { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); cursor: pointer; font-weight: 400; margin: 0; }
.a1-profile-ui .validation-notice { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--danger-bg); background: #fff7f7; color: var(--danger); border-radius: var(--radius); font-size: var(--fs-label); }
.a1-profile-ui .btn { height: 34px; padding: 0 16px; font-size: var(--fs-label); font-weight: 600; font-family: inherit; border-radius: var(--radius); cursor: pointer; border: 1px solid transparent; }
.a1-profile-ui .btn:disabled { opacity: .5; cursor: not-allowed; }
.a1-profile-ui .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.a1-profile-ui .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.a1-profile-ui .btn-secondary { background: var(--bg-card); color: var(--text); border-color: var(--border-input); }
.a1-profile-ui .btn-secondary:hover:not(:disabled) { background: var(--bg-muted); }
.a1-profile-ui .btn-danger { color: var(--danger); }
.a1-profile-ui .link-button { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.a1-profile-ui .wizard-footer { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); margin-top: 24px; padding-top: 16px; }
.a1-profile-ui .wizard-footer .spacer { flex: 1; }
.a1-profile-ui .summary-grid { display: grid; grid-template-columns: 180px 1fr; gap: 8px 20px; font-size: var(--fs-body); }
.a1-profile-ui .summary-grid .s-label { font-size: var(--fs-label); color: var(--text-3); padding-top: 1px; }
.a1-profile-ui .empty-state { background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-card); padding: 2.2rem 1.5rem; text-align: center; display: grid; gap: 0.4rem; justify-items: center; }
.a1-profile-ui .empty-state h2 { margin: 0; font-size: var(--fs-body); font-weight: 600; color: var(--text); }
.a1-profile-ui .empty-state p { margin: 0; max-width: 520px; color: var(--text-2); font-size: var(--fs-label); line-height: 1.45; }
.a1-profile-ui .profile-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; background: var(--bg-card); }
.a1-profile-ui .profile-table th { padding: 0.75rem 0.8rem; text-align: left; font-size: var(--fs-hint); font-weight: 600; color: var(--text); text-transform: none; border-bottom: 1px solid var(--border); background: var(--bg-muted); }
.a1-profile-ui .profile-table td { padding: 0.7rem 0.8rem; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--border); background: var(--bg-card); font-size: var(--fs-label); }
.a1-profile-ui .profile-table tr:last-child td { border-bottom: none; }
.a1-profile-ui .profile-table tr:hover td { background: var(--bg-muted); }
.a1-profile-ui .profile-name { margin: 0; font-size: var(--fs-label); font-weight: 600; color: var(--text); line-height: 1.35; word-break: break-word; }
.a1-profile-ui .profile-name-link { border: none; background: transparent; margin: 0; padding: 0; color: var(--accent); font: inherit; font-size: var(--fs-label); font-weight: 600; line-height: 1.35; text-align: left; cursor: pointer; word-break: break-word; }
.a1-profile-ui .profile-name-link:hover { text-decoration: underline; }
.a1-profile-ui .profile-name-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.a1-profile-ui .value-text { margin: 0; font-size: var(--fs-label); font-weight: 400; color: var(--text); line-height: 1.35; }
.a1-profile-ui .actions-cell { width: 56px; text-align: center; }
.a1-profile-ui .menu-trigger { width: auto; height: auto; min-height: 0; padding: 4px 8px; border: none; background: transparent; color: var(--text-3); font-size: 16px; line-height: 1; }
.a1-profile-ui .pick-list { border: 1px solid var(--border-input); border-radius: var(--radius); background: var(--bg-card); max-height: 280px; overflow-y: auto; }
.a1-profile-ui .pick-list.large { max-height: 360px; }
.a1-profile-ui .pick-row { display: flex; gap: 0.65rem; align-items: flex-start; padding: 0.7rem 0.85rem; border-bottom: 1px solid var(--border); cursor: pointer; margin: 0; }
.a1-profile-ui .pick-row:last-child { border-bottom: none; }
.a1-profile-ui .pick-row:hover { background: var(--bg-muted); }
.a1-profile-ui .pick-row.disabled { cursor: not-allowed; background: var(--bg-muted); color: var(--text-3); }
.a1-profile-ui .pick-name { display: block; font-weight: 600; }
.a1-profile-ui .pick-desc { display: block; color: var(--text-3); font-size: var(--fs-hint); margin-top: 1px; }
@media (max-width: 640px) {
  .a1-profile-ui .summary-grid { grid-template-columns: 1fr; }
}
`;

function cx(...tokens) {
  return tokens.filter(Boolean).join(' ');
}

function defaultDraft() {
  return {
    name: '',
    description: '',
    enabled: true,
    organizationId: '',
    organizationName: '',
    agentId: '',
    agentDownloadOrgName: '',
    profileType: PROFILE_TYPE_ENROLLMENT_AND_PROVISIONING,
    assignmentMode: 'allDevices',
    intuneDeviceGroupIds: [],
    intuneDeviceGroupMap: {},
    provisioningEnabled: true,
    configurationManagementEnabled: true,
    monitoredAction1GroupIds: [],
    monitoredAction1GroupMap: {}
  };
}

function apiAction(integration, actionId, payload = {}, settings = {}) {
  return fetch(`/api/integrations/${integration}/actions/${actionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, settings, trackHistory: false })
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `Unable to run ${actionId}.`);
    return data;
  });
}

function selectedLabels(ids, map, rows, labelKey = 'name') {
  return ids.map(id => rows.find(row => row.id === id)?.[labelKey] || map[id] || id);
}

function normalizeComparableName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatDisplayName(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatPolicyTarget(policy) {
  if (policy.assignmentMode !== 'selectedGroups') return 'All Intune devices';
  const labels = selectedLabels(policy.intuneDeviceGroupIds || [], policy.intuneDeviceGroupMap || {}, [], 'displayName');
  return labels.length ? labels.join(', ') : 'Selected Intune Groups';
}

function formatMonitoringTarget(policy) {
  if (policy.profileType === PROFILE_TYPE_ENROLLMENT_ONLY) return 'Enrollment Only';
  const labels = selectedLabels(policy.monitoredAction1GroupIds || [], policy.monitoredAction1GroupMap || [], [], 'name');
  return labels.length ? labels.join(', ') : 'Not configured';
}

function action1AutomationUrl(consoleBaseUrl, organizationId, automationId) {
  const base = String(consoleBaseUrl || 'https://app.action1.com').replace(/\/+$/, '');
  const id = String(automationId || '').trim();
  const org = String(organizationId || '').trim();
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (org) params.set('org', org);
  return `${base}/console/new-policy-deploy-package/step-1?${params.toString()}`;
}

function resolveMenuPosition(triggerRect, menuRect) {
  const viewportPadding = 12;
  const gap = 8;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const openUpward = spaceBelow < menuRect.height + gap && triggerRect.top > spaceBelow;
  const top = openUpward
    ? Math.max(viewportPadding, triggerRect.top - menuRect.height - gap)
    : Math.min(window.innerHeight - menuRect.height - viewportPadding, triggerRect.bottom + gap);
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right - menuRect.width),
    window.innerWidth - menuRect.width - viewportPadding
  );
  return { top, left, transformOrigin: openUpward ? 'bottom right' : 'top right' };
}

function ProfileActionMenu({ items, label = 'Profile actions' }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, transformOrigin: 'top right' });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return;
    const updatePosition = () => {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      setPosition(resolveMenuPosition(triggerRect, menuRect));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    menuRef.current.querySelector('button')?.focus();
  }, [isOpen]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        className="menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(value => !value)}
      >
        {'\u2026'}
      </button>
      {isOpen ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{
            position: 'fixed',
            minWidth: 176,
            border: `1px solid ${tokens.borderColor}`,
            borderRadius: 8,
            background: tokens.surfaceBackground,
            boxShadow: '0 18px 48px rgba(15, 23, 42, 0.12)',
            padding: '0.3rem',
            display: 'grid',
            gap: '0.2rem',
            zIndex: 40,
            top: position.top,
            left: position.left,
            transformOrigin: position.transformOrigin
          }}
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              style={{
                height: 34,
                border: 'none',
                borderTop: item.destructive ? `1px solid ${tokens.borderColor}` : 'none',
                borderRadius: 4,
                padding: item.destructive ? '0.6rem 0.65rem 0.5rem' : '0.5rem 0.65rem',
                marginTop: item.destructive ? '0.15rem' : 0,
                background: tokens.surfaceBackground,
                color: item.destructive ? tokens.danger : tokens.textPrimary,
                textAlign: 'left',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer'
              }}
              onClick={() => {
                setIsOpen(false);
                item.onSelect();
                triggerRef.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </span>
  );
}

function PolicyList({ policies, loading, onCreate, onEdit, onDelete }) {
  return (
    <section style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div />
        <button type="button" className="btn btn-primary" onClick={onCreate}>Create Profile</button>
      </div>
      {loading ? (
        <div className="card" style={{ padding: '1rem' }}>Loading profiles...</div>
      ) : policies.length === 0 ? (
        <div className="empty-state">
          <h2>No profiles</h2>
          <p>
            Create an Enrollment and Provisioning Profile for each Action1 organization you want Intune to deploy and monitor.
          </p>
        </div>
      ) : (
        <table className="profile-table">
          <thead>
            <tr>
              {['Profile', 'Action1 Organization', 'Intune Enrollment Group', 'Action1 Provisioning Group', 'Actions'].map(header => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {policies.map(policy => (
              <tr key={policy.policyId}>
                <td>
                  <button type="button" className="profile-name-link" onClick={() => onEdit(policy)}>{policy.name}</button>
                </td>
                <td><p className="value-text">{formatDisplayName(policy.organizationName) || policy.organizationId}</p></td>
                <td><p className="value-text">{formatPolicyTarget(policy)}</p></td>
                <td><p className="value-text">{formatMonitoringTarget(policy)}</p></td>
                <td className="actions-cell">
                  <ProfileActionMenu
                    label={`${policy.name} actions`}
                    items={[
                      { label: 'Edit', onSelect: () => onEdit(policy) },
                      { label: 'Delete', destructive: true, onSelect: () => onDelete(policy.policyId) }
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Stepper({ steps, stepIndex, setStepIndex }) {
  return (
    <div className="stepper">
      {steps.map((step, index) => (
        <div key={step.id} style={{ display: 'contents' }}>
          <button
            type="button"
            onClick={() => index < stepIndex && setStepIndex(index)}
            className={cx('step', index === stepIndex && 'active', index < stepIndex && 'done')}
          >
            <span className="num">
              {index + 1}
            </span>
            {step.label}
          </button>
          {index < steps.length - 1 && <div className="step-sep" />}
        </div>
      ))}
    </div>
  );
}

function Help({ children }) {
  return <p className="section-sub">{children}</p>;
}

function Checklist({ rows, selectedIds, onChange, labelKey = 'name', emptyText, disabledIds = new Set(), disabledReason = '' }) {
  return (
    <div className="pick-list">
      {rows.length === 0 ? (
        <div style={{ padding: '0.85rem', color: tokens.textMuted, fontSize: 13 }}>{emptyText}</div>
      ) : rows.map(row => {
        const isDisabled = disabledIds.has(row.id) && !selectedIds.includes(row.id);
        return (
          <label
            key={row.id}
            className={cx('pick-row', isDisabled && 'disabled')}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(row.id)}
              disabled={isDisabled}
              onChange={event => {
                if (isDisabled) return;
                onChange(event.target.checked ? [...selectedIds, row.id] : selectedIds.filter(id => id !== row.id));
              }}
              style={{ marginTop: 2 }}
            />
            <span>
              <span className="pick-name">{row[labelKey] || row.id}</span>
              {row.description ? <span className="pick-desc">{row.description}</span> : null}
              {isDisabled && disabledReason ? <span className="pick-desc">{disabledReason}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function EndpointGroupChecklist({ rows, selectedIds, onChange, emptyText }) {
  return (
    <div className="pick-list large">
      {rows.length === 0 ? (
        <div style={{ padding: '0.85rem', color: tokens.textMuted, fontSize: 13 }}>{emptyText}</div>
      ) : rows.map(row => {
        const selected = selectedIds.includes(row.id);

        return (
          <div key={row.id} className="pick-row">
              <input
                type="checkbox"
                checked={selected}
                onChange={event => onChange(event.target.checked ? [...selectedIds, row.id] : selectedIds.filter(id => id !== row.id))}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1 }}>
                <div className="pick-name">{row.name || row.id}</div>
                {row.description ? <div className="pick-desc">{row.description}</div> : null}
              </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewEndpointGroupDetails({ selectedIds, selectedNames, detailsByGroupId, action1ConsoleBase, organizationId, includeProvisioning, includeConfigurationManagement }) {
  if (!selectedIds.length) return <div style={{ color: tokens.textMuted }}>No Action1 provisioning groups selected.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {selectedIds.map(groupId => {
        const details = detailsByGroupId[groupId] || {};
        const automations = includeProvisioning && Array.isArray(details.provisioningAutomations) ? details.provisioningAutomations : [];
        const configPolicies = includeConfigurationManagement && Array.isArray(details.configurationPolicies) ? details.configurationPolicies : [];
        const hasDetails = automations.length > 0 || configPolicies.length > 0;
        return (
          <div key={groupId} style={{ border: `1px solid ${tokens.borderColor}`, borderRadius: 4, padding: '0.75rem', background: tokens.mutedBackground }}>
            <div style={{ fontWeight: 700, marginBottom: hasDetails ? 8 : 0 }}>{selectedNames[groupId] || groupId}</div>
            {!hasDetails && <div style={{ color: tokens.textMuted, fontSize: 12 }}>No provisioning automations or Configuration Management policies were found for this Action1 provisioning group.</div>}
            {automations.length > 0 && (
              <div style={{ marginBottom: configPolicies.length ? 10 : 0 }}>
                <div style={{ color: tokens.textMuted, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>Provisioning Automations</div>
                <ul style={{ ...instructionListStyle, marginBottom: 0 }}>
                  {automations.map(automation => (
                    <li key={automation.id}>
                      <a href={action1AutomationUrl(action1ConsoleBase, organizationId, automation.id)} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
                        {automation.name || automation.id}
                      </a>
                      {automation.enabled === false ? ' (disabled)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {configPolicies.length > 0 && (
              <div>
                <div style={{ color: tokens.textMuted, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>Configuration Management Policies</div>
                <ul style={{ ...instructionListStyle, marginBottom: 0 }}>
                  {configPolicies.map(policy => (
                    <li key={policy.id}>
                      <a href={`/apps/action1-configuration-manager/policies?policyId=${encodeURIComponent(policy.id)}`} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
                        {policy.name || policy.displayName || policy.id}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewProvisioningAutomations({ selectedIds, selectedNames, detailsByGroupId, action1ConsoleBase, organizationId, loading }) {
  const rows = selectedIds.flatMap(groupId => {
    const automations = Array.isArray(detailsByGroupId[groupId]?.provisioningAutomations)
      ? detailsByGroupId[groupId].provisioningAutomations
      : [];
    return automations.map(automation => ({ ...automation, groupId }));
  });
  if (loading) return <span style={{ color: tokens.textMuted }}>Loading provisioning automations...</span>;
  if (!rows.length) return <span style={{ color: tokens.textMuted }}>No provisioning automations found.</span>;
  return (
    <ul style={{ ...summaryListStyle, marginTop: 0 }}>
      {rows.map(automation => (
        <li key={`${automation.groupId}:${automation.id}`}>
          <a href={action1AutomationUrl(action1ConsoleBase, organizationId, automation.id)} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
            {automation.name || automation.id}
          </a>
          <span style={summaryMetaStyle}> in {selectedNames[automation.groupId] || automation.groupId}{automation.enabled === false ? ' (disabled)' : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewConfigurationPolicies({ selectedIds, selectedNames, detailsByGroupId, loading }) {
  const rows = selectedIds.flatMap(groupId => {
    const policies = Array.isArray(detailsByGroupId[groupId]?.configurationPolicies)
      ? detailsByGroupId[groupId].configurationPolicies
      : [];
    return policies.map(policy => ({ ...policy, groupId }));
  });
  if (loading) return <span style={{ color: tokens.textMuted }}>Loading Configuration Management policies...</span>;
  if (!rows.length) return <span style={{ color: tokens.textMuted }}>No Configuration Management policies found.</span>;
  return (
    <ul style={{ ...summaryListStyle, marginTop: 0 }}>
      {rows.map(policy => (
        <li key={`${policy.groupId}:${policy.id}`}>
          <a href={`/apps/action1-configuration-manager/policies?policyId=${encodeURIComponent(policy.id)}`} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
            {policy.name || policy.displayName || policy.id}
          </a>
          <span style={summaryMetaStyle}> in {selectedNames[policy.groupId] || policy.groupId}</span>
        </li>
      ))}
    </ul>
  );
}

function PolicyWizard({ integration, initialPolicy, policies = [], onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => {
    const nextDraft = { ...defaultDraft(), ...(initialPolicy || {}) };
    nextDraft.profileType = nextDraft.profileType || ((nextDraft.provisioningEnabled || nextDraft.configurationManagementEnabled || (nextDraft.monitoredAction1GroupIds || []).length) ? PROFILE_TYPE_ENROLLMENT_AND_PROVISIONING : PROFILE_TYPE_ENROLLMENT_ONLY);
    if (nextDraft.profileType === PROFILE_TYPE_ENROLLMENT_AND_PROVISIONING) {
      nextDraft.provisioningEnabled = true;
      nextDraft.configurationManagementEnabled = true;
    }
    return nextDraft;
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [organizations, setOrganizations] = useState([]);
  const [deviceGroups, setDeviceGroups] = useState([]);
  const [endpointGroups, setEndpointGroups] = useState([]);
  const [endpointGroupDetails, setEndpointGroupDetails] = useState({});
  const [endpointGroupDetailWarning, setEndpointGroupDetailWarning] = useState('');
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const isEnrollmentOnly = draft.profileType === PROFILE_TYPE_ENROLLMENT_ONLY;
  const steps = isEnrollmentOnly ? ENROLLMENT_ONLY_STEPS : FULL_PROFILE_STEPS;
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)]?.id || 'organization';

  const loadOrganizations = useCallback(() => {
    setLoading('organizations');
    apiAction(integration, 'list-action1-organizations')
      .then(data => setOrganizations(data.organizations || []))
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(''));
  }, [integration]);

  const loadDeviceGroups = useCallback(() => {
    setLoading(current => current || 'device-groups');
    apiAction(integration, 'list-device-groups')
      .then(data => setDeviceGroups(data.groups || []))
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(current => current === 'device-groups' ? '' : current));
  }, [integration]);

  const loadEndpointGroups = useCallback((organizationId) => {
    if (!organizationId) return;
    setLoading('endpoint-groups');
    apiAction(integration, 'list-action1-endpoint-groups', { organizationId })
      .then(data => setEndpointGroups(data.groups || []))
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(''));
  }, [integration]);

  const loadEndpointGroupDetails = useCallback((organizationId) => {
    if (!organizationId) return;
    setEndpointGroupDetailWarning('');
    setLoading(current => current || 'endpoint-group-details');
    apiAction(integration, 'list-action1-endpoint-group-details', { organizationId })
      .then(data => {
        setEndpointGroupDetails(data.groupDetails || {});
        setEndpointGroupDetailWarning(data.scheduleWarning || '');
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(current => current === 'endpoint-group-details' ? '' : current));
  }, [integration]);

  useEffect(() => {
    if (stepIndex === 0) loadOrganizations();
  }, [stepIndex, loadOrganizations]);

  useEffect(() => {
    if (stepIndex === 1) loadDeviceGroups();
  }, [stepIndex, loadDeviceGroups]);

  useEffect(() => {
    if (activeStep === 'action1') {
      loadEndpointGroups(draft.organizationId);
    }
    if (activeStep === 'review') {
      loadEndpointGroupDetails(draft.organizationId);
    }
  }, [activeStep, draft.organizationId, loadEndpointGroups, loadEndpointGroupDetails]);

  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(Math.max(0, steps.length - 1));
  }, [stepIndex, steps.length]);

  const action1ConsoleBase = 'https://app.action1.com';
  const createAutomationUrl = draft.organizationId
    ? `${action1ConsoleBase}/console/automations?limit=50&from=0&add_endpoints-limit=50&add_endpoints-from=0&org=${encodeURIComponent(draft.organizationId)}`
    : `${action1ConsoleBase}/console/automations?limit=50&from=0&add_endpoints-limit=50&add_endpoints-from=0`;
  const createConfigPolicyUrl = '/apps/action1-configuration-manager/policies';

  const selectedIntuneNames = selectedLabels(draft.intuneDeviceGroupIds, draft.intuneDeviceGroupMap, deviceGroups, 'displayName');
  const selectedEndpointGroupNames = selectedLabels(draft.monitoredAction1GroupIds, draft.monitoredAction1GroupMap, endpointGroups, 'name');
  const selectedEndpointGroupNameMap = useMemo(() => {
    const map = { ...draft.monitoredAction1GroupMap };
    for (const group of endpointGroups) map[group.id] = group.name || group.id;
    return map;
  }, [draft.monitoredAction1GroupMap, endpointGroups]);
  const loadingEndpointGroupDetails = loading === 'endpoint-group-details';
  const usedOrganizationIds = useMemo(() => new Set(
    policies
      .filter(policy => policy.policyId !== initialPolicy?.policyId)
      .map(policy => String(policy.organizationId || '').trim())
      .filter(Boolean)
  ), [policies, initialPolicy?.policyId]);
  const usedOrganizationNames = useMemo(() => new Set(
    policies
      .filter(policy => policy.policyId !== initialPolicy?.policyId)
      .map(policy => normalizeComparableName(policy.organizationName))
      .filter(Boolean)
  ), [policies, initialPolicy?.policyId]);
  const usedIntuneDeviceGroupIds = useMemo(() => new Set(
    policies
      .filter(policy => policy.policyId !== initialPolicy?.policyId)
      .filter(policy => policy.assignmentMode === 'selectedGroups')
      .flatMap(policy => policy.intuneDeviceGroupIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  ), [policies, initialPolicy?.policyId]);

  function updateOrganization(organizationId) {
    const organization = organizations.find(item => item.id === organizationId);
    const organizationName = normalizeComparableName(organization?.name);
    if (organizationId && (usedOrganizationIds.has(organizationId) || usedOrganizationNames.has(organizationName))) return;
    if (organizationId !== draft.organizationId) setEndpointGroups([]);
    setDraft(current => ({
      ...current,
      organizationId,
      organizationName: organization?.name || '',
      agentId: organization?.agentId || '',
      agentDownloadOrgName: organization?.agentDownloadOrgName || organization?.name || '',
      monitoredAction1GroupIds: current.organizationId === organizationId ? current.monitoredAction1GroupIds : [],
      monitoredAction1GroupMap: current.organizationId === organizationId ? current.monitoredAction1GroupMap : {},
      name: current.name || (organization?.name ? `${organization.name} enrollment` : '')
    }));
  }

  function updateIntuneGroups(ids) {
    const availableIds = ids.filter(id => !usedIntuneDeviceGroupIds.has(id) || draft.intuneDeviceGroupIds.includes(id));
    const map = {};
    for (const group of deviceGroups) if (availableIds.includes(group.id)) map[group.id] = group.displayName || group.id;
    setDraft(current => ({ ...current, intuneDeviceGroupIds: availableIds, intuneDeviceGroupMap: { ...current.intuneDeviceGroupMap, ...map } }));
  }

  function updateEndpointGroups(ids) {
    const map = {};
    for (const group of endpointGroups) if (ids.includes(group.id)) map[group.id] = group.name || group.id;
    setDraft(current => ({ ...current, monitoredAction1GroupIds: ids, monitoredAction1GroupMap: { ...current.monitoredAction1GroupMap, ...map } }));
  }

  function updateProfileType(profileType) {
    setDraft(current => {
      if (profileType === PROFILE_TYPE_ENROLLMENT_ONLY) {
        return {
          ...current,
          profileType,
          provisioningEnabled: false,
          configurationManagementEnabled: false,
          monitoredAction1GroupIds: [],
          monitoredAction1GroupMap: {}
        };
      }
      return {
        ...current,
        profileType,
        provisioningEnabled: true,
        configurationManagementEnabled: true
      };
    });
  }

  function validateStep(stepId) {
    if (stepId === 'organization' && (!draft.name || !draft.organizationId || !draft.agentId)) return 'Choose an Action1 organization. The organization must expose an agent installer ID.';
    if (stepId === 'organization' && (usedOrganizationIds.has(draft.organizationId) || usedOrganizationNames.has(normalizeComparableName(draft.organizationName)))) return 'This Action1 organization is already assigned to another profile.';
    if (stepId === 'intune' && draft.assignmentMode === 'selectedGroups' && draft.intuneDeviceGroupIds.length === 0) return 'Select at least one Intune device group, or choose all devices.';
    if (stepId === 'intune' && draft.intuneDeviceGroupIds.some(id => usedIntuneDeviceGroupIds.has(id))) return 'One or more selected Intune device groups are already assigned to another profile.';
    if (stepId === 'action1' && !isEnrollmentOnly && draft.monitoredAction1GroupIds.length === 0) return 'Select the Action1 provisioning groups this profile should monitor.';
    return '';
  }

  function next() {
    const stepError = validateStep(activeStep);
    if (stepError) {
      setMessage(stepError);
      return;
    }
    setMessage('');
    setStepIndex(current => Math.min(current + 1, steps.length - 1));
  }

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const result = await apiAction(integration, 'save-policy', { policy: draft });
      onSaved(result.policy);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">{initialPolicy ? 'Edit Enrollment and Provisioning Profile' : 'Enrollment and Provisioning Profile'}</h2>
      <p className="card-sub">
        Configure which Intune devices are enrolled in Action1 and which Action1 provisioning groups are configured for provisioning.
      </p>
      <Stepper steps={steps} stepIndex={stepIndex} setStepIndex={setStepIndex} />
      {message && <div className="validation-notice">{message}</div>}

      {activeStep === 'organization' && (
        <section className="section">
          <h3 className="section-title">Profile Details</h3>
          <Help>Start by naming the profile and providing a description.</Help>
          <div className="field">
            <label>Profile Name <span className="req">*</span></label>
            <input type="text" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} />
          </div>
          <div className="field">
            <Help>Choose <strong>Enrollment Only</strong> when devices should only be enrolled into Action1. Choose <strong>Enrollment and Provisioning</strong> when devices should be both enrolled and provisioned.</Help>
            <label>Profile Type <span className="req">*</span></label>
            <select value={draft.profileType} onChange={event => updateProfileType(event.target.value)}>
              <option value={PROFILE_TYPE_ENROLLMENT_AND_PROVISIONING}>Enrollment and Provisioning</option>
              <option value={PROFILE_TYPE_ENROLLMENT_ONLY}>Enrollment Only</option>
            </select>
          </div>
          <div className="field">
            <Help>Choose the Action1 organization where newly enrolled devices should be registered.</Help>
            <label>Action1 Organization <span className="req">*</span></label>
            <select value={draft.organizationId} onChange={event => updateOrganization(event.target.value)}>
              <option value="">{loading === 'organizations' ? 'Loading organizations...' : 'Select Organization'}</option>
              {organizations.map(organization => {
                const isUsed = usedOrganizationIds.has(organization.id) || usedOrganizationNames.has(normalizeComparableName(organization.name));
                return (
                  <option key={organization.id} value={organization.id} disabled={isUsed} style={isUsed ? { color: tokens.textMuted, background: tokens.mutedBackground } : undefined}>
                    {formatDisplayName(organization.name)}{isUsed ? ' (in use)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <Help>Organizations already assigned to another Enrollment and Provisioning Profile are unavailable, because each Action1 organization can only have one profile.</Help>
        </section>
      )}

      {activeStep === 'intune' && (
        <section className="section">
          <h3 className="section-title">Choose the Devices to Enroll</h3>
          <Help>Select which Intune-managed Windows devices should be enrolled into Action1.</Help>
          <div className="radio-row">
            <label className="radio-item"><input type="radio" checked={draft.assignmentMode === 'allDevices'} onChange={() => setDraft(current => ({ ...current, assignmentMode: 'allDevices' }))} /> All Devices</label>
            <label className="radio-item"><input type="radio" checked={draft.assignmentMode === 'selectedGroups'} onChange={() => setDraft(current => ({ ...current, assignmentMode: 'selectedGroups' }))} /> Selected Device Groups</label>
          </div>
          {draft.assignmentMode === 'selectedGroups' && (
            <>
              <Help>Choose the Intune device groups whose devices should be enrolled into Action1.</Help>
              <Checklist
                rows={deviceGroups}
                selectedIds={draft.intuneDeviceGroupIds}
                onChange={updateIntuneGroups}
                labelKey="displayName"
                emptyText={loading === 'device-groups' ? 'Loading Intune device groups...' : 'No Intune device groups were found.'}
                disabledIds={usedIntuneDeviceGroupIds}
                disabledReason="Already used by another profile."
              />
            </>
          )}
        </section>
      )}

      {activeStep === 'action1' && (
        <section className="section">
          <h3 className="section-title">Create and Select Action1 Provisioning Groups</h3>
          <Help>Create Action1 Provisioning Groups for enrolled devices. Use Action1 filters so devices move through the groups automatically as enrollment and provisioning state changes. After creating groups in Action1, return here and refresh the list.</Help>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '0.25rem 0 0.85rem' }}>
            <a href={draft.organizationId ? `${action1ConsoleBase}/console/endpoints?limit=50&from=0&org=${encodeURIComponent(draft.organizationId)}` : `${action1ConsoleBase}/console/endpoints?limit=50&from=0`} target="_blank" rel="noreferrer" className="btn btn-primary link-button">Open Action1 Provisioning Groups</a>
            <button type="button" className="btn btn-secondary" onClick={() => loadEndpointGroups(draft.organizationId)} disabled={!draft.organizationId || loading === 'endpoint-groups'}>
              {loading === 'endpoint-groups' ? 'Refreshing...' : 'Refresh groups'}
            </button>
          </div>
          <Help>Select the Action1 Provisioning Groups created for this profile.</Help>
          <EndpointGroupChecklist
            rows={endpointGroups}
            selectedIds={draft.monitoredAction1GroupIds}
            onChange={updateEndpointGroups}
            emptyText={loading === 'endpoint-groups' ? 'Loading Action1 provisioning groups...' : 'No Action1 provisioning groups were found for this organization.'}
          />
        </section>
      )}

      {activeStep === 'provisioning' && (
        <section className="section">
          <h3 className="section-title">Provisioning Automations and Configuration Management</h3>
          <Help>Create the provisioning automations and Configuration Management policies for this profile and ensure each is associated with the previously selected provisioning groups.</Help>

          <h4 style={{ margin: '12px 0 4px', fontSize: 13 }}>Provisioning Automations</h4>
          <p className="section-sub">Create Action1 automations that install software, run scripts, or perform other provisioning work and target those automations to the Action1 provisioning groups selected in the previous step.</p>
          <p><a href={createAutomationUrl} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>Create Action1 Provisioning Automations</a></p>

          <h4 style={{ margin: '12px 0 4px', fontSize: 13 }}>Configuration Management Policies</h4>
          <p className="section-sub">Create Configuration Management policies that contain the required controls and target the policies to the Action1 provisioning groups selected in the previous step.</p>
          <p><a href={createConfigPolicyUrl} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>Create Configuration Management Policies</a></p>
        </section>
      )}

      {activeStep === 'review' && (
        <section className="section">
          <h3 className="section-title">Review</h3>
          <Help>Review the profile before saving. The next sync will apply the Intune assignment and refresh the dashboard for this organization.</Help>
          {!isEnrollmentOnly && endpointGroupDetailWarning && <div style={{ margin: '0 0 12px', padding: '10px 12px', border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 4, fontSize: 13 }}>{endpointGroupDetailWarning}</div>}
          <div className="summary-grid">
            <div className="s-label">Profile</div><div><strong>{draft.name}</strong></div>
            <div className="s-label">Profile Type</div><div>{isEnrollmentOnly ? 'Enrollment Only' : 'Enrollment and Provisioning'}</div>
            <div className="s-label">Action1 Organization</div><div>{formatDisplayName(draft.organizationName) || 'Not selected'}</div>
            <div className="s-label">Intune Enrollment Group</div><div>{draft.assignmentMode === 'allDevices' ? 'All Devices' : selectedIntuneNames.join(', ') || 'No groups selected'}</div>
            {!isEnrollmentOnly && <><div className="s-label">Action1 Provisioning Groups</div><div>{selectedEndpointGroupNames.join(', ') || 'No groups selected'}</div></>}
            {!isEnrollmentOnly && <><div className="s-label">Provisioning Automations</div><div><ReviewProvisioningAutomations selectedIds={draft.monitoredAction1GroupIds} selectedNames={selectedEndpointGroupNameMap} detailsByGroupId={endpointGroupDetails} action1ConsoleBase={action1ConsoleBase} organizationId={draft.organizationId} loading={loadingEndpointGroupDetails} /></div></>}
            {!isEnrollmentOnly && <><div className="s-label">Configuration Management Policies</div><div><ReviewConfigurationPolicies selectedIds={draft.monitoredAction1GroupIds} selectedNames={selectedEndpointGroupNameMap} detailsByGroupId={endpointGroupDetails} loading={loadingEndpointGroupDetails} /></div></>}
          </div>
        </section>
      )}

      <div className="wizard-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <div className="spacer" />
        {stepIndex > 0 && <button type="button" className="btn btn-secondary" onClick={() => setStepIndex(current => Math.max(0, current - 1))}>Back</button>}
        {stepIndex < steps.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={next}>Next</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save Profile'}</button>
        )}
      </div>
    </div>
  );
}

const summaryListStyle = { margin: '0 0 0 1.15rem', padding: 0, fontSize: 14, lineHeight: 1.45 };
const summaryMetaStyle = { color: tokens.textMuted, fontSize: 12 };

function Policies({ integration }) {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [mode, setMode] = useState('list');
  const [message, setMessage] = useState('');

  async function refreshPolicies() {
    setLoading(true);
    try {
      const result = await apiAction(integration, 'list-policies');
      setPolicies(result.policies || []);
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshPolicies();
  }, [integration]);

  async function deletePolicy(policyId) {
    if (!window.confirm('Delete this profile?')) return;
    try {
      await apiAction(integration, 'delete-policy', { policyId });
      await refreshPolicies();
    } catch (error) {
      setMessage(error.message);
    }
  }

  const title = mode === 'list' ? 'Profiles' : editingPolicy ? 'Edit Profile' : 'Create Profile';

  return (
    <div className="a1-profile-ui" style={{ width: '100%', maxWidth: 960, margin: '0 auto', display: 'grid', gap: '0.75rem' }}>
      <style>{PROFILE_CSS}</style>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>
        <p style={{ margin: '0.45rem 0 0', color: tokens.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
          Define how devices are enrolled through Intune and which Action1 provisioning group is used for provisioning readiness.
        </p>
      </div>
      {message && <div style={{ padding: '0.875rem 1rem', color: tokens.danger, border: '1px solid #fecaca', background: '#fff7f7', borderRadius: 8 }}>{message}</div>}
      {mode === 'list' ? (
        <PolicyList
          policies={policies}
          loading={loading}
          onCreate={() => { setEditingPolicy(null); setMode('edit'); }}
          onEdit={(policy) => { setEditingPolicy(policy); setMode('edit'); }}
          onDelete={deletePolicy}
        />
      ) : (
        <PolicyWizard
          integration={integration}
          initialPolicy={editingPolicy}
          policies={policies}
          onCancel={() => setMode('list')}
          onSaved={async () => {
            setMode('list');
            setEditingPolicy(null);
            await refreshPolicies();
          }}
        />
      )}
    </div>
  );
}

export default Policies;
