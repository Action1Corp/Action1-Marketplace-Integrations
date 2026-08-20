const assert = require('assert');

(async () => {
  const { getParameterRendererKind, SUPPORTED_PARAMETER_TYPES } = await import('../parameterRenderer.js');

  assert.deepStrictEqual(
    SUPPORTED_PARAMETER_TYPES,
    ['boolean', 'integer', 'enum', 'string', 'multiline-string', 'time']
  );
  for (const type of SUPPORTED_PARAMETER_TYPES) {
    assert.strictEqual(getParameterRendererKind(type), type, `${type} should map to its strict renderer`);
  }
  assert.strictEqual(getParameterRendererKind('json'), null, 'unknown types must have no permissive renderer');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
