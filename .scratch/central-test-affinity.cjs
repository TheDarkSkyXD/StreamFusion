const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const tests = execFileSync('rg', ['--files', 'apps/desktop/tests'], {encoding:'utf8'}).split(/\r?\n/).filter((file) => /\.(test|system\.test)\.(ts|tsx)$/.test(file));
for (const test of tests) {
  const text = fs.readFileSync(test, 'utf8');
  const features = [...text.matchAll(/(?:@\/|@backend\/)features\/([^/'"`]+)/g)].map((match) => match[1]);
  const ipc = [...text.matchAll(/IPC_(?:CHANNELS|FEATURES)\.([A-Z_]+)/g)].map((match) => match[1]);
  if (features.length || ipc.length) console.log(`${test.replaceAll('\\','/')}\tfeatures=${[...new Set(features)].join(',')}\tipc=${[...new Set(ipc)].join(',')}`);
}
