import PolicyActionMenu from './PolicyActionMenu.jsx';
import { textLinkButtonStyle } from './policyUiStyles.js';
import { formatPolicyDetails } from './policyViewModel.js';

const styles = {
  shell: {
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 14,
    background: '#ffffff',
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
  titleBlock: {
    display: 'grid',
    gap: '0.25rem'
  },
  title: {
    margin: 0,
    fontSize: '1.12rem',
    color: '#16314a'
  },
  subtitle: {
    margin: 0,
    color: '#5a6f84',
    lineHeight: 1.45
  },
  sectionDivider: {
    border: 'none',
    borderTop: '1px solid #e3eaf2',
    margin: 0
  },
  section: {
    display: 'grid',
    gap: '0.7rem'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.97rem',
    fontWeight: 600,
    color: '#16314a'
  },
  keyValueGrid: {
    display: 'grid',
    gap: '0.7rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
  },
  keyValueRow: {
    display: 'grid',
    gap: '0.18rem'
  },
  label: {
    margin: 0,
    color: '#5a6f84',
    fontSize: '0.82rem'
  },
  value: {
    margin: 0,
    color: '#1f3448',
    fontSize: '0.94rem',
    fontWeight: 500,
    lineHeight: 1.4
  },
  subduedValue: {
    margin: 0,
    color: '#1f3448',
    fontSize: '0.94rem',
    fontWeight: 400,
    lineHeight: 1.4
  },
  statusValue: {
    margin: 0,
    color: '#16314a',
    fontSize: '0.94rem',
    fontWeight: 500,
    lineHeight: 1.4
  },
  familyBlock: {
    display: 'grid',
    gap: '0.6rem',
    paddingTop: '0.1rem'
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
    fontSize: '0.96rem',
    fontWeight: 600,
    color: '#16314a'
  },
  link: {
    color: '#2563eb',
    textDecoration: 'none',
    fontSize: '0.9rem',
    fontWeight: 500
  },
  controlsList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: '0.55rem'
  },
  controlItem: {
    display: 'grid',
    gap: '0.18rem'
  },
  controlName: {
    margin: 0,
    fontSize: '0.94rem',
    fontWeight: 600,
    color: '#20364b'
  },
  controlDescription: {
    margin: 0,
    color: '#5a6f84',
    fontSize: '0.88rem',
    lineHeight: 1.4
  },
  parameterList: {
    listStyle: 'none',
    margin: '0.1rem 0 0',
    padding: 0,
    display: 'grid',
    gap: '0.16rem'
  },
  parameterRow: {
    color: '#2f455a',
    fontSize: '0.89rem',
    lineHeight: 1.35
  },
  emptyText: {
    margin: 0,
    color: '#5a6f84'
  }
};

function buildActionItems({ policy, onDelete, onDisable, onEdit, onEnable }) {
  return [
    { label: 'Edit', onSelect: onEdit },
    {
      label: policy.enabled === false ? 'Enable' : 'Disable',
      onSelect: policy.enabled === false ? onEnable : onDisable
    },
    { label: 'Delete', destructive: true, onSelect: onDelete }
  ];
}

function PolicyDetailsView({ catalog, policy, onBack, onDelete, onDisable, onEdit, onEnable }) {
  const details = formatPolicyDetails(policy, catalog);
  const actionItems = buildActionItems({ policy, onDelete, onDisable, onEdit, onEnable });

  return (
    <section style={styles.shell}>
      <button type="button" style={styles.backLink} onClick={onBack}>
        Back to Policies
      </button>

      <div style={styles.titleRow}>
        <div style={styles.titleBlock}>
          <h2 style={styles.title}>Policy Details</h2>
          <p style={styles.subtitle}>Inspect the saved Policy, its current schedule, and the deterministic demo Action1 automation records.</p>
        </div>
        <PolicyActionMenu items={actionItems} label="Policy actions" />
      </div>

      <hr style={styles.sectionDivider} />

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Overview</h3>
        <div style={styles.keyValueGrid}>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Policy</p>
            <p style={styles.value}>{details.policyName}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Status</p>
            <p style={styles.statusValue}>{details.statusLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Organization</p>
            <p style={styles.subduedValue}>{details.organizationLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Scope</p>
            <p style={styles.subduedValue}>{details.scopeLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Policy mode</p>
            <p style={styles.subduedValue}>{details.policyModeLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Controls</p>
            <p style={styles.subduedValue}>{details.controlsCountLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Control Families</p>
            <p style={styles.subduedValue}>{details.controlFamiliesCountLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Action1 automations</p>
            <p style={styles.subduedValue}>{details.automationsCountLabel}</p>
          </div>
        </div>
      </section>

      <hr style={styles.sectionDivider} />

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Run schedule</h3>
        <div style={styles.keyValueGrid}>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Run schedule</p>
            <p style={styles.subduedValue}>{details.scheduleLabel}</p>
          </div>
          <div style={styles.keyValueRow}>
            <p style={styles.label}>Automation completion deadline</p>
            <p style={styles.subduedValue}>{details.completionDeadlineLabel}</p>
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
              <div style={styles.familyHeadingRow}>
                <p style={styles.familyName}>{group.familyName}</p>
                {group.automationLink ? (
                  <a href={group.automationLink.action1Url} style={styles.link}>
                    Open automation in Action1
                  </a>
                ) : null}
              </div>
              <ul style={styles.controlsList}>
                {group.controls.map((control) => (
                  <li key={`${group.familyId}-${control.controlName}`} style={styles.controlItem}>
                    <p style={styles.controlName}>{control.controlName}</p>
                    <p style={styles.controlDescription}>{control.controlDescription}</p>
                    {control.parameters.length > 0 ? (
                      <ul style={styles.parameterList}>
                        {control.parameters.map((parameter) => (
                          <li key={`${control.controlName}-${parameter.label}`} style={styles.parameterRow}>
                            {parameter.label}: {parameter.value}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

export default PolicyDetailsView;
