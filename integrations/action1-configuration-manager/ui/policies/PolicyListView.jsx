import PolicyActionMenu from './PolicyActionMenu.jsx';
import {
  primaryButtonStyle
} from './policyUiStyles.js';
import { formatPolicyListRow, getPolicyRowActions } from './policyViewModel.js';

const styles = {
  section: {
    display: 'grid',
    gap: '0.75rem'
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    background: '#ffffff',
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 14
  },
  headerCell: {
    padding: '0.72rem 0.8rem',
    textAlign: 'left',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: '#5a6f84',
    borderBottom: '1px solid var(--border-color, #d7dee8)',
    background: '#f8fbff'
  },
  cell: {
    padding: '0.8rem',
    textAlign: 'left',
    verticalAlign: 'top',
    borderTop: '1px solid var(--border-color, #e5ebf3)'
  },
  policyName: {
    margin: 0,
    fontSize: '0.96rem',
    fontWeight: 600,
    color: '#16314a',
    lineHeight: 1.35,
    wordBreak: 'break-word'
  },
  valueText: {
    margin: 0,
    fontSize: '0.94rem',
    fontWeight: 400,
    color: '#23384c',
    lineHeight: 1.35
  },
  valueTextMuted: {
    margin: '0.16rem 0 0',
    fontSize: '0.89rem',
    fontWeight: 400,
    color: '#5a6f84',
    lineHeight: 1.35
  },
  statusText: {
    margin: 0,
    fontSize: '0.94rem',
    fontWeight: 500,
    color: '#16314a',
    lineHeight: 1.35
  },
  createButton: {
    ...primaryButtonStyle
  },
  emptyState: {
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 14,
    padding: '1rem',
    background: '#ffffff',
    display: 'grid',
    gap: '0.35rem'
  },
  emptyHeading: {
    margin: 0,
    fontSize: '1rem'
  },
  emptyText: {
    margin: 0,
    color: '#4a627d'
  },
  actionsCell: {
    width: 56
  }
};

function buildActionItems({ actions, policyId, onDelete, onDisable, onEnable, onOpen, onEdit }) {
  const items = [];

  if (actions.includes('openDetails')) {
    items.push({ label: 'Open details', onSelect: () => onOpen(policyId) });
  }
  if (actions.includes('edit')) {
    items.push({ label: 'Edit', onSelect: () => onEdit(policyId) });
  }
  if (actions.includes('enable')) {
    items.push({ label: 'Enable', onSelect: () => onEnable(policyId) });
  }
  if (actions.includes('disable')) {
    items.push({ label: 'Disable', onSelect: () => onDisable(policyId) });
  }
  if (actions.includes('delete')) {
    items.push({ label: 'Delete', destructive: true, onSelect: () => onDelete(policyId) });
  }

  return items;
}

function PolicyListView({ policies, onCreate, onDelete, onDisable, onEnable, onOpen, onEdit }) {
  return (
    <section style={styles.section}>
      <div style={styles.actionRow}>
        <div />
        <button type="button" style={styles.createButton} onClick={onCreate}>
          Create Policy
        </button>
      </div>
      {policies.length === 0 ? (
        <div style={styles.emptyState}>
          <h2 style={styles.emptyHeading}>No policies</h2>
          <p style={styles.emptyText}>Create a Policy to start configuring Windows endpoint controls through scheduled Action1 automations.</p>
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Policy</th>
              <th style={styles.headerCell}>Status</th>
              <th style={styles.headerCell}>Target</th>
              <th style={styles.headerCell}>Mode</th>
              <th style={styles.headerCell}>Schedule</th>
              <th style={styles.headerCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => {
              const row = formatPolicyListRow(policy);
              const actionItems = buildActionItems({
                actions: getPolicyRowActions(policy),
                policyId: policy.policyId,
                onDelete,
                onDisable,
                onEnable,
                onOpen,
                onEdit
              });

              return (
                <tr key={policy.policyId}>
                  <td style={styles.cell}>
                    <p style={styles.policyName}>{row.policyName}</p>
                  </td>
                  <td style={styles.cell}>
                    <p style={styles.statusText}>{row.status}</p>
                  </td>
                  <td style={styles.cell}>
                    <p style={styles.valueText}>{row.targetPrimary}</p>
                    <p style={styles.valueTextMuted}>{row.targetSecondary}</p>
                  </td>
                  <td style={styles.cell}>
                    <p style={styles.valueText}>{row.modeLabel}</p>
                  </td>
                  <td style={styles.cell}>
                    <p style={styles.valueText}>{row.scheduleLabel}</p>
                  </td>
                  <td style={{ ...styles.cell, ...styles.actionsCell }}>
                    <PolicyActionMenu items={actionItems} label="Policy actions" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default PolicyListView;
