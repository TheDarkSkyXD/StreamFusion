import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {prepareRelocation} from '../../scripts/relocate-feature-files.mjs';
const {moves}=JSON.parse(fs.readFileSync('.scratch/feature-migration/final-fixture-moves.json','utf8'));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{maxBuffer:15_000_000}).toString().split('\0').filter(f=>f&&!f.startsWith('.scratch/')&&fs.existsSync(f));
const result=prepareRelocation(process.cwd(),moves,files,{repair:true,rewriteFiles:moves.map(m=>m.to)});
result.apply();
console.log({repairs:result.changes.length});
