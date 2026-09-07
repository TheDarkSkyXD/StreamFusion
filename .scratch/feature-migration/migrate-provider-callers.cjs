const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
const membership=JSON.parse(fs.readFileSync('.scratch/feature-migration/provider-membership.json','utf8'));
const files=cp.execFileSync('rg',['-l','platforms/(kick/kick-client|twitch/twitch-client)','apps/desktop','--glob','*.ts','--glob','*.tsx'],{encoding:'utf8'}).trim().split(/\r?\n/);
function moduleFor(p,f) {return f==='transport'?`@backend/api/platforms/${p}/${p}-transport`:`@backend/features/${f}/composition/${p}-${f==='authentication'?'account-reader':f}`;}
function symbol(p,f) {return p+({discovery:'Discovery',playback:'Playback',authentication:'AccountReader',transport:'Transport'}[f]);}
for(const file of files) {
 let text=fs.readFileSync(file,'utf8');
 for(const p of ['twitch','kick']) {
  if(!text.includes(`${p}/${p}-client`))continue;
  let feature='discovery';
  if(/kick-client-(image|cdn)|kick-image-protocol|twitch-eventsub-feed-service/.test(file))feature='transport';
  if(/video-(routes|handlers)/.test(file))feature='playback';
  if(/twitch-follow-write-service/.test(file))feature='authentication';
  if(/kick-client\.test/.test(file))feature='transport';
  const oldSymbol=p+'Client',defaultSymbol=symbol(p,feature),additional=new Set();
  text=text.replace(new RegExp(`(["'])([^"']*platforms/${p}/${p}-client)\\1`,'g'),(_all,q)=>q+moduleFor(p,feature)+q);
  text=text.replace(new RegExp(`\\b${oldSymbol}\\b`,'g'),defaultSymbol);
  text=text.replace(new RegExp(`\\b${defaultSymbol}\\.(\\w+)`,'g'),(all,method)=>{
   let owner=membership[p][method];
   if(feature==='transport'&&method==='isAuthenticated'&&p==='kick')owner='transport';
   if(!owner||owner===feature)return all;
   additional.add(owner); return symbol(p,owner)+'.'+method;
  });
  text=text.replace(new RegExp(`(spyOn\\(|Reflect\\.set\\()${defaultSymbol},\\s*(["'])(\\w+)\\2`,'g'),(all,prefix,q,method)=>{
   const owner=membership[p][method];if(!owner||owner===feature)return all;
   additional.add(owner);return prefix+symbol(p,owner)+', '+q+method+q;
  });
  for(const f of additional)text=`import { ${symbol(p,f)} } from "${moduleFor(p,f)}";\n`+text;
 }
 fs.writeFileSync(file,text);
}
fs.writeFileSync('.scratch/feature-migration/provider-callers.json',JSON.stringify(files,null,2));
