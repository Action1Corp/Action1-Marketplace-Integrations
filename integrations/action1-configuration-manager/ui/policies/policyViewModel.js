export function deriveDisplayName(baseName, scopeLabel) {
  const trimmedBaseName = String(baseName || '').trim();
  const trimmedScopeLabel = String(scopeLabel || '').trim();

  if (!trimmedBaseName) {
    return '';
  }

  if (!trimmedScopeLabel) {
    return trimmedBaseName;
  }

  return `${trimmedBaseName} — ${trimmedScopeLabel}`;
}
