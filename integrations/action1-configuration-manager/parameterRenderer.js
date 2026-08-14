export const SUPPORTED_PARAMETER_TYPES = Object.freeze([
  'boolean',
  'integer',
  'enum',
  'string',
  'multiline-string',
  'time'
]);

export function getParameterRendererKind(type) {
  return SUPPORTED_PARAMETER_TYPES.includes(type) ? type : null;
}
