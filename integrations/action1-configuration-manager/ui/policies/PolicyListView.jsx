const styles = {
  card: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
    borderRadius: 14,
    padding: '1rem',
    background: 'var(--panel-background, rgba(15,23,42,0.36))',
    display: 'grid',
    gap: '0.85rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem'
  },
  title: {
    margin: 0,
    fontSize: '1.125rem'
  },
  description: {
    margin: 0,
    color: 'var(--text-secondary)'
  },
  actionButton: {
    border: 'none',
    borderRadius: 10,
    padding: '0.65rem 0.95rem',
    background: 'var(--brand-color, #3b82f6)',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 600
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  cell: {
    padding: '0.65rem 0.5rem',
    borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
    verticalAlign: 'top',
    textAlign: 'left'
  },
  empty: {
    margin: 0,
    color: 'var(--text-secondary)'
  },
  rowActions: {
    display: 'flex',
    gap: '0.5rem'
  },
  inlineButton: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.18))',
    borderRadius: 999,
    padding: '0.35rem 0.75rem',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer'
  }
};

function formatScope(policy) {
  return policy.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : policy.endpointGroupNameSnapshot;
}

function formatRunSchedule(policy) {
  return `Every ${policy.runSchedule.runEveryHours} hours`;
}

function PolicyListView({ policies, onCreate, onOpen, onEdit }) {
  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Open Policies</h2>
          <p style={styles.description}>Manage demo Policies for the Tuesday Marketplace walkthrough.</p>
        </div>
        <button type="button" style={styles.actionButton} onClick={onCreate}>
          Create Policy
        </button>
      </div>
      {policies.length === 0 ? (
        <p style={styles.empty}>No Policies have been created in this browser session yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.cell}>Policy</th>
                <th style={styles.cell}>Organization</th>
                <th style={styles.cell}>Scope</th>
                <th style={styles.cell}>Mode</th>
                <th style={styles.cell}>Run schedule</th>
                <th style={styles.cell}>Controls</th>
                <th style={styles.cell}>Automations</th>
                <th style={styles.cell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.policyId}>
                  <td style={styles.cell}>{policy.displayName}</td>
                  <td style={styles.cell}>{policy.organizationNameSnapshot}</td>
                  <td style={styles.cell}>{formatScope(policy)}</td>
                  <td style={styles.cell}>{policy.policyMode === 'ASSESS_ONLY' ? 'Assess only' : 'Assess and remediate'}</td>
                  <td style={styles.cell}>{formatRunSchedule(policy)}</td>
                  <td style={styles.cell}>{policy.selectedControls.length}</td>
                  <td style={styles.cell}>{policy.expectedAutomationCount}</td>
                  <td style={styles.cell}>
                    <div style={styles.rowActions}>
                      <button type="button" style={styles.inlineButton} onClick={() => onOpen(policy.policyId)}>
                        Open
                      </button>
                      <button type="button" style={styles.inlineButton} onClick={() => onEdit(policy.policyId)}>
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default PolicyListView;
