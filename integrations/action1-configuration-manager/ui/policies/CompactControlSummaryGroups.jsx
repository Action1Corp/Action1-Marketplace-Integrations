import { policyUiTokens } from './policyUiStyles.js';

const styles = {
  groups: {
    display: 'grid',
    gap: '0.75rem'
  },
  group: {
    display: 'grid',
    gap: '0.4rem'
  },
  headingRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  headingMeta: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  familyName: {
    margin: 0,
    fontSize: '13px',
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  },
  count: {
    fontSize: '12px',
    color: policyUiTokens.textMuted
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '6px',
    fontSize: '12px',
    color: policyUiTokens.textSecondary,
    background: policyUiTokens.mutedBackground,
    border: `1px solid ${policyUiTokens.borderColor}`,
    borderRadius: 4,
    padding: '2px 8px',
    margin: 0
  },
  chipValue: {
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace',
    fontWeight: 600,
    color: policyUiTokens.textPrimary
  }
};

function CompactControlSummaryGroups({ groups, renderFamilyAction = null }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }

  return (
    <div style={styles.groups}>
      {groups.map((group) => (
        <div key={group.familyId || group.automationGroupId || group.familyName} style={styles.group}>
          <div style={styles.headingRow}>
            <div style={styles.headingMeta}>
              <p style={styles.familyName}>{group.familyName}</p>
              {typeof group.selectedCount === 'number' ? <span style={styles.count}>{group.selectedCount} control{group.selectedCount === 1 ? '' : 's'}</span> : null}
            </div>
            {typeof renderFamilyAction === 'function' ? renderFamilyAction(group) : null}
          </div>
          <div style={styles.chips}>
            {group.controls.map((control) =>
              control.chips.length > 0 ? (
                control.chips.map((chip) => (
                  <span key={`${control.controlKey}-${chip.label}`} style={styles.chip}>
                    {control.controlName}
                    <span style={styles.chipValue}>
                      {chip.label}: {chip.value}
                    </span>
                  </span>
                ))
              ) : (
                <span key={control.controlKey} style={styles.chip}>
                  {control.controlName}
                </span>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CompactControlSummaryGroups;
