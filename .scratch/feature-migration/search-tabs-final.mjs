import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const run=process.argv[2];
const cli='.agents/skills/verify-streamfusion/scripts/control.mjs';
function drive(...args){return JSON.parse(execFileSync(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args,'--run',run],{encoding:'utf8'}));}
drive('evaluate','--expression',"location.hash='/search?q=bobross'");
drive('wait','--text','Search Results');
for(const name of ['All','Channels','Streams','Videos','Clips','Categories']){
 drive('click','--role','button','--name',name);
 const expression=`location.hash.includes('/search')&&Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(name)}&&e.className.includes('font-bold'))&&!document.querySelector('div.animate-pulse')`;
 fs.writeFileSync('.scratch/feature-migration/search-settle.json',JSON.stringify([{wait:expression,timeout:20000}]));
 try{execFileSync(process.execPath,['.scratch/feature-migration/cdp-audit.mjs',run,'.scratch/feature-migration/search-settle.json'],{encoding:'utf8'});}catch{console.log(`Loading state retained for ${name}`);}
 const snap=drive('snapshot','--output',`search-${name.toLowerCase()}-final.json`);
 console.log(JSON.stringify({tab:name,text:JSON.parse(fs.readFileSync(snap.output,'utf8')).text.split('Search Results')[1],screenshot:drive('screenshot','--output',`search-${name.toLowerCase()}-final.png`).output}));
}
