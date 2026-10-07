const PREFIX = 'A1CM_PROGRESS_V1';

export function formatAutomationProgressCopy(operation, checkpoint) {
  if (!checkpoint || checkpoint.total === 0) return '';
  if (operation === 'create') return `Creating automations: ${checkpoint.completed} of ${checkpoint.total}`;
  if (operation === 'delete') return `Deleting automations: ${checkpoint.completed} of ${checkpoint.total}`;
  return '';
}

export function parseLatestProgressCheckpoint(details, { operation, operationId } = {}) {
  if (!operationId) return null;
  const lines = String(details || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const marker = lines[index].indexOf(PREFIX);
    if (marker < 0) continue;
    try {
      const checkpoint = JSON.parse(lines[index].slice(marker + PREFIX.length).trim());
      if (checkpoint?.operation !== operation || checkpoint?.operationId !== operationId) continue;
      if (!Number.isInteger(checkpoint.completed) || !Number.isInteger(checkpoint.total) || checkpoint.total <= 0 || checkpoint.completed < 0 || checkpoint.completed > checkpoint.total) continue;
      return checkpoint;
    } catch {
      // Ignore malformed or unrelated run-log lines.
    }
  }
  return null;
}

export function createHistoryProgressPoller({
  historyAdapter, actionId, operation, operationId, onProgress, onFinished,
  intervalMs = 2000, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout
} = {}) {
  let stopped = false;
  let timer = null;
  async function poll() {
    if (stopped) return;
    try {
      const result = await historyAdapter.listRaw({ page: 1, pageSize: 50, sortKey: 'id', sortDirection: 'desc' });
      if (stopped) return;
      const row = (result.rows || []).find((candidate) => candidate.action_id === actionId
        && parseLatestProgressCheckpoint(candidate.details, { operation, operationId }));
      if (row) {
        const checkpoint = parseLatestProgressCheckpoint(row.details, { operation, operationId });
        if (checkpoint) onProgress?.(checkpoint);
        if (row.status !== 'Running') {
          onFinished?.();
          return;
        }
      }
    } catch {
      // History polling is best-effort; the awaited action request remains authoritative.
    }
    if (!stopped) timer = setTimeoutImpl(poll, intervalMs);
  }
  void poll();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeoutImpl(timer);
  };
}
