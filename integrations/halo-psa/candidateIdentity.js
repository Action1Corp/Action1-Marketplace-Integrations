const { SIGNAL_TYPE_VALUES } = require('./signals');

function buildCandidateIdentity(input) {
  const orgLinkId = String(input?.orgLinkId || '').trim();
  const endpointId = String(input?.endpointId || '').trim();
  const signalType = normalizeSignalType(input?.signalType);
  const key = `${orgLinkId}|${endpointId}|${signalType}`;
  return {
    orgLinkId,
    endpointId,
    signalType,
    key
  };
}

function normalizeSignalType(signalTypeRaw) {
  const value = String(signalTypeRaw || '').trim().toUpperCase();
  return SIGNAL_TYPE_VALUES.includes(value) ? value : value;
}

module.exports = {
  buildCandidateIdentity
};
