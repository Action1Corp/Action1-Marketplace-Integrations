const PREFIX = 'A1CM_PROGRESS_V1';
const OPERATIONS = new Set(['create', 'delete']);
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function progressCheckpoint({ operation, completed, total, operationId } = {}) {
  if (!OPERATIONS.has(operation) || !Number.isInteger(completed) || completed < 0 || !Number.isInteger(total) || total < 0 || completed > total) {
    return null;
  }
  const payload = { operation, completed, total };
  if (typeof operationId === 'string' && OPERATION_ID_PATTERN.test(operationId)) payload.operationId = operationId;
  return `${PREFIX} ${JSON.stringify(payload)}`;
}

async function appendProgressCheckpoint(run, checkpoint) {
  if (!checkpoint || typeof run?.appendLog !== 'function') return;
  try {
    await run.appendLog(checkpoint);
  } catch {
    // Progress logging is best-effort and must not alter lifecycle semantics.
  }
}

module.exports = { PREFIX, appendProgressCheckpoint, progressCheckpoint };
