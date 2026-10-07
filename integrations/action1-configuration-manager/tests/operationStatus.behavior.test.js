const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function run() {
  const { transformWithOxc } = await import('vite');
  const file = path.join(__dirname, '..', 'ui', 'policies', 'OperationStatus.jsx');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?from\s+['"][^'\"]+['"];\s*/gm, '').replace('export default function OperationStatus', 'function OperationStatus');
  const compiled = await transformWithOxc(source, 'OperationStatus.jsx', { jsx: { runtime: 'classic' } });
  const context = { policyUiTokens: { textSecondary: 'muted', fontSizes: { label: 12 } }, pageSurfaceStyle: {}, React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } };
  vm.createContext(context); vm.runInContext(`${compiled.code}; globalThis.render = OperationStatus;`, context);
  const tree = context.render({ primaryLabel: 'Creating Policy...', secondaryLabel: 'Creating automations: 3 of 7' });
  const text = JSON.stringify(tree);
  assert(text.includes('Creating Policy...'));
  assert(text.includes('Creating automations: 3 of 7'));
  assert.strictEqual(context.render({ primaryLabel: 'Deleting Policy...' }).props.children.some((child) => child?.props?.children === 'Deleting automations: 0 of 0'), false);
  assert.strictEqual(context.render({ primaryLabel: '' }), null);
}

run().then(() => console.log('Configuration Manager OperationStatus behavior passed.')).catch((error) => { console.error(error); process.exit(1); });
