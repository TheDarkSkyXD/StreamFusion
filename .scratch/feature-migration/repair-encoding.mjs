import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const args=process.argv.slice(2);
const apply=args.includes('--apply');
const maps=['desktop-combined-moves.json','backend-map.json','renderer-final-moves.json','central-test-ownership-applied.json','playback-root-moves.json'];
const moves=new Map();
for (const file of maps) {
 const raw=JSON.parse(fs.readFileSync('.scratch/feature-migration/'+file,'utf8'));
 const entries=Array.isArray(raw)?raw:raw.moves;
 for(const m of entries??[]) moves.set(m.from,m.to);
}
function target(file){const seen=new Set();while(moves.has(file)&&!seen.has(file)){seen.add(file);file=moves.get(file);}return file;}
const oldFiles=execFileSync('git',['ls-tree','-rz','HEAD','apps/desktop/src','apps/desktop/tests'],{maxBuffer:10_000_000}).toString('utf8').split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');return {hash:meta.split(' ')[2],path}}).filter(f=>/\.(?:ts|tsx|md)$/.test(f.path));
const blobOutput=execFileSync('git',['cat-file','--batch'],{input:oldFiles.map(f=>f.hash).join('\n')+'\n',maxBuffer:50_000_000});
const decoder=new TextDecoder('windows-1252');
let offset=0;const changes=[];
for(const f of oldFiles){
 const end=blobOutput.indexOf(10,offset);const size=Number(blobOutput.subarray(offset,end).toString().split(' ')[2]);offset=end+1;
 const before=blobOutput.subarray(offset,offset+size).toString('utf8');offset+=size+1;
 const dest=target(f.path);if(!fs.existsSync(dest))continue;
 const text=fs.readFileSync(dest,'utf8');const corrections=new Map();
 for(const line of before.split(/\r?\n/)){if(!/[^\x00-\x7f]/.test(line))continue;let corrupted=line;for(let attempt=0;attempt<2;attempt++){corrupted=decoder.decode(Buffer.from(corrupted,'utf8'));if(corrupted!==line)corrections.set(corrupted,line);}}
 const repaired=text.split(/\r?\n/).map(line=>corrections.get(line)??line).join(text.includes('\r\n')?'\r\n':'\n');
 if(repaired===text)continue;
 const lines=text.split(/\r?\n/).filter(line=>corrections.has(line));
 if(lines.length===0)continue;
 changes.push({file:dest,lines:lines.length,examples:lines.slice(0,2)});
 if(apply)fs.writeFileSync(dest,repaired);
}
fs.writeFileSync('.scratch/feature-migration/encoding-repairs.json',JSON.stringify(changes,null,2)+'\n');
console.log(JSON.stringify({apply,files:changes.length,lines:changes.reduce((n,f)=>n+f.lines,0),changes},null,2));
