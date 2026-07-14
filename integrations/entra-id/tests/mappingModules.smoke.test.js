const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const repoRoot = path.join(__dirname, '..', '..', '..');
const integrationUiDir = path.join(__dirname, '..', 'ui');

function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildUiSmoke() {
  const scratchRoot = path.join(repoRoot, '.tmp-tests');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const packageRoot = fs.mkdtempSync(path.join(scratchRoot, 'entra-id-mapping-modules-'));
  const buildRoot = path.join(packageRoot, 'build');
  const outDir = path.join(packageRoot, 'dist');
  fs.mkdirSync(buildRoot, { recursive: true });

  const entryPath = path.join(buildRoot, 'entry.mjs');
  const configPath = path.join(buildRoot, 'vite.config.mjs');
  const mappingImport = path.relative(buildRoot, path.join(integrationUiDir, 'Mapping.jsx')).replace(/\\/g, '/').replace(/^(?!\.)/, './');
  const entrySource = [
    `import Mapping from ${jsString(mappingImport)};`,
    'if (typeof Mapping !== "function") {',
    '  throw new Error("Mapping.jsx must default export the Mapping component");',
    '}'
  ].join('\n');
  fs.writeFileSync(entryPath, `${entrySource}\n`);

  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const reactPlugin = path.join(repoRoot, 'node_modules', '@vitejs', 'plugin-react', 'dist', 'index.js');
  const aliases = {
    react: path.join(repoRoot, 'node_modules', 'react'),
    'react-dom': path.join(repoRoot, 'node_modules', 'react-dom'),
    'react-router-dom': path.join(repoRoot, 'node_modules', 'react-router-dom'),
    'lucide-react': path.join(repoRoot, 'node_modules', 'lucide-react'),
    recharts: path.join(repoRoot, 'node_modules', 'recharts')
  };

  fs.writeFileSync(configPath, [
    `import react from ${jsString(pathToFileURL(reactPlugin).href)};`,
    '',
    'export default {',
    '  plugins: [react()],',
    `  resolve: { alias: ${JSON.stringify(aliases, null, 4)} },`,
    '  build: {',
    `    outDir: ${jsString(outDir)},`,
    '    emptyOutDir: true,',
    '    minify: false,',
    '    lib: {',
    `      entry: ${jsString(entryPath)},`,
    "      formats: ['es'],",
    "      fileName: () => 'entry.js'",
    '    }',
    '  }',
    '};',
    ''
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [viteBin, 'build', '--config', configPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' }
    });

    const outputPath = path.join(outDir, 'entry.js');
    return {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
      outputExists: fs.existsSync(outputPath)
    };
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
}

function run() {
  const result = buildUiSmoke();
  assert.strictEqual(result.status, 0, `Vite should load Mapping.jsx without module errors.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.strictEqual(result.outputExists, true, 'the Mapping module smoke bundle should be emitted');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
