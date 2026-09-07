const fs=require('node:fs'),ts=require('typescript');
const files=JSON.parse(fs.readFileSync('.scratch/feature-migration/provider-callers.json','utf8')).filter(f=>f.includes('test'));
const membership=JSON.parse(fs.readFileSync('.scratch/feature-migration/provider-membership.json','utf8'));
function moduleFor(p,f) {return f==='transport'?`@backend/api/platforms/${p}/${p}-transport`:`@backend/features/${f}/composition/${p}-${f==='authentication'?'account-reader':f}`;}
function symbol(p,f) {return p+({discovery:'Discovery',playback:'Playback',authentication:'AccountReader',transport:'Transport'}[f]);}
for(const file of files){
 let source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const changes=[];
 for(const statement of ast.statements){
  if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
  const call=statement.expression;
  if(call.expression.getText(ast)!=='vi.mock')continue;
  const spec=call.arguments[0]?.text;
  const provider=['twitch','kick'].find(p=>spec===moduleFor(p,'discovery')||spec===moduleFor(p,'transport')||spec===moduleFor(p,'playback')||spec===moduleFor(p,'authentication'));
  if(!provider)continue;
  const callback=call.arguments[1];if(!callback||!ts.isArrowFunction(callback))continue;
  let body=callback.body;if(ts.isParenthesizedExpression(body))body=body.expression;
  if(!ts.isObjectLiteralExpression(body))continue;
  const prop=body.properties.find(p=>p.name?.getText(ast).startsWith(provider));if(!prop)continue;
  let init=ts.isPropertyAssignment(prop)?prop.initializer:prop.name;
  const groups=new Map();
  if(ts.isObjectLiteralExpression(init)) {
   for(const field of init.properties){const name=field.name?.getText(ast).replaceAll('"','');const owner=membership[provider][name]||'discovery';if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(field.getText(ast));}
  } else {
   for(const f of ['discovery','authentication','playback','transport'])groups.set(f,init.getText(ast));
  }
  const result=[...groups].map(([feature,fields])=>`vi.mock(${JSON.stringify(moduleFor(provider,feature))}, () => ({ ${symbol(provider,feature)}: ${Array.isArray(fields)?'{'+fields.join(',\n')+'}':fields} }));`).join('\n');
  changes.push({start:statement.getStart(ast),end:statement.end,text:result});
 }
 for(const c of changes.reverse())source=source.slice(0,c.start)+c.text+source.slice(c.end);
 fs.writeFileSync(file,source);
}
