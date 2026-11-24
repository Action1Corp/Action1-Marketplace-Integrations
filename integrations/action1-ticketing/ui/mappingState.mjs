export function normalizeOptions(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const id = String(row?.id ?? row?.value ?? '').trim();
    const name = String(row?.name ?? row?.label ?? '').trim();
    return id && name ? { value: id, label: name, name } : null;
  }).filter(Boolean);
}

export function isCurrentMappingRequest(request, current) {
  return request?.providerId === current?.providerId && request?.generation === current?.generation;
}

export function normalizeMappingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row?.id ?? null,
    action1OrgId: String(row?.action1OrgId || ''),
    action1OrgName: String(row?.action1OrgName || ''),
    destinationId: String(row?.destinationId ?? row?.haloClientId ?? ''),
    destinationName: String(row?.destinationName ?? row?.haloClientName ?? '')
  }));
}

export function ensureSelectedOption(options, value, name) {
  const selectedValue = String(value || '').trim();
  const selectedName = String(name || '').trim();
  if (!selectedValue || !selectedName || options.some((row) => row.value === selectedValue)) return options;
  return [...options, { value: selectedValue, label: selectedName, name: selectedName }];
}

export function mappingOptionsForRow(allOptions, rows, rowIndex, valueKey, nameKey) {
  const normalized = normalizeOptions(allOptions);
  const selectedElsewhere = new Set(rows.filter((_, index) => index !== rowIndex)
    .map((row) => String(row?.[valueKey] || '').trim()).filter(Boolean));
  const current = rows[rowIndex] || {};
  const currentValue = String(current[valueKey] || '').trim();
  const available = normalized.filter((option) => option.value === currentValue || !selectedElsewhere.has(option.value));
  return ensureSelectedOption(available, current[valueKey], current[nameKey]);
}

function normalizeSearchText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildOrganizationMappingRows(action1Organizations, draftRows, options = {}) {
  const filter = ['All', 'Mapped', 'Unmapped'].includes(options.filter) ? options.filter : 'All';
  const query = normalizeSearchText(options.search);
  const hasSearch = Boolean(query);
  const drafts = Array.isArray(draftRows) ? draftRows : [];
  const organizations = normalizeOptions(action1Organizations);
  const knownOrganizationIds = new Set(organizations.map((row) => row.value));
  for (const draft of drafts) {
    const id = String(draft?.action1OrgId || '').trim();
    const name = String(draft?.action1OrgName || '').trim();
    if (id && name && !knownOrganizationIds.has(id)) {
      organizations.push({ value: id, name, label: name });
      knownOrganizationIds.add(id);
    }
  }
  const draftsByOrganization = new Map();
  const blankDrafts = [];

  drafts.forEach((row, draftIndex) => {
    const organizationId = String(row?.action1OrgId || '').trim();
    if (!organizationId) {
      blankDrafts.push({ kind: 'blank-draft', draftIndex, row });
      return;
    }
    const rows = draftsByOrganization.get(organizationId) || [];
    rows.push({ kind: 'organization', draftIndex, row });
    draftsByOrganization.set(organizationId, rows);
  });

  const projected = [];
  for (const organization of organizations) {
    const organizationDrafts = draftsByOrganization.get(organization.value) || [];
    const completeDrafts = organizationDrafts.filter(({ row }) =>
      String(row?.action1OrgId || '').trim() && String(row?.destinationId ?? row?.haloClientId ?? '').trim());
    const mapped = completeDrafts.length > 0;
    if (filter === 'Mapped' && !mapped) continue;
    if (filter === 'Unmapped' && mapped) continue;

    const rows = organizationDrafts.length
      ? organizationDrafts
      : [{ kind: 'organization', draftIndex: null, row: {
        id: null,
        action1OrgId: organization.value,
        action1OrgName: organization.name,
        destinationId: '',
        destinationName: ''
      } }];
    const organizationMatches = !query || normalizeSearchText(organization.name).includes(query);
    for (const draft of rows) {
      const destinationMatches = hasSearch && normalizeSearchText(draft.row?.destinationName ?? draft.row?.haloClientName).includes(query);
      if (hasSearch && !organizationMatches && !destinationMatches) continue;
      projected.push({
        ...draft,
        key: draft.draftIndex === null ? `organization-${organization.value}` : `draft-${draft.draftIndex}`,
        action1OrgId: organization.value,
        action1OrgName: organization.name,
        mapped: String(draft.row?.destinationId ?? draft.row?.haloClientId ?? '').trim().length > 0
      });
    }
  }

  if (filter === 'All') {
    for (const draft of blankDrafts) {
      // Blank Add Mapping rows remain available in All regardless of the organization search.
      projected.push({ ...draft, key: `blank-draft-${draft.draftIndex}`, action1OrgId: '', action1OrgName: '', mapped: false });
    }
  }
  return projected;
}

export function paginateMappingRows(rows, requestedPage = 0, pageSize = 25) {
  const allRows = Array.isArray(rows) ? rows : [];
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 25;
  const pageCount = Math.ceil(allRows.length / safePageSize);
  const lastPage = Math.max(0, pageCount - 1);
  const numericPage = Number.isFinite(Number(requestedPage)) ? Math.floor(Number(requestedPage)) : 0;
  const page = Math.max(0, Math.min(numericPage, lastPage));
  const startIndex = page * safePageSize;
  const visibleRows = allRows.slice(startIndex, startIndex + safePageSize);
  return {
    rows: visibleRows,
    page,
    pageCount,
    total: allRows.length,
    start: visibleRows.length ? startIndex + 1 : 0,
    end: visibleRows.length ? startIndex + visibleRows.length : 0
  };
}

export function buildPersistRows(rows, action1Organizations, destinationOptions) {
  const errors = [];
  const persistRows = [];
  const orgNames = new Map(normalizeOptions(action1Organizations).map((row) => [row.value, row.name]));
  const destinationNames = new Map(normalizeOptions(destinationOptions).map((row) => [row.value, row.name]));
  const seenOrganizations = new Set();
  const seenDestinations = new Set();

  for (const row of rows || []) {
    const action1OrgId = String(row?.action1OrgId || '').trim();
    const destinationId = String(row?.destinationId ?? row?.haloClientId ?? '').trim();
    const action1OrgName = String(orgNames.get(action1OrgId) || row?.action1OrgName || '').trim();
    const destinationName = String(destinationNames.get(destinationId) || row?.destinationName || row?.haloClientName || '').trim();
    if (!action1OrgId && !destinationId) continue;
    if (!action1OrgId || !destinationId) {
      errors.push('Select both an Action1 organization and a destination, or remove the incomplete row.');
      continue;
    }
    if (!action1OrgName || !destinationName) {
      errors.push('A selected organization is missing its discovered name. Refresh Discovery and try again.');
      continue;
    }
    if (seenOrganizations.has(action1OrgId)) errors.push('Each Action1 organization can only be mapped once. Remove duplicate mappings before saving.');
    if (seenDestinations.has(destinationId)) errors.push('Each destination can only be mapped once. Remove duplicate mappings before saving.');
    seenOrganizations.add(action1OrgId);
    seenDestinations.add(destinationId);
    persistRows.push({ id: row?.id ?? null, action1OrgId, action1OrgName, destinationId, destinationName });
  }
  return { errors: Array.from(new Set(errors)), persistRows };
}

function sameRelationship(left, right) {
  return String(left?.action1OrgId || '') === String(right?.action1OrgId || '') &&
    String(left?.destinationId ?? left?.haloClientId ?? '') === String(right?.destinationId ?? right?.haloClientId ?? '');
}

function sameMapping(left, right) {
  return sameRelationship(left, right) &&
    String(left?.action1OrgName || '') === String(right?.action1OrgName || '') &&
    String(left?.destinationName ?? left?.haloClientName ?? '') === String(right?.destinationName ?? right?.haloClientName ?? '');
}

export function buildMappingSavePlan(savedRows, desiredRows) {
  const saved = normalizeMappingRows(savedRows);
  const desired = normalizeMappingRows(desiredRows);
  const savedById = new Map(saved.filter((row) => row.id !== null).map((row) => [String(row.id), row]));
  const desiredById = new Map(desired.filter((row) => row.id !== null).map((row) => [String(row.id), row]));
  const deletes = saved.filter((row) => {
    const next = desiredById.get(String(row.id));
    return !next || !sameRelationship(row, next);
  });
  const saves = [];
  for (const row of desired) {
    const previous = row.id === null ? null : savedById.get(String(row.id));
    if (!previous || !sameRelationship(previous, row)) {
      saves.push({ ...row, id: null });
    } else if (!sameMapping(previous, row)) {
      saves.push(row);
    }
  }
  return { deletes, saves };
}

export async function executeMappingSavePlan(plan, actions) {
  for (const row of plan.deletes) await actions.delete(row.id);
  for (const row of plan.saves) await actions.save(row);
}
