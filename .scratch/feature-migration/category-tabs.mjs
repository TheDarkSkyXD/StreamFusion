import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const run=process.argv[2];
const cli='.agents/skills/verify-streamfusion/scripts/control.mjs';
const drive=(...args)=>JSON.parse(execFileSync(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args,'--run',run],{encoding:'utf8'}));
drive('click','--role','link','--name','Twitch');
for(const name of ['Live Streams','Videos','Clips']){
 drive('click','--role','link','--name',name);
 const tab=name==='Live Streams'?'live':name.toLowerCase();
 fs.writeFileSync('.scratch/feature-migration/category-settle.json',JSON.stringify([{wait:`location.hash.includes('tab=${tab}')&&!document.querySelector('div.animate-pulse')`,timeout:20000}]));
 try{execFileSync(process.execPath,['.scratch/feature-migration/cdp-audit.mjs',run,'.scratch/feature-migration/category-settle.json'],{encoding:'utf8'});}catch{console.log(`Unsettled ${name}`);}
 const snap=drive('snapshot','--output',`compiled-category-${tab}.json`);
 console.log(JSON.stringify({tab,text:JSON.parse(fs.readFileSync(snap.output,'utf8')).text.slice(-1600),screenshot:drive('screenshot','--output',`compiled-category-${tab}.png`).output}));
}
