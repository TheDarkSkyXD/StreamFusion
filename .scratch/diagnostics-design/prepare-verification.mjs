import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
let source = await readFile(path.join(root, '.agents/skills/verify-streamfusion/scripts/control.mjs'), 'utf8');
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error(`Controller shape changed: ${before}`);
  source = source.replace(before, after);
}
replaceOnce('"./control-launch-plan.mjs"', '"../../.agents/skills/verify-streamfusion/scripts/control-launch-plan.mjs"');
replaceOnce('path.resolve(scriptDir, "..", "..", "..", "..")', 'path.resolve(scriptDir, "..", "..")');
replaceOnce('  const databaseSeed = options.fresh', `  const diagnosticsHistorySeed = typeof options["diagnostics-history"] === "string"
    ? await snapshotSqliteIfPresent(path.resolve(options["diagnostics-history"]), path.join(profileDir, "diagnostics-history.sqlite"))
    : null;
  const databaseSeed = options.fresh`);
replaceOnce('    databaseSeed,\n    accountStorageSeed,', '    databaseSeed,\n    diagnosticsHistorySeed,\n    accountStorageSeed,');
await writeFile(path.join(directory, 'control-proof.mjs'), source);
process.stdout.write('Prepared isolated verification controller with explicit diagnostics database seeding.\n');
