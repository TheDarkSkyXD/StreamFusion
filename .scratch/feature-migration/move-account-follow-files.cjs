const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),cp=require('node:child_process');
const b='apps/desktop/src/backend/features/';
const map=new Map([
 [`${b}discovery/adapters/kick/follow-endpoints.ts`,`${b}authentication/adapters/kick/follow-endpoints.ts`],
 [`${b}discovery/adapters/twitch/follow-endpoints.ts`,`${b}authentication/adapters/twitch/follow-endpoints.ts`],
 [`${b}discovery/utils/kick-follow-grid-predicate.ts`,`${b}authentication/utils/kick-follow-grid-predicate.ts`],
 [`${b}discovery/tests/api/platforms/kick/follow-endpoints.test.ts`,`${b}authentication/tests/api/platforms/kick/follow-endpoints.test.ts`],
 [`${b}discovery/tests/api/platforms/twitch/follow-endpoints.test.ts`,`${b}authentication/tests/api/platforms/twitch/follow-endpoints.test.ts`],
 [`${b}discovery/tests/api/platforms/kick/follow-grid-predicate.test.ts`,`${b}authentication/tests/api/platforms/kick/follow-grid-predicate.test.ts`],
]);
const absMap=new Map([...map].map(([a,b])=>[path.resolve(a).replaceAll('\\','/'),path.resolve(b).replaceAll('\\','/')]));
const files=cp.execFileSync('rg',['--files','apps/desktop','--glob','*.ts','--glob','*.tsx','--glob','*.mjs'],{encoding:'utf8'}).trim().split(/\r?\n/);
for(const file of files){
 let source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const edits=[];
 const current=path.resolve(file).replaceAll('\\','/');const moved=absMap.get(current);const newFile=moved||current;
 function visit(n){
  if(ts.isStringLiteral(n)){
   const spec=n.text;let target;
   if(spec.startsWith('@backend/'))target=path.resolve('apps/desktop/src/backend',spec.slice(9));
   else if(spec.startsWith('.'))target=path.resolve(path.dirname(current),spec);
   if(target){target=target.replaceAll('\\','/');const found=absMap.get(target)||absMap.get(target+'.ts');
    if(found||(moved&&spec.startsWith('.'))){const to=found||target;const srcRoot=path.resolve('apps/desktop/src/backend').replaceAll('\\','/');let replacement=to.startsWith(srcRoot+'/')?'@backend/'+to.slice(srcRoot.length+1).replace(/\.ts$/,''):path.relative(path.dirname(newFile),to).replaceAll('\\','/');if(!replacement.startsWith('@')&&!replacement.startsWith('.'))replacement='./'+replacement;edits.push({start:n.getStart(ast),end:n.end,text:JSON.stringify(replacement)});}
   }
  } ts.forEachChild(n,visit);
 }visit(ast);
 for(const e of edits.reverse())source=source.slice(0,e.start)+e.text+source.slice(e.end);
 for(const [old,to] of map)source=source.replaceAll(old.replace('apps/desktop/',''),to.replace('apps/desktop/',''));
 if(edits.length||moved||source!==fs.readFileSync(file,'utf8')){fs.mkdirSync(path.dirname(newFile),{recursive:true});fs.writeFileSync(newFile,source);}
}
for(const old of map.keys())fs.unlinkSync(old);
fs.writeFileSync('.scratch/feature-migration/account-follow-moves.json',JSON.stringify([...map].map(([from,to])=>({from,to})),null,2));
