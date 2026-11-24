function normalizeAutoMatchName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMappingRow(row = {}) {
  return {
    id: row.id === undefined || row.id === null || String(row.id).trim() === '' ? null : row.id,
    action1OrgId: String(row.action1OrgId || '').trim(),
    action1OrgName: String(row.action1OrgName || '').trim(),
    destinationId: String(row.destinationId ?? row.haloClientId ?? '').trim(),
    destinationName: String(row.destinationName ?? row.haloClientName ?? '').trim()
  };
}

function isCompleteMapping(row) {
  return Boolean(row.action1OrgId && row.destinationId);
}

function classifyAutoMatches(action1Organizations, destinations, savedMappings, draftRows, options = {}) {
  const sourcesById = new Map();
  const changedSourceIds = new Set();
  for (const row of Array.isArray(action1Organizations) ? action1Organizations : []) {
    const id = String(row?.id || '').trim();
    const name = String(row?.name || '').trim();
    if (!id || !name) continue;
    if (sourcesById.has(id)) {
      if (sourcesById.get(id).name !== name) changedSourceIds.add(id);
      continue;
    }
    sourcesById.set(id, { action1OrgId: id, action1OrgName: name, normalizedName: normalizeAutoMatchName(name) });
  }

  const savedRows = (Array.isArray(savedMappings) ? savedMappings : []).map(normalizeMappingRow).filter(isCompleteMapping);
  const drafts = (Array.isArray(draftRows) ? draftRows : []).map(normalizeMappingRow);
  const completeDraftRows = drafts.filter(isCompleteMapping);
  const savedSourceIds = new Set(savedRows.map((row) => row.action1OrgId));
  const completeDraftSourceIds = new Set(completeDraftRows.map((row) => row.action1OrgId));
  const assignedDestinations = new Map();
  for (const row of [...savedRows, ...drafts.filter((item) => item.destinationId)]) {
    const owners = assignedDestinations.get(row.destinationId) || new Set();
    owners.add(row.action1OrgId);
    assignedDestinations.set(row.destinationId, owners);
  }

  const allSourceNameGroups = new Map();
  for (const source of sourcesById.values()) {
    if (!source.normalizedName) continue;
    const group = allSourceNameGroups.get(source.normalizedName) || [];
    group.push(source);
    allSourceNameGroups.set(source.normalizedName, group);
  }

  const destinationsById = new Map();
  const changedDestinationIds = new Set(options.changedDestinationIds || []);
  for (const row of Array.isArray(destinations) ? destinations : []) {
    const id = String(row?.id || '').trim();
    const name = String(row?.name ?? row?.label ?? '').trim();
    if (!id || !name) continue;
    const previous = destinationsById.get(id);
    if (previous && previous.name !== name) changedDestinationIds.add(id);
    destinationsById.set(id, { id, name, normalizedName: normalizeAutoMatchName(name) });
  }
  const destinationsByName = new Map();
  for (const destination of destinationsById.values()) {
    if (!destination.normalizedName) continue;
    const group = destinationsByName.get(destination.normalizedName) || [];
    group.push(destination);
    destinationsByName.set(destination.normalizedName, group);
  }

  const exactMatches = [];
  const unmatched = [];
  const ambiguous = [];
  const eligibleSources = [...sourcesById.values()].filter((source) =>
    !savedSourceIds.has(source.action1OrgId) && !completeDraftSourceIds.has(source.action1OrgId));

  for (const source of eligibleSources) {
    const base = { action1OrgId: source.action1OrgId, action1OrgName: source.action1OrgName };
    const sourceDrafts = drafts.filter((row) => row.action1OrgId === source.action1OrgId);
    if (changedSourceIds.has(source.action1OrgId)) {
      ambiguous.push({ ...base, reason: 'source_identity_changed', candidateDestinations: [] });
      continue;
    }
    const candidates = destinationsByName.get(source.normalizedName) || [];
    if (!candidates.length) {
      unmatched.push(base);
      continue;
    }
    if ((allSourceNameGroups.get(source.normalizedName) || []).length > 1) {
      ambiguous.push({ ...base, reason: 'multiple_source_organizations', candidateDestinations: candidates.slice(0, 10).map(({ id, name }) => ({ id, name })) });
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push({ ...base, reason: 'duplicate_destination_names', candidateDestinations: candidates.slice(0, 10).map(({ id, name }) => ({ id, name })) });
      continue;
    }
    const destination = candidates[0];
    if (changedDestinationIds.has(destination.id)) {
      ambiguous.push({ ...base, reason: 'destination_changed_during_discovery', candidateDestinations: [{ id: destination.id, name: destination.name }] });
      continue;
    }
    const owners = assignedDestinations.get(destination.id) || new Set();
    if ([...owners].some((ownerId) => ownerId !== source.action1OrgId)) {
      ambiguous.push({ ...base, reason: 'destination_already_assigned', candidateDestinations: [{ id: destination.id, name: destination.name }] });
      continue;
    }
    if (sourceDrafts.length > 1) {
      ambiguous.push({ ...base, reason: 'multiple_draft_rows', candidateDestinations: [{ id: destination.id, name: destination.name }] });
      continue;
    }
    const draftSnapshot = sourceDrafts.length ? sourceDrafts[0] : null;
    exactMatches.push({ ...base, destinationId: destination.id, destinationName: destination.name, draftSnapshot });
  }

  return { analyzedCount: eligibleSources.length, exactMatches, unmatched, ambiguous };
}

module.exports = { classifyAutoMatches, normalizeAutoMatchName, normalizeMappingRow };
