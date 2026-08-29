import CompactControlSummaryGroups from './CompactControlSummaryGroups.jsx';
import PolicyActionMenu from './PolicyActionMenu.jsx';
import {
  getStatusBadgeStyle,
  modeBadgeStyle,
  pageSurfaceStyle,
  policyUiTokens,
  sectionDividerStyle,
  textLinkButtonStyle
} from './policyUiStyles.js';
import { formatPolicyDetails } from './policyViewModel.js';

const styles = {
  shell: {
    ...pageSurfaceStyle,
    padding: '1rem',
    display: 'grid',
    gap: '0.95rem'
  },
  backLink: {
    ...textLinkButtonStyle
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '0.75rem'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flex: 'none'
  },
  headerAction: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: policyUiTokens.fontSizes.label,
    fontWeight: 600,
    color: policyUiTokens.accent,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  titleBlock: {
    display: 'grid',
    gap: '0.25rem'
  },
  title: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.title,
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  subtitle: {
    margin: 0,
    color: policyUiTokens.textSecondary,
    fontSize: policyUiTokens.fontSizes.label,
    lineHeight: 1.45
  },
  sectionDivider: {
    ...sectionDividerStyle
  },
  section: {
    display: 'grid',
    gap: '0.7rem'
  },
  sectionTitle: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.section,
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  keyValueGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
  },
  keyValueRow: {
    display: 'grid',
    gap: '0.18rem'
  },
  label: {
    margin: 0,
    color: policyUiTokens.textMuted,
    fontSize: policyUiTokens.fontSizes.hint,
    fontWeight: 400
  },
  value: {
    margin: 0,
    color: policyUiTokens.textPrimary,
    fontSize: policyUiTokens.fontSizes.body,
    fontWeight: 400,
    lineHeight: 1.4
  },
  emphasizedValue: {
    margin: 0,
    color: policyUiTokens.textPrimary,
    fontSize: policyUiTokens.fontSizes.body,
    fontWeight: 600,
    lineHeight: 1.4
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'currentColor',
    flex: '0 0 auto'
  },
  familyBlock: {
    display: 'grid',
    gap: '0.75rem'
  },
  familyHeadingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  familyName: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.body,
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  link: {
    color: policyUiTokens.accent,
    textDecoration: 'none',
    fontSize: policyUiTokens.fontSizes.hint,
    fontWeight: 500
  },
  emptyText: {
    margin: 0,
    color: policyUiTokens.textSecondary,
    fontSize: policyUiTokens.fontSizes.label
  }
};

const HEADER_ACTION_CSS = `
.policy-detail-header-action:hover { text-decoration: underline; }
.policy-detail-header-action:focus-visible { outline: 2px solid ${policyUiTokens.accent}; outline-offset: 2px; }
`;

function buildActionItems({ onDelete }) {
  return [{ label: 'Delete', destructive: true, onSelect: onDelete }];
}

function PolicyDetailsView({ catalog, policy, onBack, onDelete, onDisable, onEdit, onEnable, busy = false }) {
  const details = formatPolicyDetails(policy, catalog);
  const actionItems = buildActionItems({ onDelete });
  const lifecycleAction = policy.enabled === false ? 'Enable' : 'Disable';

  return (
    <section style={styles.shell}>
      <style>{HEADER_ACTION_CSS}</style>
      <button type="button" style={styles.backLink} disabled={busy} onClick={onBack}>
        Back to Policies
      </button>

      <div style={styles.titleRow}>
        <div style={styles.titleBlock}>
          <h2 style={styles.title}>Policy Details</h2>
          <p style={styles.subtitle}>Inspect the saved Policy, its current schedule, and its Action1 automations.</p>
        </div>
        <div style={styles.headerActions}>
          <button type="button" className="policy-detail-header-action" style={styles.headerAction} aria-label="Edit Policy" disabled={busy} onClick={onEdit}>Edit</button>
          <button type="button" className="policy-detail-header-action" style={styles.headerAction} aria-label={`${lifecycleAction} Policy`} disabled={busy} onClick={policy.enabled === false ? onEnable : onDisable}>{lifecycleAction}</button>
          <PolicyActionMenu items={actionItems} label="More actions" disabled={busy} />
        </div>
      </div>

      <hr style={styles.sectionDivider} />

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Overview</h3>
        <div style={styles.keyValueGrid}>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Policy</p>
            <p style={styles.emphasizedValue}>{details.policyName}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Status</p>
            <span style={getStatusBadgeStyle(policy.enabled)}>
              {policy.enabled ? <span style={styles.statusDot} aria-hidden="true" /> : null}
              <span style={styles.statusBadge}>{details.statusLabel}</span>
            </span>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Organization</p>
            <p style={styles.value}>{details.organizationLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Scope</p>
            <p style={styles.value}>{details.scopeLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Policy mode</p>
            <span style={modeBadgeStyle}>{details.policyModeLabel}</span>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Controls</p>
            <p style={styles.value}>{details.controlsCountLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Control Families</p>
            <p style={styles.value}>{details.controlFamiliesCountLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Action1 automations</p>
            <p style={styles.value}>{details.automationsCountLabel}</p>
          </div>
        </div>
      </section>

      <hr style={styles.sectionDivider} />

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Run schedule</h3>
        <div style={styles.keyValueGrid}>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Run schedule</p>
            <p style={styles.value}>{details.scheduleLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Automation completion deadline</p>
            <p style={styles.value}>{details.completionDeadlineLabel}</p>
          </div>
        </div>
      </section>

      <hr style={styles.sectionDivider} />

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Controls and Action1 automations</h3>
        {details.controlFamilyGroups.length === 0 ? (
          <p style={styles.emptyText}>No Controls selected.</p>
        ) : (
          details.controlFamilyGroups.map((group, index) => (
            <div key={group.familyId} style={styles.familyBlock}>
              {index > 0 ? <hr style={styles.sectionDivider} /> : null}
              <CompactControlSummaryGroups
                groups={[group]}
                renderFamilyAction={(familyGroup) =>
                  familyGroup.automationLink?.action1Url ? (
                    <a href={familyGroup.automationLink.action1Url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                        Open automation in Action1
                    </a>
                  ) : null
                }
              />
            </div>
          ))
        )}
      </section>
    </section>
  );
}

export default PolicyDetailsView;
