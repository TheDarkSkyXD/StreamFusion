const fs=require('node:fs'),ts=require('typescript'),cp=require('node:child_process'),path=require('node:path');
const created=JSON.parse(fs.readFileSync('.scratch/feature-migration/provider-created.json','utf8'));
for(const provider of ['twitch','kick']){
 const old=`apps/desktop/src/backend/features/discovery/adapters/${provider}/user-endpoints.ts`;
 const dest=`apps/desktop/src/backend/features/authentication/adapters/${provider}/account-endpoints.ts`;
 let source=fs.readFileSync(old,'utf8');const ast=ts.createSourceFile(old,source,ts.ScriptTarget.Latest,true);
 const names=new Set(provider==='twitch'?['getUser','getFollowedChannels','getAllFollowedChannels','fetchAllFollowedChannels','followedChannelScans']:['getUser']);
 const removed=new Set(['UserMutationRequestor','blockUser','unblockUser']);
 const name=s=>s.name?.text||(ts.isVariableStatement(s)?s.declarationList.declarations[0].name.getText(ast):undefined);
 const imports=ast.statements.filter(ts.isImportDeclaration).map(s=>s.getText(ast)).join('\n');
 const moved=ast.statements.filter(s=>names.has(name(s)));
 let output=imports+'\n'+moved.map(s=>s.getText(ast)).join('\n\n');
 const followNames=['getFollowedChannels','getAllFollowedChannels'];
 fs.writeFileSync(dest,output);created.push(dest,old);
 for(const s of ast.statements.filter(s=>names.has(name(s))||removed.has(name(s))).reverse())source=source.slice(0,s.getFullStart())+source.slice(s.end);
 fs.writeFileSync(old,source);
 const reader=`apps/desktop/src/backend/features/authentication/adapters/${provider}/${provider}-account-reader.ts`;
 fs.writeFileSync(reader,fs.readFileSync(reader,'utf8').replace(`@backend/features/discovery/adapters/${provider}/user-endpoints`,`./account-endpoints`));
 const files=cp.execFileSync('rg',['-l',`${provider}/user-endpoints`,'apps/desktop','--glob','*.ts'],{encoding:'utf8'}).trim().split(/\r?\n/);
 for(const file of files){
  if(file===old||file===dest||file.endsWith(`${provider}-client.ts`))continue;
  let text=fs.readFileSync(file,'utf8');const fileAst=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const edits=[];
  for(const s of fileAst.statements){
   if(!ts.isImportDeclaration(s)||!s.moduleSpecifier.text.endsWith(`${provider}/user-endpoints`))continue;
   const bindings=s.importClause?.namedBindings;
   if(!bindings||!ts.isNamedImports(bindings))continue;
   const account=bindings.elements.filter(e=>names.has(e.propertyName?.text||e.name.text));
   if(!account.length)continue;
   const retained=bindings.elements.filter(e=>!account.includes(e));
   const change=`import { ${account.map(e=>e.getText(fileAst)).join(', ')} } from '@backend/features/authentication/adapters/${provider}/account-endpoints';\n`+(retained.length?`import { ${retained.map(e=>e.getText(fileAst)).join(', ')} } from ${s.moduleSpecifier.getText(fileAst)};`:'');
   edits.push({start:s.getStart(fileAst),end:s.end,text:change});
  }
  for(const e of edits.reverse())text=text.slice(0,e.start)+e.text+text.slice(e.end);
  fs.writeFileSync(file,text);
 }
}
fs.writeFileSync('.scratch/feature-migration/provider-created.json',JSON.stringify([...new Set(created)],null,2));
