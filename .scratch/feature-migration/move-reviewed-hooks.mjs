import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {prepareRelocation} from '../../scripts/relocate-feature-files.mjs';
const base='apps/desktop/src/frontend/features/';
const moves=[
 {from:base+'auth/composition/live-notification-bridge.ts',to:base+'auth/components/hooks/use-live-notification-bridge.ts'},
 {from:base+'shell/composition/app-shutdown.ts',to:base+'shell/components/hooks/use-app-shutdown.ts'},
];
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','apps/desktop/src','apps/desktop/tests']).toString().split('\0').filter(f=>f&&fs.existsSync(f));
const result=prepareRelocation(process.cwd(),moves,files);
result.apply();
fs.writeFileSync('.scratch/feature-migration/reviewed-hook-moves.json',JSON.stringify({moves},null,2)+'\n');
console.log({moves:result.moves.length,repairs:result.changes.length});
