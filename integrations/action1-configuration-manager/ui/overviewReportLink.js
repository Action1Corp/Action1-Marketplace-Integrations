export function buildNonCompliantReportUrl(reportId, organizationId, consoleOrigin) {
  if (!consoleOrigin) return '';
  const url = new URL(`/console/reports/${encodeURIComponent(String(reportId))}/summary`, consoleOrigin);
  url.search = new URLSearchParams({
    limit: '200',
    from: '0',
    live_only: 'no',
    details: 'no',
    org: String(organizationId),
    ent: 'no'
  }).toString();
  return url.toString();
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}%` : '—';
}
