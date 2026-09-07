import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareRelocation } from '../scripts/relocate-feature-files.mjs';

const root = process.cwd();
const audit = JSON.parse(fs.readFileSync('.scratch/feature-migration/central-test-ownership-manifest.json', 'utf8'));
const fixtureMove = {
  from: 'apps/desktop/tests/adblock/fixtures',
  to: 'apps/desktop/src/frontend/features/playback/tests/fixtures',
  feature: 'playback',
  reason: 'Playback-private playlist fixtures move with the Playback tests.',
};
const moves = [...audit.moves, fixtureMove].map(({ from, to }) => ({ from, to }));
const files = execFileSync('rg', ['--files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const relocation = prepareRelocation(root, moves, files, {
  rewriteFiles: audit.moves.map(({ from }) => from),
});
const plan = {
  schemaVersion: 1,
  moves: [...audit.moves, fixtureMove],
  importRewrites: relocation.changes.map(({ file }) => file.replaceAll('\\', '/')),
  fixtureMap: [{ from: fixtureMove.from, to: fixtureMove.to }],
};
fs.writeFileSync('.scratch/feature-migration/central-test-ownership-applied.json', JSON.stringify(plan, null, 2) + '\n');
console.log(`moves=${relocation.moves.length}`);
console.log(`rewrites=${relocation.changes.length}`);
for (const change of relocation.changes) console.log(change.file.replaceAll('\\', '/'));
if (process.argv.includes('--apply')) relocation.apply();
