const { RECONCILIATION_STATE_TABLE } = require('./policyTables');

const MAX_TEXT_LENGTH = 1000;

function bounded(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function createReconciliationStateStore(context) {
  return {
    async save(input = {}) {
      const policyId = bounded(input.policyId);
      if (!policyId) throw new Error('Policy id is required.');
      const result = bounded(input.lastResult) || 'Failed';
      const summary = bounded(input.summary) || 'Reconciliation completed.';
      const error = input.lastError ? bounded(input.lastError) : null;
      const historyRunId = input.historyRunId == null ? null : bounded(input.historyRunId);
      const completedAt = input.lastCompletedAt || new Date().toISOString();
      const updated = await context.db.run(
        `UPDATE ${RECONCILIATION_STATE_TABLE}
            SET last_result = ?, last_completed_at = ?, summary = ?, last_error = ?, history_run_id = ?
          WHERE policy_id = ?`,
        [result, completedAt, summary, error, historyRunId, policyId]
      );
      if (!updated?.changes) {
        await context.db.run(
          `INSERT INTO ${RECONCILIATION_STATE_TABLE}
             (policy_id, last_result, last_completed_at, summary, last_error, history_run_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [policyId, result, completedAt, summary, error, historyRunId]
        );
      }
      return { policyId, lastResult: result, lastCompletedAt: completedAt, summary, lastError: error, historyRunId };
    },
    async get(policyId) {
      const row = await context.db.get(
        `SELECT policy_id, last_result, last_completed_at, summary, last_error, history_run_id
           FROM ${RECONCILIATION_STATE_TABLE} WHERE policy_id = ?`, [bounded(policyId)]
      );
      return row ? {
        policyId: row.policy_id,
        lastResult: row.last_result,
        lastCompletedAt: row.last_completed_at,
        summary: row.summary,
        lastError: row.last_error,
        historyRunId: row.history_run_id
      } : null;
    }
  };
}

module.exports = { MAX_TEXT_LENGTH, createReconciliationStateStore };
