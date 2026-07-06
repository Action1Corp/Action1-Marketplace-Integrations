function formatRemediationStatusLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'OVERDUE') return 'Overdue';
  if (normalized === 'DUE_SOON') return 'Due Soon';
  return String(value || '').trim();
}

module.exports = {
  formatRemediationStatusLabel
};
