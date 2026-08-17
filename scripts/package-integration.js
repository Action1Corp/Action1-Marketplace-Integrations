#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.resolve(process.argv[2] || '');
const outputDir = path.resolve(process.argv[3] || path.join(repoRoot, 'dist', 'integrations'));

if (!sourceDir || !fs.existsSync(sourceDir)) {
  throw new Error('Usage: node scripts/package-integration.js <integration-dir> [output-dir]');
}

const manifestPath = path.join(sourceDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Integration manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const id = String(manifest.id || '').trim();
const version = String(manifest.version || '').trim().replace(/^v/i, '');
if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
  throw new Error('manifest.json must include a safe integration id.');
}
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('manifest.json must include a semantic version.');
}

const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-package-'));
const packageDir = path.join(packageRoot, id);
const packageName = `action1-integration-${id}-${version}.tgz`;
const packagePath = path.join(outputDir, packageName);

function copyPackageFile(relativePath) {
  const source = path.join(sourceDir, relativePath);
  if (!fs.existsSync(source)) return;
  const target = path.join(packageDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function safeGlobalName(value) {
  return String(value).replace(/[^a-zA-Z0-9_$]/g, '_');
}

function buildUiBundle() {
  const uiEntry = path.join(packageDir, 'ui', 'index.jsx');
  if (!fs.existsSync(uiEntry)) return false;

  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const reactPlugin = path.join(repoRoot, 'node_modules', '@vitejs', 'plugin-react', 'dist', 'index.js');
  if (!fs.existsSync(viteBin) || !fs.existsSync(reactPlugin)) {
    throw new Error('Repository dependencies are required to build integration UI. Run npm install first.');
  }

  const buildRoot = path.join(packageRoot, '_ui-build');
  const entryPath = path.join(buildRoot, 'remote-entry.mjs');
  const configPath = path.join(buildRoot, 'vite.remote.config.mjs');
  const jsxRuntimeShimPath = path.join(buildRoot, 'react-jsx-runtime-shim.mjs');
  const outDir = path.join(packageDir, 'ui-dist');
  fs.mkdirSync(buildRoot, { recursive: true });

  const relativeUiEntry = path.relative(buildRoot, uiEntry).replace(/\\/g, '/');
  fs.writeFileSync(entryPath, [
    `import * as integrationModule from ${jsString(relativeUiEntry.startsWith('.') ? relativeUiEntry : `./${relativeUiEntry}`)};`,
    'const registry = window.__ACTION1_INTEGRATION_VIEWS__ || (window.__ACTION1_INTEGRATION_VIEWS__ = {});',
    `registry[${jsString(id)}] = integrationModule.views || {};`
  ].join('\n'));

  fs.writeFileSync(jsxRuntimeShimPath, [
    "import React from 'react';",
    '',
    'export const Fragment = React.Fragment;',
    '',
    'export function jsx(type, props, key) {',
    '  return React.createElement(type, key === undefined ? props : { ...props, key });',
    '}',
    '',
    'export const jsxs = jsx;',
    ''
  ].join('\n'));

  const aliases = {
    'react/jsx-runtime': jsxRuntimeShimPath,
    react: path.join(repoRoot, 'node_modules', 'react'),
    'react-dom': path.join(repoRoot, 'node_modules', 'react-dom'),
    'react-router-dom': path.join(repoRoot, 'node_modules', 'react-router-dom'),
    html2canvas: path.join(repoRoot, 'node_modules', 'html2canvas'),
    'lucide-react': path.join(repoRoot, 'node_modules', 'lucide-react'),
    recharts: path.join(repoRoot, 'node_modules', 'recharts')
  };

  fs.writeFileSync(configPath, [
    `import react from ${jsString(pathToFileURL(reactPlugin).href)};`,
    '',
    'export default {',
    '  plugins: [react()],',
    "  define: { 'process.env.NODE_ENV': JSON.stringify('production') },",
    `  resolve: { alias: ${JSON.stringify(aliases, null, 4)} },`,
    '  build: {',
    `    outDir: ${jsString(outDir)},`,
    '    emptyOutDir: true,',
    '    minify: true,',
    '    lib: {',
    `      entry: ${jsString(entryPath)},`,
    `      name: ${jsString(`Action1Integration_${safeGlobalName(id)}`)},`,
    "      formats: ['iife'],",
    "      fileName: () => 'remote.js'",
    '    },',
    '    rollupOptions: {',
    "      external: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'recharts'],",
    '      output: {',
    '        globals: {',
    "          react: 'React',",
    "          'react-dom': 'ReactDOM',",
    "          'react-router-dom': 'ReactRouterDOM',",
    "          'lucide-react': 'LucideReact',",
    "          recharts: 'Recharts'",
    '        }',
    '      }',
    '    }',
    '  }',
    '};',
    ''
  ].join('\n'));

  const result = spawnSync(process.execPath, [viteBin, 'build', '--config', configPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });
  if (result.status !== 0) {
    throw new Error('Vite failed while building integration UI bundle.');
  }
  const remotePath = path.join(outDir, 'remote.js');
  const remoteSource = fs.readFileSync(remotePath, 'utf8');
  if (/\brequire\s*\(/.test(remoteSource)) {
    throw new Error(`Integration UI bundle for ${id} contains CommonJS require(), which cannot run as a browser remote.`);
  }
  return true;
}

try {
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    copyPackageFile(entry.name);
  }

  const uiBundled = buildUiBundle();
  const metadata = {
    schemaVersion: 1,
    id,
    version,
    createdAt: new Date().toISOString(),
    packageFormat: 'action1.integration.v1',
    uiBundle: uiBundled ? 'ui-dist/remote.js' : null
  };
  fs.writeFileSync(path.join(packageDir, 'action1-package.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  fs.rmSync(packagePath, { force: true });
  const tarResult = spawnSync('tar', ['-czf', packagePath, '-C', packageRoot, id], { stdio: 'inherit' });
  if (tarResult.status !== 0) {
    throw new Error('tar command failed while creating integration package.');
  }

  const sha256 = sha256File(packagePath);
  fs.writeFileSync(`${packagePath}.sha256`, `${sha256}  ${packageName}\n`);
  fs.copyFileSync(manifestPath, `${packagePath}.manifest.json`);
  console.log(JSON.stringify({ id, version, package: packagePath, sha256 }, null, 2));
} finally {
  fs.rmSync(packageRoot, { recursive: true, force: true });
}
