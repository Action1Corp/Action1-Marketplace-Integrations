const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const testsDir = __dirname;
const files = fs
  .readdirSync(testsDir)
  .filter((fileName) => fileName.endsWith('.test.js'))
  .sort();

for (const fileName of files) {
  childProcess.execFileSync(process.execPath, [path.join(testsDir, fileName)], {
    stdio: 'inherit'
  });
}

console.log(`Entra ID package-local tests passed (${files.length} file${files.length === 1 ? '' : 's'}).`);
