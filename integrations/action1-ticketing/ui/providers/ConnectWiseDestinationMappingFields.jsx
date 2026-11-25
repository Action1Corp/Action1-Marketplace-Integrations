import React, { useState } from 'react';

export default function ConnectWiseDestinationMappingFields({
  row = {}, options = [], selectedOption, destinationLoading = false, error = '', disabled = false,
  searchQuery = '', hasMore = false, searchSupported = true, destinationError, onSearch, onLoadMore, onChange
}) {
  const [query, setQuery] = useState(searchQuery);
  const selected = selectedOption || options.find((option) => String(option.id ?? option.value) === String(row.destinationId)) || null;
  const selectedMetadata = selected?.metadata || selected?.destinationEligibility || {};
  const statusText = selectedMetadata.eligibilityKnown === false
    ? 'Eligibility could not be verified; ticket writes are blocked.'
    : selectedMetadata.eligible === false ? (selectedMetadata.eligibilityReason || 'This company cannot receive tickets.') : '';
  return <div>
    <input type="search" aria-label={`Search ConnectWise companies for ${row.action1OrgName || 'organization'}`} value={query} disabled={disabled} placeholder="Search companies..." onChange={(event) => { setQuery(event.target.value); onSearch?.(event.target.value); }} />
    <select aria-label={`ConnectWise company for ${row.action1OrgName || 'organization'}`} disabled={disabled || destinationLoading} value={String(row.destinationId || '')} onChange={(event) => {
      const option = options.find((item) => String(item.id ?? item.value) === event.target.value);
      if (!option || option.metadata?.eligible !== true || option.metadata?.eligibilityKnown !== true) return;
      onChange?.(String(option.id ?? option.value), option.name || option.label);
    }}>
      <option value="">Select company</option>
      {selected && !options.some((item) => String(item.id ?? item.value) === String(selected.id ?? selected.value)) ? <option value={String(selected.id ?? selected.value)} disabled>{selected.name || selected.label} (eligibility needs review)</option> : null}
      {options.map((option) => <option key={option.id ?? option.value} value={String(option.id ?? option.value)} disabled={option.metadata?.eligible !== true || option.metadata?.eligibilityKnown !== true}>{option.label || option.name}{option.metadata?.eligible === false ? ' — unavailable' : ''}</option>)}
    </select>
    {statusText ? <small role="status">{statusText}</small> : null}
    {destinationLoading ? <small role="status">Loading companies…</small> : null}
    {error || destinationError ? <small role="alert">{error || destinationError}</small> : null}
    {hasMore ? <button type="button" disabled={disabled || destinationLoading} onClick={() => onLoadMore?.()}>{destinationLoading ? 'Loading…' : 'Load more companies'}</button> : null}
    {!searchSupported ? <small>Company search is unavailable.</small> : null}
  </div>;
}
