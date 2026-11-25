import React from 'react';

const PREFIX = 'TicketingProvider_connectwise_psa_';
const fields = [
  ['ServiceBoardId', 'Service Board', 'service-boards', true],
  ['InitialStatusId', 'Initial Ticket Status', 'board-statuses', true],
  ['TicketTypeId', 'Ticket Type', 'board-types', true],
  ['TicketSubtypeId', 'Ticket Subtype', 'board-subtypes', false],
  ['TicketItemId', 'Ticket Item', 'board-items', false],
  ['PriorityId', 'Priority', 'priorities', false],
  ['SourceId', 'Source', 'sources', false]
];
const valueOf = (settings, field) => String(settings?.[`${PREFIX}${field}`] || (field === 'TicketContentUpdateMode' ? 'replace-original-description' : ''));

export function compatibleOptions(associations, typeId, subtypeId, kind) {
  const rows = (Array.isArray(associations) ? associations : []).map((option) => option.metadata || {});
  if (!rows.length) return [];
  const matching = rows.filter((row) => String(row.typeId || '') === String(typeId || '')
    && (kind === 'board-subtypes' || (subtypeId ? String(row.subtypeId || '') === String(subtypeId) : !row.subtypeId)));
  const ids = new Set(matching.map((row) => String(kind === 'board-subtypes' ? row.subtypeId : row.itemId || '')).filter(Boolean));
  return [...ids];
}

export function applyBoardSelection(settings, boardId) {
  const next = { ...settings, [`${PREFIX}ServiceBoardId`]: boardId };
  for (const field of ['InitialStatusId', 'TicketTypeId', 'TicketSubtypeId', 'TicketItemId', 'AdditionalClosedStatusIds']) next[`${PREFIX}${field}`] = '';
  return next;
}

export function applyTypeSelection(settings, typeId, associations) {
  const next = { ...settings, [`${PREFIX}TicketTypeId`]: typeId };
  const oldSubtype = valueOf(settings, 'TicketSubtypeId');
  const validSubtypes = compatibleOptions(associations, typeId, '', 'board-subtypes');
  const nextSubtype = oldSubtype && validSubtypes.includes(oldSubtype) ? oldSubtype : '';
  if (oldSubtype && !nextSubtype) next[`${PREFIX}TicketSubtypeId`] = '';
  const validItems = compatibleOptions(associations, typeId, nextSubtype, 'board-items');
  const itemId = valueOf(settings, 'TicketItemId');
  if (itemId && !validItems.includes(itemId)) next[`${PREFIX}TicketItemId`] = '';
  if (!associations.length) { next[`${PREFIX}TicketSubtypeId`] = ''; next[`${PREFIX}TicketItemId`] = ''; }
  return next;
}

export function applySubtypeSelection(settings, subtypeId, associations) {
  const next = { ...settings, [`${PREFIX}TicketSubtypeId`]: subtypeId };
  const typeId = valueOf(settings, 'TicketTypeId');
  const itemId = valueOf(settings, 'TicketItemId');
  const validItems = compatibleOptions(associations, typeId, subtypeId, 'board-items');
  if (itemId && !validItems.includes(itemId)) next[`${PREFIX}TicketItemId`] = '';
  if (!associations.length) next[`${PREFIX}TicketItemId`] = '';
  return next;
}

export default function ConnectWiseRoutingFields({ settings = {}, setSettings, discoveryState = {}, onRefresh }) {
  const data = discoveryState.data?.optionsByKind || {};
  const selectedBoard = valueOf(settings, 'ServiceBoardId');
  const selectedType = valueOf(settings, 'TicketTypeId');
  const selectedSubtype = valueOf(settings, 'TicketSubtypeId');
  const associations = data['type-subtype-item-associations'] || [];

  const setValue = (field, value) => {
    const next = { ...settings, [`${PREFIX}${field}`]: value };
    setSettings(next);
    onRefresh?.(next, { silent: true });
  };
  const handleBoard = (boardId) => {
    const next = applyBoardSelection(settings, boardId);
    setSettings(next);
    onRefresh?.(next, { silent: true });
  };
  const handleType = (typeId) => {
    const next = applyTypeSelection(settings, typeId, associations);
    setSettings(next);
    onRefresh?.(next, { silent: true });
  };
  const optionsFor = (field, kind) => {
    let options = Array.isArray(data[kind]) ? data[kind] : [];
    if (kind === 'board-subtypes' && selectedType) {
      const allowed = new Set(compatibleOptions(associations, selectedType, '', kind));
      options = options.filter((option) => allowed.has(String(option.id)));
    }
    if (kind === 'board-items' && selectedType) {
      const allowed = new Set(compatibleOptions(associations, selectedType, selectedSubtype, kind));
      options = options.filter((option) => allowed.has(String(option.id)));
    }
    if (kind === 'board-statuses') {
      const selectedIds = field === 'InitialStatusId'
        ? [valueOf(settings, 'InitialStatusId')]
        : field === null ? valueOf(settings, 'AdditionalClosedStatusIds').split(',').filter(Boolean) : [];
      options = options.filter((option) => option.metadata?.closedStatus !== true && (option.metadata?.inactive !== true || selectedIds.includes(String(option.id))));
      for (const id of selectedIds) {
        if (id && !options.some((option) => String(option.id) === id)) options.push({ id, label: `${id} (unavailable)`, metadata: { inactive: true } });
      }
    }
    return options;
  };

  return <section aria-label="Ticket Configuration">
    <h3>Ticket Configuration</h3>
    {fields.map(([field, label, kind, required]) => {
      const parentRequired = (kind.startsWith('board-') && kind !== 'service-boards') || kind === 'type-subtype-item-associations';
      const disabled = discoveryState.loading || (parentRequired && !selectedBoard) || (['board-subtypes', 'board-items'].includes(kind) && !selectedType);
      const options = optionsFor(field, kind);
      const current = valueOf(settings, field);
      const stale = current && !options.some((option) => String(option.id) === current);
      const onChange = field === 'ServiceBoardId' ? handleBoard
        : field === 'TicketTypeId' ? handleType
          : field === 'TicketSubtypeId' ? (value) => {
            const next = applySubtypeSelection(settings, value, associations);
            setSettings(next);
            onRefresh?.(next, { silent: true });
          }
            : (value) => setValue(field, value);
      return <label key={field} style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.75rem' }}>
        <span>{label}{required ? ' *' : ''}</span>
        <select aria-label={label} required={required} disabled={disabled} value={current} onChange={(event) => onChange(event.target.value)}>
          <option value="">{required ? `Select ${label.toLowerCase()}` : 'Optional'}</option>
          {stale ? <option value={current} disabled>{current} (unavailable — choose another)</option> : null}
          {options.map((option) => <option key={option.id} value={option.id} disabled={option.metadata?.inactive === true}>{option.label}</option>)}
        </select>
        {!disabled && !discoveryState.error && discoveryState.loaded && !options.length ? <small>No available options were returned.</small> : null}
      </label>;
    })}
    <label style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.75rem' }}>
      <span>Additional Closed/Resolved Statuses</span>
      <select aria-label="Additional Closed/Resolved Statuses" multiple size={4} disabled={!selectedBoard || discoveryState.loading} value={valueOf(settings, 'AdditionalClosedStatusIds').split(',').filter(Boolean)} onChange={(event) => setValue('AdditionalClosedStatusIds', [...event.target.selectedOptions].map((option) => option.value).join(','))}>
        {optionsFor(null, 'board-statuses').map((option) => <option key={option.id} value={option.id} disabled={option.metadata?.inactive === true && !valueOf(settings, 'AdditionalClosedStatusIds').split(',').includes(String(option.id))}>{option.label}</option>)}
      </select>
    </label>
    <fieldset style={{ border: 0, padding: 0, margin: '0.75rem 0' }}>
      <legend>Ticket Content Update Mode</legend>
      {[
        ['replace-original-description', 'Replace Original Description'],
        ['append-new-note', 'Append New Note']
      ].map(([value, label]) => <label key={value} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0' }}>
        <input
          type="radio"
          name="connectwise-ticket-content-update-mode"
          value={value}
          checked={valueOf(settings, 'TicketContentUpdateMode') === value}
          onChange={() => setSettings({ ...settings, [`${PREFIX}TicketContentUpdateMode`]: value })}
        />
        {label}
      </label>)}
      <small>Append New Note adds an Internal Note visible to ConnectWise technicians. Customer Portal visibility is not verified.</small>
    </fieldset>
    {discoveryState.error ? <p role="alert">{discoveryState.error}</p> : null}
    {discoveryState.loading ? <p role="status">Loading ConnectWise options…</p> : null}
    <button className="btn-secondary" type="button" onClick={() => onRefresh?.(settings)} disabled={discoveryState.loading}>Refresh Ticket Configuration</button>
  </section>;
}
