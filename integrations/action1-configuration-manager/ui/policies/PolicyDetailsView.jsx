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
    alignItems: 'flex-start',
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
  buttonRow: {
    display: 'flex',
    gap: '0.5rem'
  },
  button: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.18))',
    borderRadius: 999,
    padding: '0.45rem 0.8rem',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer'
  },
  summaryGrid: {
    display: 'grid',
    gap: '0.65rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
  },
  fieldCard: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
    borderRadius: 12,
    padding: '0.85rem'
  },
  label: {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.82rem'
  },
  value: {
    margin: '0.25rem 0 0',
    fontWeight: 600
  }
};

function formatScope(policy) {
  return policy.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : policy.endpointGroupNameSnapshot;
}

function PolicyDetailsView({ policy, onBack, onEdit }) {
  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Policy Details</h2>
          <p style={styles.description}>Review the saved demo Policy before editing it.</p>
        </div>
        <div style={styles.buttonRow}>
          <button type="button" style={styles.button} onClick={onBack}>
            Back to Policies
          </button>
          <button type="button" style={styles.button} onClick={onEdit}>
            Edit Policy
          </button>
        </div>
      </div>
      <div style={styles.summaryGrid}>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Policy</p>
          <p style={styles.value}>{policy.displayName}</p>
        </div>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Organization</p>
          <p style={styles.value}>{policy.organizationNameSnapshot}</p>
        </div>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Scope</p>
          <p style={styles.value}>{formatScope(policy)}</p>
        </div>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Policy mode</p>
          <p style={styles.value}>{policy.policyMode === 'ASSESS_ONLY' ? 'Assess only' : 'Assess and remediate'}</p>
        </div>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Run schedule</p>
          <p style={styles.value}>Every {policy.runSchedule.runEveryHours} hours</p>
        </div>
        <div style={styles.fieldCard}>
          <p style={styles.label}>Controls</p>
          <p style={styles.value}>{policy.selectedControls.length} selected</p>
        </div>
      </div>
    </section>
  );
}

export default PolicyDetailsView;
