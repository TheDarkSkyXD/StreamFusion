const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const file = '.scratch/feature-migration/central-test-ownership-applied.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.status = 'applied';
manifest.importRewrites = manifest.importRewrites.map((entry) => path.relative(root, entry).replaceAll('\\', '/'));
manifest.environmentMembership = {
  preservedDom: manifest.moves.filter((move) => move.currentProject === 'dom' && move.to.includes('/src/backend/')).map((move) => move.to),
  preservedNode: manifest.moves.filter((move) => move.currentProject === 'node').map((move) => move.to),
  frontendDom: manifest.moves.filter((move) => move.currentProject === 'dom' && move.to.includes('/src/frontend/')).map((move) => move.to),
};
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
const absentSource = manifest.moves.filter(({from}) => fs.existsSync(path.join(root, from))).map(({from}) => from);
const absentTarget = manifest.moves.filter(({to}) => !fs.existsSync(path.join(root, to))).map(({to}) => to);
console.log(`sourcesRemaining=${absentSource.length}`);
console.log(`targetsMissing=${absentTarget.length}`);
if (absentSource.length || absentTarget.length) process.exitCode = 1;
