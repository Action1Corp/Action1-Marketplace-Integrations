const styles = {
  shell: {
    width: '100%',
    maxWidth: 960,
    margin: '0 auto',
    display: 'grid',
    gap: '0.75rem'
  }
};

function History() {
  return (
    <div style={styles.shell}>
      <h1 className="page-title">History</h1>
      <div className="glass-panel">
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          History UI is intentionally a scaffold in Slice 0. Audit behavior is implemented in later slices.
        </p>
      </div>
    </div>
  );
}

export default History;
