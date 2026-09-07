const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const file = 'apps/desktop/scripts/desktop-parity-capabilities.json';
const current = JSON.parse(fs.readFileSync(file, 'utf8'));
const base = JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));
const changes = new Map();
for (let i = 0; i < base.capabilities.length; i++) {
  const oldCap = base.capabilities[i];
  const newCap = current.capabilities.find((candidate) => candidate.id === oldCap.id);
  for (const field of ['persistence', 'verification']) {
    for (let j = 0; j < oldCap[field].length; j++) {
      const oldValue = oldCap[field][j];
      const newValue = newCap[field].find((value) => value !== oldValue && value.endsWith(oldValue.split('/').at(-1))) ?? oldValue;
      if (newValue !== oldValue) changes.set(oldValue, newValue);
    }
  }
}
fs.writeFileSync('.scratch/parity-path-changes.json', JSON.stringify([...changes], null, 2));
console.log(changes.size);
