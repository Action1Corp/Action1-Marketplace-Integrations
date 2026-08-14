function planLifecycleDiff(definitions, correlations) {
  const desired = new Map((definitions || []).map((definition) => [definition.automationGroupId, definition]));
  const current = new Map((correlations || []).filter((correlation) => correlation.active !== false).map((correlation) => [correlation.automationGroupId, correlation]));
  const operations = [];

  for (const [automationGroupId, definition] of desired) {
    const correlation = current.get(automationGroupId);
    if (!correlation) {
      operations.push({ type: 'CREATE', automationGroupId, definition });
    } else if (correlation.desiredDefinitionFingerprint === definition.fingerprint) {
      operations.push({ type: 'UNCHANGED', automationGroupId, definition, correlation });
    } else {
      operations.push({ type: 'PATCH', automationGroupId, definition, correlation });
    }
  }

  for (const [automationGroupId, correlation] of current) {
    if (!desired.has(automationGroupId)) {
      operations.push({ type: 'DELETE', automationGroupId, correlation });
    }
  }

  return operations.sort((left, right) => left.automationGroupId.localeCompare(right.automationGroupId));
}

function summarizeLifecycleDiff(operations) {
  const summary = { unchanged: 0, patch: 0, create: 0, delete: 0 };
  for (const operation of operations || []) summary[operation.type.toLowerCase()] += 1;
  return summary;
}

module.exports = { planLifecycleDiff, summarizeLifecycleDiff };
