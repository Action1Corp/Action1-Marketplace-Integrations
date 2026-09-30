import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';

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

const ACTION1_AUTOMATION_TYPES = [
  { id: 'deploy-software', label: 'Deploy Software' },
  { id: 'deploy-updates', label: 'Deploy Updates' },
  { id: 'run-script', label: 'Run Script' }
];

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
.a1-profile-ui .step.available { color: var(--text-2); cursor: pointer; }
.a1-profile-ui .step.available:hover { color: var(--text); }
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
.a1-profile-ui .automation-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
.a1-profile-ui .automation-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0 8px; }
.a1-profile-ui .automation-list-heading h4 { margin: 0; font-size: var(--fs-label); }
.a1-profile-ui .automation-table-wrap { max-width: 100%; overflow-x: auto; }
.a1-profile-ui .automation-list { width: 100%; border-collapse: collapse; }
.a1-profile-ui .automation-list th, .a1-profile-ui .automation-list td { padding: 9px 8px; text-align: left; border-bottom: 1px solid var(--border); font-size: var(--fs-label); }
.a1-profile-ui .automation-list th { color: var(--text-2); font-weight: 600; background: var(--bg-muted); }
.a1-profile-ui .automation-list td:first-child { font-weight: 600; overflow-wrap: anywhere; }
.a1-profile-ui .automation-list .automation-actions { white-space: nowrap; text-align: right; }
.a1-profile-ui .automation-list .automation-actions .btn { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; }
.a1-profile-ui .automation-refresh { padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.a1-profile-ui .modal-backdrop { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(20, 27, 45, .48); }
.a1-profile-ui .modal-dialog { width: min(440px, 100%); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: 0 18px 48px rgba(20, 27, 45, .22); padding: 20px; }
.a1-profile-ui .modal-title { margin: 0 0 4px; font-size: var(--fs-section); font-weight: 600; }
.a1-profile-ui .modal-sub { margin: 0 0 16px; color: var(--text-2); font-size: var(--fs-label); }
.a1-profile-ui .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
@media (max-width: 640px) {
  .a1-profile-ui .summary-grid { grid-template-columns: 1fr; }
  .a1-profile-ui .automation-list { min-width: 700px; }
  .a1-profile-ui .automation-list .automation-actions { white-space: normal; }
  .a1-profile-ui .automation-list .automation-actions .btn { margin: 0 0 4px 0; }
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
    agentIds: {},
    agentDownloadOrgName: '',
    platforms: ['windows'],
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
            Create an Enrollment and Provisioning Profile for each device target you want Intune to deploy and monitor.
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
                  <div style={{ color: tokens.textMuted, fontSize: 12, marginTop: 3 }}>{(policy.platforms || ['windows']).map(platform => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[platform] || platform).join(', ')}</div>
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

function Stepper({ steps, stepIndex, onStepSelect, allowForwardNavigation }) {
  return (
    <div className="stepper">
      {steps.map((step, index) => (
        <div key={step.id} style={{ display: 'contents' }}>
          <button
            type="button"
            onClick={() => (allowForwardNavigation || index < stepIndex) && onStepSelect(index)}
            className={cx('step', index === stepIndex && 'active', index < stepIndex && 'done', allowForwardNavigation && index > stepIndex && 'available')}
            aria-current={index === stepIndex ? 'step' : undefined}
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

function EndpointGroupTable({ rows, selectedIds, usedByProfile, onChange, onDelete, deletingId, emptyText }) {
  return (
    rows.length === 0 ? <p className="section-sub">{emptyText}</p> : (
      <div className="automation-table-wrap"><table className="automation-list">
        <thead><tr><th style={{ width: 72 }}>Select</th><th>Name</th><th style={{ width: 90 }}>Endpoints</th><th className="automation-actions">Actions</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.id}>
            <td><input type="checkbox" aria-label={`Select ${row.name || row.id}`} checked={selectedIds.includes(row.id)} disabled={!!usedByProfile[row.id]} title={usedByProfile[row.id] ? `Used by ${usedByProfile[row.id]}` : undefined} onChange={event => onChange(event.target.checked ? [...selectedIds, row.id] : selectedIds.filter(id => id !== row.id))} /></td>
            <td>{row.name || row.id}{usedByProfile[row.id] && <div className="section-sub">Used by {usedByProfile[row.id]}</div>}</td>
            <td>{Number.isFinite(row.endpointCount) ? row.endpointCount : '-'}</td>
            <td className="automation-actions">
              {row.editable ? <a className="btn btn-secondary link-button" href={row.editUrl} target="_blank" rel="noopener noreferrer" title={`Edit ${row.name} in Action1`}><Pencil size={14} /> Edit</a> : <button type="button" className="btn btn-secondary" disabled title="This Action1 group cannot be customized"><Pencil size={14} /> Edit</button>}
              <button type="button" className="btn btn-secondary btn-danger" disabled={!row.editable || !!deletingId || !!usedByProfile[row.id]} title={usedByProfile[row.id] ? `Used by ${usedByProfile[row.id]}` : row.editable ? `Delete ${row.name}` : 'This Action1 group cannot be deleted'} onClick={() => onDelete(row)}><Trash2 size={14} /> {deletingId === row.id ? 'Deleting...' : 'Delete'}</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    )
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
                      <a href={automation.editUrl || action1AutomationUrl(action1ConsoleBase, organizationId, automation.id)} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
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
          <a href={automation.editUrl || action1AutomationUrl(action1ConsoleBase, organizationId, automation.id)} target="_blank" rel="noreferrer" style={{ color: '#003DA6', fontWeight: 700 }}>
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
  const [endpointGroupDialogOpen, setEndpointGroupDialogOpen] = useState(false);
  const [endpointGroupName, setEndpointGroupName] = useState('');
  const [creatingEndpointGroup, setCreatingEndpointGroup] = useState(false);
  const [endpointGroupError, setEndpointGroupError] = useState('');
  const [deletingEndpointGroupId, setDeletingEndpointGroupId] = useState('');
  const endpointGroupRequestId = useRef(0);
  const [endpointGroupDetails, setEndpointGroupDetails] = useState({});
  const [endpointGroupDetailWarning, setEndpointGroupDetailWarning] = useState('');
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [automationDialog, setAutomationDialog] = useState(null);
  const [automationName, setAutomationName] = useState('');
  const [automationPlatform, setAutomationPlatform] = useState('windows');
  const [creatingAutomation, setCreatingAutomation] = useState(false);
  const [automationError, setAutomationError] = useState('');
  const [automations, setAutomations] = useState([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsError, setAutomationsError] = useState('');
  const [deletingAutomationId, setDeletingAutomationId] = useState('');
  const [enablingAutomationId, setEnablingAutomationId] = useState('');
  const [automationRefresh, setAutomationRefresh] = useState(0);
  const automationRequestId = useRef(0);
  const [configPolicyDialogOpen, setConfigPolicyDialogOpen] = useState(false);
  const [configPolicyName, setConfigPolicyName] = useState('');
  const [configPolicies, setConfigPolicies] = useState([]);
  const [configPoliciesLoading, setConfigPoliciesLoading] = useState(false);
  const [configPoliciesError, setConfigPoliciesError] = useState('');
  const [deletingConfigPolicyId, setDeletingConfigPolicyId] = useState('');
  const [configPolicyRefresh, setConfigPolicyRefresh] = useState(0);
  const configPolicyRequestId = useRef(0);
  const isEnrollmentOnly = draft.profileType === PROFILE_TYPE_ENROLLMENT_ONLY;
  const steps = isEnrollmentOnly ? ENROLLMENT_ONLY_STEPS : FULL_PROFILE_STEPS;
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)]?.id || 'organization';

  const loadOrganizations = useCallback(() => {
    setLoading('organizations');
    apiAction(integration, 'list-action1-organizations')
      .then(data => {
        const loaded = data.organizations || [];
        setOrganizations(loaded);
        setDraft(current => {
          const organization = loaded.find(item => item.id === current.organizationId);
          return organization ? {
            ...current,
            agentId: organization.agentId || '',
            agentIds: organization.agentIds || {},
            agentDownloadOrgName: organization.agentDownloadOrgName || organization.name || ''
          } : current;
        });
      })
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
    const requestId = ++endpointGroupRequestId.current;
    setLoading('endpoint-groups');
    apiAction(integration, 'list-action1-endpoint-groups', { organizationId })
      .then(data => { if (requestId === endpointGroupRequestId.current) setEndpointGroups(data.groups || []); })
      .catch(error => { if (requestId === endpointGroupRequestId.current) setEndpointGroupError(error.message); })
      .finally(() => { if (requestId === endpointGroupRequestId.current) setLoading(current => current === 'endpoint-groups' ? '' : current); });
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
    if (activeStep !== 'provisioning') return;
    const requestId = ++automationRequestId.current;
    if (!draft.organizationId || !draft.monitoredAction1GroupIds.length) {
      setAutomations([]);
      return;
    }
    setAutomationsLoading(true);
    setAutomationsError('');
    setAutomations([]);
    apiAction(integration, 'list-provisioning-automations', {
      organizationId: draft.organizationId,
      endpointGroupIds: draft.monitoredAction1GroupIds
    })
      .then(data => {
        if (requestId === automationRequestId.current) setAutomations(data.automations || []);
      })
      .catch(error => {
        if (requestId === automationRequestId.current) setAutomationsError(error.message);
      })
      .finally(() => {
        if (requestId === automationRequestId.current) setAutomationsLoading(false);
      });
    return () => { automationRequestId.current++; };
  }, [activeStep, draft.organizationId, draft.monitoredAction1GroupIds, automationRefresh, integration]);

  useEffect(() => {
    if (activeStep !== 'provisioning') return;
    const requestId = ++configPolicyRequestId.current;
    if (!draft.organizationId || !draft.monitoredAction1GroupIds.length) {
      setConfigPolicies([]);
      return;
    }
    setConfigPoliciesLoading(true);
    setConfigPoliciesError('');
    apiAction('action1-configuration-manager', 'list-policies')
      .then(data => {
        if (requestId !== configPolicyRequestId.current) return;
        const selectedGroups = new Set(draft.monitoredAction1GroupIds);
        setConfigPolicies((Array.isArray(data.policies) ? data.policies : [])
          .filter(policy => policy.organizationId === draft.organizationId && policy.scopeType === 'ENDPOINT_GROUP' && selectedGroups.has(policy.endpointGroupId))
          .sort((a, b) => (a.displayName || a.baseName || '').localeCompare(b.displayName || b.baseName || '')));
      })
      .catch(error => {
        if (requestId === configPolicyRequestId.current) setConfigPoliciesError(error.message);
      })
      .finally(() => {
        if (requestId === configPolicyRequestId.current) setConfigPoliciesLoading(false);
      });
    return () => { configPolicyRequestId.current++; };
  }, [activeStep, draft.organizationId, draft.monitoredAction1GroupIds, configPolicyRefresh]);

  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(Math.max(0, steps.length - 1));
  }, [stepIndex, steps.length]);

  const action1ConsoleBase = 'https://app.action1.com';
  const configPolicyBaseUrl = '/apps/action1-configuration-manager/policies';

  const selectedIntuneNames = selectedLabels(draft.intuneDeviceGroupIds, draft.intuneDeviceGroupMap, deviceGroups, 'displayName');
  const selectedEndpointGroupNames = selectedLabels(draft.monitoredAction1GroupIds, draft.monitoredAction1GroupMap, endpointGroups, 'name');
  const selectedEndpointGroupNameMap = useMemo(() => {
    const map = { ...draft.monitoredAction1GroupMap };
    for (const group of endpointGroups) map[group.id] = group.name || group.id;
    return map;
  }, [draft.monitoredAction1GroupMap, endpointGroups]);
  const loadingEndpointGroupDetails = loading === 'endpoint-group-details';
  const usedEndpointGroups = useMemo(() => Object.fromEntries(
    policies
      .filter(policy => policy.policyId !== initialPolicy?.policyId)
      .flatMap(policy => (policy.monitoredAction1GroupIds || []).map(id => [id, policy.name]))
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
    if (organizationId !== draft.organizationId) {
      endpointGroupRequestId.current++;
      setEndpointGroups([]);
      setEndpointGroupError('');
    }
    setDraft(current => ({
      ...current,
      organizationId,
      organizationName: organization?.name || '',
      agentId: organization?.agentId || '',
      agentIds: organization?.agentIds || {},
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
    const availableIds = ids.filter(id => !usedEndpointGroups[id]);
    const map = {};
    for (const group of endpointGroups) if (availableIds.includes(group.id)) map[group.id] = group.name || group.id;
    setDraft(current => ({ ...current, monitoredAction1GroupIds: availableIds, monitoredAction1GroupMap: { ...current.monitoredAction1GroupMap, ...map } }));
  }

  async function createEndpointGroup(event) {
    event.preventDefault();
    const name = endpointGroupName.trim();
    if (!name || !draft.organizationId) return;

    const groupWindow = window.open('about:blank', '_blank');
    setCreatingEndpointGroup(true);
    setEndpointGroupError('');
    try {
      const result = await apiAction(integration, 'create-action1-endpoint-group', {
        organizationId: draft.organizationId,
        name
      });
      endpointGroupRequestId.current++;
      setEndpointGroups(current => [...current.filter(group => group.id !== result.group.id), result.group].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(current => ({
        ...current,
        monitoredAction1GroupIds: [...new Set([...current.monitoredAction1GroupIds, result.group.id])],
        monitoredAction1GroupMap: { ...current.monitoredAction1GroupMap, [result.group.id]: result.group.name }
      }));
      setEndpointGroupDialogOpen(false);
      setEndpointGroupName('');
      setLoading(current => current === 'endpoint-groups' ? '' : current);
      if (groupWindow) groupWindow.location.replace(result.groupUrl);
    } catch (error) {
      groupWindow?.close();
      setEndpointGroupError(error.message);
    } finally {
      setCreatingEndpointGroup(false);
    }
  }

  async function deleteEndpointGroup(group) {
    const wasSaved = initialPolicy?.organizationId === draft.organizationId && initialPolicy.monitoredAction1GroupIds?.includes(group.id);
    if (wasSaved && draft.monitoredAction1GroupIds.includes(group.id)) {
      setEndpointGroupError(`Deselect "${group.name}" before deleting it from this profile.`);
      return;
    }
    const profileChange = wasSaved ? ' This will also save the profile\'s selected provisioning groups now.' : '';
    if (!window.confirm(`Delete "${group.name}" from Action1? This cannot be undone and may affect automations or policies targeting this group.${profileChange}`)) return;
    setDeletingEndpointGroupId(group.id);
    setEndpointGroupError('');
    try {
      await apiAction(integration, 'delete-action1-endpoint-group', {
        organizationId: draft.organizationId,
        groupId: group.id,
        profileId: initialPolicy?.policyId,
        selectedGroupIds: draft.monitoredAction1GroupIds.filter(id => id !== group.id),
        selectedGroupMap: draft.monitoredAction1GroupMap
      });
      endpointGroupRequestId.current++;
      setEndpointGroups(current => current.filter(item => item.id !== group.id));
      setLoading(current => current === 'endpoint-groups' ? '' : current);
      setDraft(current => {
        const groupMap = { ...current.monitoredAction1GroupMap };
        delete groupMap[group.id];
        return {
          ...current,
          monitoredAction1GroupIds: current.monitoredAction1GroupIds.filter(id => id !== group.id),
          monitoredAction1GroupMap: groupMap
        };
      });
    } catch (error) {
      setEndpointGroupError(error.message);
    } finally {
      setDeletingEndpointGroupId('');
    }
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
    if (stepId === 'organization' && (!draft.name || !draft.organizationId)) return 'Choose an Action1 organization.';
    if (stepId === 'intune' && !(draft.platforms || []).length) return 'Select at least one device platform.';
    if (stepId === 'intune' && draft.platforms.includes('windows') && !draft.agentId) return 'The Action1 Windows MSI installer is unavailable for this organization.';
    if (stepId === 'intune' && draft.platforms.includes('macos') && !draft.agentIds?.macos) return 'The Action1 macOS PKG installer is unavailable for this organization.';
    if (stepId === 'intune' && draft.platforms.includes('linux') && (!draft.agentIds?.deb || !draft.agentIds?.rpm)) return 'The Action1 Linux installers are unavailable for this organization.';
    if (stepId === 'intune' && draft.assignmentMode === 'selectedGroups' && draft.intuneDeviceGroupIds.length === 0) return 'Select at least one Intune device group, or choose all devices.';
    if (stepId === 'intune' && draft.intuneDeviceGroupIds.some(id => usedIntuneDeviceGroupIds.has(id))) return 'One or more selected Intune device groups are already assigned to another profile.';
    if (stepId === 'action1' && draft.monitoredAction1GroupIds.some(id => usedEndpointGroups[id])) return 'One or more selected Action1 endpoint groups are already assigned to another profile.';
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

  function selectStep(index) {
    setMessage('');
    setStepIndex(index);
  }

  async function save() {
    const invalidStep = steps.find(step => validateStep(step.id));
    if (invalidStep) {
      setStepIndex(steps.indexOf(invalidStep));
      setMessage(validateStep(invalidStep.id));
      return;
    }
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

  function openAutomationDialog(type) {
    setMessage('');
    setAutomationError('');
    setAutomationName('');
    setAutomationPlatform((draft.platforms || ['windows'])[0] || 'windows');
    setAutomationDialog(type);
  }

  function closeAutomationDialog() {
    if (creatingAutomation) return;
    setAutomationDialog(null);
    setAutomationName('');
    setAutomationError('');
  }

  async function createAutomation(event) {
    event?.preventDefault();
    const name = automationName.trim();
    if (!name) return;

    const editWindow = window.open('about:blank', '_blank');
    setCreatingAutomation(true);
    setAutomationError('');
    try {
      const result = await apiAction(integration, 'create-action1-automation', {
        organizationId: draft.organizationId,
        endpointGroupIds: draft.monitoredAction1GroupIds,
        automationType: automationDialog.id,
        platform: automationPlatform,
        name
      });
      setAutomationDialog(null);
      setAutomationName('');
      automationRequestId.current++;
      setAutomations(current => [...current.filter(item => item.id !== result.automationId), {
        id: result.automationId,
        name,
        typeLabel: automationDialog.label,
        enabled: false,
        configurationReady: false,
        endpointGroupIds: draft.monitoredAction1GroupIds,
        editUrl: result.editUrl
      }].sort((a, b) => a.name.localeCompare(b.name)));
      setAutomationsLoading(false);
      setAutomationsError('');
      if (editWindow) {
        try {
          editWindow.location.replace(result.editUrl);
        } catch {
          editWindow.close();
        }
      }
    } catch (error) {
      editWindow?.close();
      setAutomationError(error.message);
    } finally {
      setCreatingAutomation(false);
    }
  }

  async function deleteAutomation(automation) {
    if (!window.confirm(`Delete "${automation.name}" from Action1? This cannot be undone.`)) return;
    setDeletingAutomationId(automation.id);
    setAutomationsError('');
    try {
      await apiAction(integration, 'delete-provisioning-automation', {
        organizationId: draft.organizationId,
        endpointGroupIds: draft.monitoredAction1GroupIds,
        automationId: automation.id
      });
      setAutomations(current => current.filter(item => item.id !== automation.id));
    } catch (error) {
      setAutomationsError(error.message);
    } finally {
      setDeletingAutomationId('');
    }
  }

  async function enableAutomationHourly(automation) {
    if (!window.confirm(`Enable "${automation.name}" to run every hour starting now on its Action1 provisioning groups? Only continue after finishing its configuration in Action1.`)) return;
    setEnablingAutomationId(automation.id);
    setAutomationsError('');
    try {
      await apiAction(integration, 'enable-hourly-provisioning-automation', {
        organizationId: draft.organizationId,
        endpointGroupIds: draft.monitoredAction1GroupIds,
        automationId: automation.id
      });
      setAutomations(current => current.map(item => item.id === automation.id ? { ...item, enabled: true } : item));
    } catch (error) {
      setAutomationsError(error.message);
    } finally {
      setEnablingAutomationId('');
    }
  }

  function refreshAutomations() {
    setAutomationRefresh(value => value + 1);
  }

  function createConfigPolicy(event) {
    event.preventDefault();
    const name = configPolicyName.trim();
    if (!name) return;
    const params = new URLSearchParams({ mode: 'create', policyName: name });
    window.open(`${configPolicyBaseUrl}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    setConfigPolicyDialogOpen(false);
    setConfigPolicyName('');
  }

  async function deleteConfigPolicy(policy) {
    const name = policy.displayName || policy.baseName || policy.policyId;
    if (!window.confirm(`Delete "${name}" from Configuration Management? This also removes its automations and cannot be undone.`)) return;
    setDeletingConfigPolicyId(policy.policyId);
    setConfigPoliciesError('');
    try {
      const result = await apiAction('action1-configuration-manager', 'delete-policy', { policyId: policy.policyId });
      if (result.deleted !== true) throw new Error(result.message || 'Configuration Management did not delete the policy.');
      setConfigPolicies(current => current.filter(item => item.policyId !== policy.policyId));
    } catch (error) {
      setConfigPoliciesError(error.message);
    } finally {
      setDeletingConfigPolicyId('');
    }
  }

  function refreshConfigPolicies() {
    setConfigPolicyRefresh(value => value + 1);
  }

  return (
    <div className="card">
      <h2 className="card-title">{initialPolicy ? 'Edit Enrollment and Provisioning Profile' : 'Enrollment and Provisioning Profile'}</h2>
      <p className="card-sub">
        Configure which Intune devices are enrolled in Action1 and which Action1 provisioning groups are configured for provisioning.
      </p>
      <Stepper steps={steps} stepIndex={stepIndex} onStepSelect={selectStep} allowForwardNavigation={Boolean(initialPolicy)} />
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
              {organizations.map(organization => <option key={organization.id} value={organization.id}>{formatDisplayName(organization.name)}</option>)}
            </select>
          </div>
          <Help>You can create multiple profiles for an Action1 organization. Each Action1 endpoint group can belong to only one profile.</Help>
        </section>
      )}

      {activeStep === 'intune' && (
        <section className="section">
          <h3 className="section-title">Choose the Devices to Enroll</h3>
          <Help>Select the device platforms and Intune targets to enroll into Action1.</Help>
          <div className="field">
            <label>Device Platforms <span className="req">*</span></label>
            <div className="radio-row">
              {[
                { id: 'windows', label: 'Windows' },
                { id: 'macos', label: 'macOS' },
                { id: 'linux', label: 'Linux' }
              ].map(platform => (
                <label key={platform.id} className="radio-item">
                  <input type="checkbox" checked={(draft.platforms || ['windows']).includes(platform.id)} onChange={event => setDraft(current => ({
                    ...current,
                    platforms: event.target.checked
                      ? [...new Set([...(current.platforms || ['windows']), platform.id])]
                      : (current.platforms || ['windows']).filter(id => id !== platform.id)
                  }))} /> {platform.label}
                </label>
              ))}
            </div>
          </div>
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
          <h3 className="section-title">Action1 Provisioning Groups</h3>
          <Help>Create a provisioning group or select an existing group for this profile. Configure group membership in Action1 before using it to target automations.</Help>
          <div className="automation-buttons">
            <button type="button" className="btn btn-primary" disabled={!draft.organizationId} onClick={() => { setEndpointGroupError(''); setEndpointGroupName(''); setEndpointGroupDialogOpen(true); }}>Create Endpoint Group</button>
          </div>
          <div className="automation-list-heading">
            <h4>Endpoint Groups</h4>
            <button type="button" className="btn btn-secondary automation-refresh" title="Refresh endpoint groups" onClick={() => { setEndpointGroupError(''); loadEndpointGroups(draft.organizationId); }} disabled={!draft.organizationId || loading === 'endpoint-groups'}><RefreshCw size={16} /> {loading === 'endpoint-groups' ? 'Refreshing...' : 'Refresh'}</button>
          </div>
          {endpointGroupError && !endpointGroupDialogOpen && <div className="validation-notice" role="alert">{endpointGroupError}</div>}
          <EndpointGroupTable
            rows={endpointGroups}
            selectedIds={draft.monitoredAction1GroupIds}
            usedByProfile={usedEndpointGroups}
            onChange={updateEndpointGroups}
            onDelete={deleteEndpointGroup}
            deletingId={deletingEndpointGroupId}
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
          <div className="automation-buttons">
            {ACTION1_AUTOMATION_TYPES.filter(type => type.id !== 'deploy-software' || (draft.platforms || ['windows']).some(platform => platform !== 'linux')).map(type => (
              <button key={type.id} type="button" className="btn btn-primary" onClick={() => openAutomationDialog(type)}>
                {type.label}
              </button>
            ))}
          </div>

          <div className="automation-list-heading">
            <h4>Created Automations</h4>
            <button type="button" className="btn btn-secondary automation-refresh" title="Refresh automations" disabled={automationsLoading} onClick={refreshAutomations}><RefreshCw size={16} /> Refresh</button>
          </div>
          {automationsError && <div className="validation-notice" role="alert">{automationsError}</div>}
          {automationsLoading ? <p className="section-sub">Loading automations...</p> : automations.length ? (
            <div className="automation-table-wrap"><table className="automation-list">
              <thead><tr><th>Name</th><th>Type</th><th>Status</th><th className="automation-actions">Actions</th></tr></thead>
              <tbody>{automations.map(automation => (
                <tr key={automation.id}>
                  <td>{automation.name}</td>
                  <td>{automation.typeLabel}</td>
                  <td>{automation.enabled ? 'Enabled' : automation.configurationReady ? 'Ready to enable' : 'Needs configuration'}</td>
                  <td className="automation-actions">
                    <a className="btn btn-secondary link-button" href={automation.editUrl} target="_blank" rel="noopener noreferrer" title={`Edit ${automation.name} in Action1`}><Pencil size={14} /> Edit</a>
                    {!automation.enabled && <button type="button" className="btn btn-secondary" title={automation.configurationReady ? `Enable ${automation.name} to run every hour from now` : 'Save an action configuration in Action1, then refresh automations'} disabled={!automation.configurationReady || !!enablingAutomationId || !!deletingAutomationId} onClick={() => enableAutomationHourly(automation)}><Play size={14} /> {enablingAutomationId === automation.id ? 'Enabling...' : 'Enable'}</button>}
                    <button type="button" className="btn btn-secondary btn-danger" title={`Delete ${automation.name}`} disabled={!!deletingAutomationId || !!enablingAutomationId} onClick={() => deleteAutomation(automation)}><Trash2 size={14} /> {deletingAutomationId === automation.id ? 'Deleting...' : 'Delete'}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="section-sub">No automations found for the selected provisioning groups.</p>}

          <h4 style={{ margin: '12px 0 4px', fontSize: 13 }}>Configuration Management Policies</h4>
          <p className="section-sub">Create Configuration Management policies that contain the required controls and target the policies to the Action1 provisioning groups selected in the previous step.</p>
          <button type="button" className="btn btn-primary" onClick={() => { setConfigPolicyName(''); setConfigPolicyDialogOpen(true); }}>Create Policy</button>
          <div className="automation-list-heading">
            <h4>Created Policies</h4>
            <button type="button" className="btn btn-secondary automation-refresh" title="Refresh policies" disabled={configPoliciesLoading} onClick={refreshConfigPolicies}><RefreshCw size={16} /> Refresh</button>
          </div>
          {configPoliciesError && <div className="validation-notice" role="alert">{configPoliciesError}</div>}
          {configPoliciesLoading ? <p className="section-sub">Loading policies...</p> : configPolicies.length ? (
            <div className="automation-table-wrap"><table className="automation-list">
              <thead><tr><th>Name</th><th>Provisioning Group</th><th>Status</th><th className="automation-actions">Actions</th></tr></thead>
              <tbody>{configPolicies.map(policy => (
                <tr key={policy.policyId}>
                  <td>{policy.displayName || policy.baseName || policy.policyId}</td>
                  <td>{policy.endpointGroupNameSnapshot || selectedEndpointGroupNameMap[policy.endpointGroupId] || policy.endpointGroupId}</td>
                  <td>{policy.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="automation-actions">
                    <a className="btn btn-secondary link-button" href={`${configPolicyBaseUrl}?${new URLSearchParams({ policyId: policy.policyId, mode: 'edit' })}`} target="_blank" rel="noopener noreferrer" title={`Edit ${policy.displayName || policy.baseName || policy.policyId}`}><Pencil size={14} /> Edit</a>
                    <button type="button" className="btn btn-secondary btn-danger" title={`Delete ${policy.displayName || policy.baseName || policy.policyId}`} disabled={!!deletingConfigPolicyId} onClick={() => deleteConfigPolicy(policy)}><Trash2 size={14} /> {deletingConfigPolicyId === policy.policyId ? 'Deleting...' : 'Delete'}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="section-sub">No Configuration Management policies found for the selected provisioning groups.</p>}
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
            <div className="s-label">Device Platforms</div><div>{(draft.platforms || ['windows']).map(platform => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[platform] || platform).join(', ') || 'None selected'}</div>
            <div className="s-label">Intune Enrollment Group</div><div>{draft.assignmentMode === 'allDevices' ? 'All Devices' : selectedIntuneNames.join(', ') || 'No groups selected'}</div>
            {!isEnrollmentOnly && <><div className="s-label">Action1 Provisioning Groups</div><div>{selectedEndpointGroupNames.join(', ') || 'No groups selected'}</div></>}
            {!isEnrollmentOnly && <><div className="s-label">Provisioning Automations</div><div><ReviewProvisioningAutomations selectedIds={draft.monitoredAction1GroupIds} selectedNames={selectedEndpointGroupNameMap} detailsByGroupId={endpointGroupDetails} action1ConsoleBase={action1ConsoleBase} organizationId={draft.organizationId} loading={loadingEndpointGroupDetails} /></div></>}
            {!isEnrollmentOnly && <><div className="s-label">Configuration Management Policies</div><div><ReviewConfigurationPolicies selectedIds={draft.monitoredAction1GroupIds} selectedNames={selectedEndpointGroupNameMap} detailsByGroupId={endpointGroupDetails} loading={loadingEndpointGroupDetails} /></div></>}
          </div>
        </section>
      )}

      {automationDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && closeAutomationDialog()}>
          <form className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-dialog-title" onSubmit={createAutomation}>
            <h3 id="automation-dialog-title" className="modal-title">Create {automationDialog.label} Automation</h3>
            <p className="modal-sub">The new automation will target the selected provisioning groups and remain disabled. Save its action configuration in Action1, then refresh this list and click Enable to start hourly runs.</p>
            <div className="field">
              <label htmlFor="automation-name">Automation Name <span className="req">*</span></label>
              <input id="automation-name" type="text" autoFocus maxLength={255} value={automationName} onChange={event => setAutomationName(event.target.value)} disabled={creatingAutomation} />
            </div>
            {automationDialog.id === 'run-script' && <div className="field">
              <label htmlFor="automation-platform">Platform</label>
              <select id="automation-platform" value={automationPlatform} onChange={event => setAutomationPlatform(event.target.value)} disabled={creatingAutomation}>
                {(draft.platforms || ['windows']).map(platform => <option key={platform} value={platform}>{({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[platform]}</option>)}
              </select>
            </div>}
            {automationError && <div className="validation-notice" role="alert">{automationError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeAutomationDialog} disabled={creatingAutomation}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creatingAutomation || !automationName.trim()}>{creatingAutomation ? 'Creating...' : 'OK'}</button>
            </div>
          </form>
        </div>
      )}

      {endpointGroupDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !creatingEndpointGroup && setEndpointGroupDialogOpen(false)}>
          <form className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="endpoint-group-dialog-title" onSubmit={createEndpointGroup}>
            <h3 id="endpoint-group-dialog-title" className="modal-title">Create Endpoint Group</h3>
            <p className="modal-sub">The new group will be selected for this profile. Configure its membership in Action1.</p>
            <div className="field">
              <label htmlFor="endpoint-group-name">Group Name <span className="req">*</span></label>
              <input id="endpoint-group-name" type="text" autoFocus maxLength={255} value={endpointGroupName} onChange={event => setEndpointGroupName(event.target.value)} disabled={creatingEndpointGroup} />
            </div>
            {endpointGroupError && <div className="validation-notice" role="alert">{endpointGroupError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" disabled={creatingEndpointGroup} onClick={() => setEndpointGroupDialogOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!endpointGroupName.trim() || creatingEndpointGroup}>{creatingEndpointGroup ? 'Creating...' : 'OK'}</button>
            </div>
          </form>
        </div>
      )}

      {configPolicyDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setConfigPolicyDialogOpen(false)}>
          <form className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="config-policy-dialog-title" onSubmit={createConfigPolicy}>
            <h3 id="config-policy-dialog-title" className="modal-title">Create Configuration Management Policy</h3>
            <p className="modal-sub">The policy wizard will open in a new tab. Select one of this profile's provisioning groups when choosing its target.</p>
            <div className="field">
              <label htmlFor="config-policy-name">Policy Name <span className="req">*</span></label>
              <input id="config-policy-name" type="text" autoFocus maxLength={255} value={configPolicyName} onChange={event => setConfigPolicyName(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfigPolicyDialogOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!configPolicyName.trim()}>OK</button>
            </div>
          </form>
        </div>
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
          onCancel={() => { setMode('list'); refreshPolicies(); }}
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
