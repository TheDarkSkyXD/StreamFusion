import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const run=process.argv[2];
const cli='.agents/skills/verify-streamfusion/scripts/control.mjs';
function drive(...args){const result=execFileSync(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args,'--run',run],{encoding:'utf8'});console.log(JSON.stringify({args,result:JSON.parse(result)}));}
drive('click','--role','link','--name','Following');
drive('wait','--hash','/following');
drive('click','--role','button','--name','Twitch');
for(const name of ['Videos','Clips','Categories','Channels']){
 drive('click','--role','button','--name',name);
 const expression=`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(name)}&&e.className.includes('after:bg-white'))&&!document.querySelector('div.animate-pulse')`;
 fs.writeFileSync('.scratch/feature-migration/following-settle.json',JSON.stringify([{wait:expression,timeout:20000}]));
 try{console.log(execFileSync(process.execPath,['.scratch/feature-migration/cdp-audit.mjs',run,'.scratch/feature-migration/following-settle.json'],{encoding:'utf8'}));}catch{console.log(`Provider/loading state retained for ${name}`);}
 drive('snapshot','--output',`following-${name.toLowerCase()}-settled.json`);
 drive('screenshot','--output',`following-${name.toLowerCase()}-settled.png`);
}
