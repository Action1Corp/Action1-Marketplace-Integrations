export const HISTORY_PAGE_SIZES = [50, 100, 200];
export const DEFAULT_HISTORY_PAGE_SIZE = 50;

export function getHistoryRange(page, pageSize, total) {
  const normalizedTotal = Number.isInteger(total) && total > 0 ? total : 0;
  if (normalizedTotal === 0) return { start: 0, end: 0, total: 0 };
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.max(1, Number(pageSize) || DEFAULT_HISTORY_PAGE_SIZE);
  return {
    start: ((normalizedPage - 1) * normalizedPageSize) + 1,
    end: Math.min(normalizedPage * normalizedPageSize, normalizedTotal),
    total: normalizedTotal
  };
}

export function buildPageItems(page, totalPages) {
  const current = Math.max(1, Number(page) || 1);
  const last = Math.max(1, Number(totalPages) || 1);
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);

  const items = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(last - 1, current + 1);
  if (start > 2) items.push('ellipsis-before');
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < last - 1) items.push('ellipsis-after');
  items.push(last);
  return items;
}

const COUNTER_LABELS = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Removed',
  unchanged: 'Unchanged',
  failed: 'Failed',
  policiesChecked: 'Policies checked',
  automationsChecked: 'Automations checked'
};

const OPERATION_COUNTERS = {
  'Policy created': ['created', 'failed'],
  'Policy updated': ['updated', 'created', 'deleted', 'unchanged', 'failed'],
  'Policy disabled': ['deleted', 'failed'],
  'Policy enabled': ['created', 'failed'],
  'Policy deleted': ['deleted', 'failed'],
  'Scheduled reconciliation': ['policiesChecked', 'automationsChecked', 'created', 'unchanged', 'failed'],
  Reconciliation: ['policiesChecked', 'automationsChecked', 'created', 'unchanged', 'failed']
};

export function getRelevantCounterEntries(row) {
  const counts = row?.counts || {};
  const keys = OPERATION_COUNTERS[row?.operation] || [];
  return keys.filter((key) => Number.isInteger(counts[key]) && counts[key] >= 0)
    .map((key) => ({ key, label: COUNTER_LABELS[key], value: counts[key] }));
}

export function getCompactHistorySummary(row) {
  const entries = getRelevantCounterEntries(row)
    .filter((entry) => entry.value > 0 && !['policiesChecked', 'automationsChecked'].includes(entry.key));
  if (entries.length > 0) {
    return entries.map((entry) => `${entry.value} ${entry.label.toLowerCase()}`).join(' · ');
  }

  const operation = String(row?.operation || '').trim();
  let summary = String(row?.summary || '').trim();
  summary = summary.replace(/\s*Automations?\s+(?:created|removed|updated):\s*0\.?/gi, '').trim();
  if (operation && summary.startsWith(`${operation}.`)) summary = summary.slice(operation.length + 1).trim();
  return summary || 'No changes';
}
