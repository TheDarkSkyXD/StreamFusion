import fs from 'node:fs';
import path from 'node:path';
import ts from '../../node_modules/typescript/lib/typescript.js';
const methodMap=JSON.parse(fs.readFileSync('.scratch/feature-migration/storage-method-map.json','utf8'));
const followMethods=JSON.parse(fs.readFileSync('.scratch/feature-migration/follow-method-map.json','utf8'));
const changed=[];
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]);}
for(const file of [...files('apps/desktop/src'),...files('apps/desktop/tests')]){
 let text=fs.readFileSync(file,'utf8'),before=text; const norm=file.replaceAll('\\','/');
 if(norm.includes('/services/storage-service.ts')||norm.includes('/services/database-service.ts')||norm.includes('/data/authentication-repository.ts')||norm.includes('/data/preferences-repository.ts')||norm.includes('/data/persistent-store-schema.ts')||norm.includes('/data/legacy-store-migration.ts')||norm.includes('/data/follow-repository.ts')) continue;
 const added=new Map();
 // Single-owner files can migrate the complete import and mock together.
 const methodRefs=[...text.matchAll(/storageService\.(\w+)/g)].map(m=>m[1]);
 const owners=new Set(methodRefs.map(m=>methodMap[m]?.[0]??'storageService'));
 if(norm.endsWith('kick-rate-limit-guard.ts'))owners.add('kickContinuityRepository');
 if(owners.size===1&&!owners.has('storageService')){
  const owner=[...owners][0], module=Object.values(methodMap).find(v=>v[0]===owner)[1];
  text=text.replace(/(["'])[^"']*services\/storage-service\1/g,JSON.stringify(module)).replace(/\bstorageService\b/g,owner);
 }else{
  // Duplicate the mock factory per feature, preserving assertions against its own instance.
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const edits=[];
  function walk(n){
   if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['mock','doMock'].includes(n.expression.name.text)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text.endsWith('/services/storage-service')&&n.arguments[1]){
    const factory=n.arguments[1].getText(ast);
    const factoryOwners=new Set(Object.keys(methodMap).filter(m=>new RegExp('\\b'+m+'\\s*[:(]').test(factory)).map(m=>methodMap[m][0]));
    for(const owner of factoryOwners){const module=Object.values(methodMap).find(v=>v[0]===owner)[1];edits.push({pos:n.end,text:';\nvi.'+n.expression.name.text+'('+JSON.stringify(module)+', '+factory.replace(/\bstorageService\b/g,owner)+')'});}
   }
   ts.forEachChild(n,walk);
  }walk(ast);
  for(const e of edits.sort((a,b)=>b.pos-a.pos))text=text.slice(0,e.pos)+e.text+text.slice(e.pos);
  for(const [method,[owner,module]] of Object.entries(methodMap)){
   const re=new RegExp('\\bstorageService\\.'+method+'\\b','g');
   if(re.test(text)){text=text.replace(re,owner+'.'+method);added.set(owner,module);}
   const spy=new RegExp('\\bstorageService(?=\\s*,\\s*["\']'+method+'["\'])','g');
   if(spy.test(text)){text=text.replace(spy,owner);added.set(owner,module);}
  }
 }
 // Database follow operations and mocks move to the follow repository.
 if(text.includes('database-service')){
  const refs=[...text.matchAll(/dbService\.(\w+)/g)].map(m=>m[1]);
  if(refs.length&&refs.every(m=>followMethods.includes(m))&&!/DatabaseService/.test(text)){
   text=text.replace(/(["'])[^"']*services\/database-service\1/g,'"@backend/features/authentication/data/follow-repository"').replace(/\bdbService\b/g,'followRepository');
  }else{
   const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const edits=[];
   function walk(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['mock','doMock'].includes(n.expression.name.text)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text.endsWith('/services/database-service')&&n.arguments[1]){const factory=n.arguments[1].getText(ast);if(followMethods.some(m=>new RegExp('\\b'+m+'\\s*[:(]').test(factory)))edits.push({pos:n.end,text:';\nvi.'+n.expression.name.text+'("@backend/features/authentication/data/follow-repository", '+factory.replace(/\bdbService\b/g,'followRepository')+')'});}ts.forEachChild(n,walk);}walk(ast);
   for(const e of edits.sort((a,b)=>b.pos-a.pos))text=text.slice(0,e.pos)+e.text+text.slice(e.pos);
   for(const method of followMethods){const re=new RegExp('\\bdbService\\.'+method+'\\b','g');if(re.test(text)){text=text.replace(re,'followRepository.'+method);added.set('followRepository','@backend/features/authentication/data/follow-repository');}}
  }
  text=text.replace(/import type \{([^}]*PendingFollow[^}]*)\} from ["'][^"']*database-service["'];/g,'import type {$1} from "@backend/features/authentication/data/follow-repository";');
 }
 for(const [owner,module] of added){if(!new RegExp('import\\s*\\{[^}]*\\b'+owner+'\\b').test(text))text='import { '+owner+' } from "'+module+'";\n'+text;}
 if(text!==before){fs.writeFileSync(file,text);changed.push(norm);}
}
fs.writeFileSync('.scratch/feature-migration/storage-caller-files.json',JSON.stringify(changed,null,2));
console.log('Updated',changed.length,'caller files');
