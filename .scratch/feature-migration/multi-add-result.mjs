import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const run=process.argv[2];
const snap=JSON.parse(fs.readFileSync('.scratch/verify-streamfusion/evidence/compiled-audit-20260906/compiled-multi-foreground.json','utf8'));
const result=snap.elements.find(e=>e.name.startsWith('BobRosstwitch'));
if(!result)throw new Error('Observed result missing');
console.log(execFileSync(process.execPath,['--disable-warning=ExperimentalWarning','.agents/skills/verify-streamfusion/scripts/control.mjs','click','--run',run,'--role',result.role,'--name',result.name],{encoding:'utf8'}));
