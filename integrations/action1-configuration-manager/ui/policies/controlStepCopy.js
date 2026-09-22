export function controlsStepDescription(catalog) {
  const version = typeof catalog?.packVersion === 'string' ? catalog.packVersion.trim() : '';
  return version
    ? `Choose Control Families and Controls from Control Pack ${version}.`
    : 'Choose Control Families and Controls from the released catalog metadata.';
}
