import { useState } from 'react';
import PolicyActionMenu from './PolicyActionMenu.jsx';
import {
  getStatusBadgeStyle,
  pageSurfaceStyle,
  policyUiTokens,
  primaryButtonStyle,
  scheduleChipStyle
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
  createButton: {
    ...primaryButtonStyle
  },
  table: {
    ...pageSurfaceStyle,
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    overflow: 'hidden'
  },
  headerCell: {
    padding: '0.75rem 0.8rem',
    textAlign: 'left',
    fontSize: policyUiTokens.fontSizes.hint,
    fontWeight: 600,
    color: policyUiTokens.textMuted,
    borderBottom: `1px solid ${policyUiTokens.borderColor}`,
    background: policyUiTokens.surfaceBackground
  },
  cell: {
    padding: '0.7rem 0.8rem',
    textAlign: 'left',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${policyUiTokens.borderColor}`,
    background: policyUiTokens.surfaceBackground
  },
  hoveredCell: {
    background: policyUiTokens.mutedBackground
  },
  lastRowCell: {
    borderBottom: 'none'
  },
  policyName: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.label,
    fontWeight: 600,
    color: policyUiTokens.textPrimary,
    lineHeight: 1.35,
    wordBreak: 'break-word'
  },
  valueText: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.label,
    fontWeight: 400,
    color: policyUiTokens.textPrimary,
    lineHeight: 1.35
  },
  targetScope: {
    margin: '0.14rem 0 0',
    fontSize: policyUiTokens.fontSizes.hint,
    fontWeight: 400,
    color: policyUiTokens.textMuted,
    lineHeight: 1.35
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
  scheduleChip: {
    ...scheduleChipStyle
  },
  actionsCell: {
    width: 56
  },
  emptyState: {
    ...pageSurfaceStyle,
    borderStyle: 'dashed',
    padding: '2.2rem 1.5rem',
    textAlign: 'center',
    display: 'grid',
    gap: '0.4rem',
    justifyItems: 'center'
  },
  emptyHeading: {
    margin: 0,
    fontSize: policyUiTokens.fontSizes.body,
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  emptyText: {
    margin: 0,
    maxWidth: 520,
    color: policyUiTokens.textSecondary,
    fontSize: policyUiTokens.fontSizes.label,
    lineHeight: 1.45
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

function PolicyListView({ policies, onCreate, onDelete, onDisable, onEnable, onOpen, onEdit, busy = false }) {
  const [hoveredPolicyId, setHoveredPolicyId] = useState('');

  return (
    <section style={styles.section}>
      <div style={styles.actionRow}>
        <div />
        <button type="button" style={styles.createButton} disabled={busy} onClick={onCreate}>
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
            {policies.map((policy, index) => {
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
              const isHovered = hoveredPolicyId === policy.policyId;
              const isLastRow = index === policies.length - 1;

              function resolveCellStyle() {
                return {
                  ...styles.cell,
                  ...(isHovered ? styles.hoveredCell : null),
                  ...(isLastRow ? styles.lastRowCell : null)
                };
              }

              return (
                <tr
                  key={policy.policyId}
                  onMouseEnter={() => setHoveredPolicyId(policy.policyId)}
                  onMouseLeave={() => setHoveredPolicyId('')}
                >
                  <td style={resolveCellStyle()}>
                    <p style={styles.policyName}>{row.policyName}</p>
                  </td>
                  <td style={resolveCellStyle()}>
                    <span style={getStatusBadgeStyle(policy.enabled)}>
                      {policy.enabled ? <span style={styles.statusDot} aria-hidden="true" /> : null}
                      <span style={styles.statusBadge}>{row.status}</span>
                    </span>
                  </td>
                  <td style={resolveCellStyle()}>
                    <p style={styles.valueText}>{row.targetPrimary}</p>
                    <p style={styles.targetScope}>{row.targetSecondary}</p>
                  </td>
                  <td style={resolveCellStyle()}>
                    <p style={{ ...styles.valueText, color: policyUiTokens.textSecondary }}>{row.modeLabel}</p>
                  </td>
                  <td style={resolveCellStyle()}>
                    <span style={styles.scheduleChip}>{row.scheduleLabel.toLowerCase()}</span>
                  </td>
                  <td style={{ ...resolveCellStyle(), ...styles.actionsCell }}>
                    <PolicyActionMenu items={actionItems} label="Policy actions" disabled={busy} />
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
