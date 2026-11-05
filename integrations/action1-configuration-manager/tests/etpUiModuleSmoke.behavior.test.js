const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

test('the actual Configuration Manager UI entry and PolicyPage signing imports bundle', async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const result = await build({
    configFile: false, logLevel: 'error', plugins: [react({ jsxRuntime: 'classic' })],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false, minify: false,
      lib: { entry: path.resolve(__dirname, '../ui/index.jsx'), formats: ['es'] },
      rollupOptions: { external: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'recharts'] }
    }
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
  const chunk = outputs.find(output => output.type === 'chunk' && output.isEntry);
  assert(chunk.exports.includes('views'));
});
