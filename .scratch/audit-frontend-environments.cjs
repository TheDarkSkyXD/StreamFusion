const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const head = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'apps/desktop/tests'], {encoding:'utf8'}).split(/\r?\n/).filter((file) => /\.(test|system\.test)\.(ts|tsx)$/.test(file));
const current = execFileSync('rg', ['--files', 'apps/desktop/src/frontend/features'], {encoding:'utf8'}).split(/\r?\n/).filter((file) => /[\\/]tests[\\/].*\.(test|system\.test)\.(ts|tsx)$/.test(file));
console.log('HEAD backend -> current frontend basenames');
for (const test of current) {
 const basename = test.split(/[\\/]/).at(-1);
 const matches = head.filter((file) => file.startsWith('apps/desktop/tests/backend/') && file.split('/').at(-1) === basename);
 if (matches.length) console.log(`${test.replaceAll('\\','/')} <= ${matches.join('; ')}`);
}
console.log('\nCurrent frontend feature tests with Electron/Node signals');
for (const test of current) {
 const source = fs.readFileSync(test, 'utf8');
 if (/from ["'](?:electron|node:)|vi\.mock\(["']electron/.test(source)) console.log(test.replaceAll('\\','/'));
}
