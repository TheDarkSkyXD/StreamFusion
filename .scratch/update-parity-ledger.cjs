const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd().replaceAll('\\', '/');
const ledgerPath = 'apps/desktop/scripts/desktop-parity-capabilities.json';
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const all = (dir) => fs.readdirSync(dir, {withFileTypes:true}).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? all(file) : [file.replaceAll('\\','/')];
});
const current = all('apps/desktop/src').filter((file) => /\.(test|system\.test)\.(ts|tsx)$/.test(file));
const manual = new Map([
  ['apps/desktop/tests/components/player/player-controls.test.tsx','apps/desktop/src/frontend/features/playback/tests/components/player/player-controls.test.tsx'],
  ['apps/desktop/tests/pages/Categories.test.tsx','apps/desktop/src/frontend/features/discovery/tests/pages/Categories.test.tsx'],
  ['apps/desktop/tests/pages/History.test.tsx','apps/desktop/src/frontend/features/media-library/tests/pages/History.test.tsx'],
  ['apps/desktop/tests/pages/Mod/index.test.tsx','apps/desktop/src/frontend/features/moderation/tests/pages/Mod/index.test.tsx'],
  ['apps/desktop/tests/pages/Settings.test.tsx','apps/desktop/src/frontend/features/settings/tests/pages/Settings.test.tsx'],
  ['apps/desktop/tests/pages/Settings/diagnostics-workspace.test.tsx','apps/desktop/src/frontend/features/settings/tests/pages/Settings/diagnostics-workspace.test.tsx'],
  ['apps/desktop/tests/pages/Stream.test.tsx','apps/desktop/src/frontend/features/playback/tests/pages/Stream.test.tsx'],
]);
const updated = [];
for (const capability of ledger.capabilities) {
  capability.verification = capability.verification.map((oldPath) => {
    if (!oldPath.startsWith('apps/desktop/tests/') || fs.existsSync(oldPath)) return oldPath;
    const explicit = manual.get(oldPath);
    if (explicit) { updated.push([oldPath, explicit]); return explicit; }
    const basename = path.basename(oldPath);
    const candidates = current.filter((candidate) => path.basename(candidate) === basename);
    if (candidates.length !== 1) throw new Error(`Need exact parity verification mapping for ${oldPath}: ${candidates.join(', ')}`);
    updated.push([oldPath, candidates[0]]);
    return candidates[0];
  });
}
const persistence = new Map([
  ['apps/desktop/src/backend/services/captions/caption-model-store.ts','apps/desktop/src/backend/features/playback/data/caption-model-store.ts'],
  ['apps/desktop/src/backend/services/download-queue-service.ts','apps/desktop/src/backend/features/media-library/domain/download-queue-service.ts'],
  ['apps/desktop/src/backend/services/stream-recording-session-store.ts','apps/desktop/src/backend/features/media-library/data/stream-recording-session-store.ts'],
]);
for (const capability of ledger.capabilities) capability.persistence = capability.persistence.map((item) => persistence.get(item) ?? item);
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`Updated ${updated.length} verification references`);
for (const [from, to] of updated) console.log(`${from} -> ${to}`);
