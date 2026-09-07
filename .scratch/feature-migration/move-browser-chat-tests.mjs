import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {prepareRelocation} from '../../scripts/relocate-feature-files.mjs';
const paths=execFileSync('rg',['-l','frontend/features/chat|@/features/chat/(adapters|domain|composition)','apps/desktop/src/backend/features/chat/tests']).toString().trim().split(/\r?\n/).map(p=>p.replaceAll('\\','/'));
const moves=paths.map(from=>({from,to:from.replace('/backend/','/frontend/')}));
const configPath='apps/desktop/vitest.config.ts';
let config=fs.readFileSync(configPath,'utf8');
const domMatch=config.match(/const backendDomTests = \[([\s\S]*?)\];/);
if(!domMatch)throw new Error('DOM project exceptions missing');
const environments=moves.map(move=>({...move,project:domMatch[1].includes(move.from.replace('apps/desktop/',''))?'dom':'node'}));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','apps/desktop/src','apps/desktop/tests']).toString().split('\0').filter(f=>f&&fs.existsSync(f));
const result=prepareRelocation(process.cwd(),moves,files);
result.apply();
const nodeTests=['tests/helpers/better-sqlite3-shim.test.ts',...environments.filter(m=>m.project==='node').map(m=>m.to.replace('apps/desktop/',''))];
config=config.replace(/const nodeOnlyTests = \[[^\]]*\];/,'const nodeOnlyTests = '+JSON.stringify(nodeTests,null,2)+';');
const movedDom=environments.filter(m=>m.project==='dom').map(m=>m.from.replace('apps/desktop/',''));
config=config.split('\n').filter(line=>!movedDom.some(file=>line.includes(file))).join('\n');
fs.writeFileSync(configPath,config);
const ledgerPath='apps/desktop/scripts/desktop-parity-capabilities.json';
const exactMoves=new Map(moves.map(m=>[m.from,m.to]));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
for(const capability of ledger.capabilities){
 capability.verification=capability.verification.map(file=>exactMoves.get(file)??file);
}
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync('.scratch/feature-migration/browser-chat-test-moves.json',JSON.stringify({moves,environments},null,2)+'\n');
console.log({moves:result.moves.length,repairs:result.changes.length,node:nodeTests.length-1,dom:movedDom.length});
