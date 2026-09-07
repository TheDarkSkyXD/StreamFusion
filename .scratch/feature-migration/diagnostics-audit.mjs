import fs from 'node:fs';
const steps=[];
for(const tab of ['Overview','Resources','I/O','Traces','Logs & Reports','Developer Tools']){
 const slug=tab.toLowerCase().replace(/[^a-z0-9]+/g,'-');
 steps.push(['click','--role','tab','--name',tab],['snapshot','--output',`diagnostics-${slug}.json`],['screenshot','--output',`diagnostics-${slug}.png`]);
}
fs.writeFileSync('.scratch/feature-migration/diagnostics-audit.json',JSON.stringify(steps,null,2)+'\n');
