const ACTION1_CONSOLE_BASE_URL = 'https://app.action1.com';

export function buildNonCompliantReportUrl(reportId, organizationId) {
  const url = new URL(`/console/reports/${encodeURIComponent(String(reportId))}/summary`, ACTION1_CONSOLE_BASE_URL);
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
  return value === null || value === undefined ? '—' : `${value}%`;
}
