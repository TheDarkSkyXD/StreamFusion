import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const run=process.argv[2];
const cli='.agents/skills/verify-streamfusion/scripts/control.mjs';
function drive(...args){return JSON.parse(execFileSync(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args,'--run',run],{encoding:'utf8'}));}
drive('evaluate','--expression',"location.hash='/search?q=bobross'");
drive('wait','--text','Search Results');
drive('click','--role','button','--name','Clips');
drive('wait','--text','Grey Mountains','--timeout','30000');
const before=drive('snapshot','--output','compiled-clips-before.json');
const snap=JSON.parse(fs.readFileSync(before.output,'utf8'));
const clip=snap.elements.find(e=>e.role==='button'&&e.name.includes('Grey Mountains'));
if(!clip)throw new Error('Grey Mountains card unavailable');
console.log(drive('click','--role','button','--name',clip.name));
drive('wait','--text','Viewing clip: Grey Mountains');
console.log(execFileSync(process.execPath,['.scratch/feature-migration/clip-media-events.mjs',run],{encoding:'utf8'}));
console.log(drive('screenshot','--output','compiled-clip-after.png'));
console.log(drive('snapshot','--output','compiled-clip-after.json'));
