const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
const backend = 'apps/desktop/src/backend';
const created = [];
const membership = {};
function write(file, text) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,text); created.push(file); }
function relocate(text, old) {
  return text.replace(/(["'])(\.{1,2}\/[^"']+)\1/g, (all,q,spec) => {
    const resolved = path.resolve(path.dirname(old),spec).replaceAll('\\','/');
    const source = path.resolve('apps/desktop/src').replaceAll('\\','/');
    return resolved.startsWith(source+'/') ? q+'@'+resolved.slice(source.length+1)+q : all;
  });
}
for (const provider of ['twitch','kick']) {
  const cap = provider[0].toUpperCase()+provider.slice(1);
  const old = `${backend}/api/platforms/${provider}/${provider}-client.ts`;
  const source = fs.readFileSync(old,'utf8');
  fs.writeFileSync(`.scratch/feature-migration/${provider}-client.before.ts`,source);
  const ast = ts.createSourceFile(old,source,ts.ScriptTarget.Latest,true);
  const cls = ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name.text===cap+'Client');
  const imports = ast.statements.filter(ts.isImportDeclaration).map(s=>s.getText(ast)).join('\n');
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  const account = new Set(['getUser','getFollowedChannels','getAllFollowedChannels','readAccountFollows']);
  const playback = new Set(cls.members.filter(m=>m.name && /Video|Clip/.test(m.name.getText(ast))).map(m=>m.name.getText(ast)));
  const transport = new Set(provider==='kick' ? cls.members.slice(0,cls.members.findIndex(m=>m.name?.getText(ast)==='getUser')).map(m=>m.name?.getText(ast)) : ['request']);
  transport.delete('platform');
  membership[provider] = {};
  for(const m of cls.members) { const name=m.name?.getText(ast); membership[provider][name] = account.has(name)?'authentication':playback.has(name)?'playback':transport.has(name)?'transport':'discovery'; }
  membership[provider].request='transport';
  membership[provider].isAuthenticated='discovery';
  const allMembers=cls.members.map(m=>({name:m.name?.getText(ast),text:m.getText(ast)}));
  for (const feature of ['discovery','authentication','playback',...(provider==='kick'?['transport']:[])]) {
    const label = feature==='authentication'?'AccountReader':feature==='transport'?'Transport':feature[0].toUpperCase()+feature.slice(1);
    const className=cap+label;
    const singleton=provider+label;
    let members=allMembers.filter(m=>feature==='transport'?transport.has(m.name):membership[provider][m.name]===feature && m.name!=='platform');
    if(provider==='kick' && feature==='discovery') members=[{name:'isAuthenticated',text:'isAuthenticated(): boolean { return this.requestor.isAuthenticated(); }'},...members.filter(m=>m.name!=='isAuthenticated')];
    const cross = new Set();
    let body=members.map(m=>m.text).join('\n\n');
    if(feature!=='transport') {
      body=body.replace(/\(this(?=[,)])/g,'(this.requestor');
      body=body.replace(/this\.(\w+)/g,(all,name)=>{
        if(name==='requestor'||members.some(m=>m.name===name)) return all;
        if(membership[provider][name]==='discovery') { cross.add(name); return `this.discovery.${name}`; }
        if(name==='request') return 'this.requestor.request';
        return all;
      });
    }
    const helperNames=feature==='playback' ? (provider==='kick'?functions.map(f=>f.name.text):['normalizedTimestamp','normalizeVideoForCore','normalizeClipForCore','orderCategoryVideos']) : feature==='discovery'&&provider==='twitch'?['mergeCategoryViewerCounts','toTwitchPageOptions','toTwitchChannelSearchOptions']:[];
    let helpers=functions.filter(f=>helperNames.includes(f.name.text)).map(f=>f.getText(ast)).join('\n\n');
    if(feature==='discovery'&&provider==='twitch') helpers=ast.statements.filter(s=>s.getText(ast).startsWith('export type TwitchFollowedStreamAccess')||s.getText(ast).startsWith('const TWITCH_STREAM_LANGUAGES')).map(s=>s.getText(ast)).join('\n')+'\n'+helpers;
    if(feature==='transport') helpers=ast.statements.filter(s=>(ts.isClassDeclaration(s)&&s.name.text==='KickRateLimiter')||(ts.isVariableStatement(s)&&!s.getText(ast).includes('new KickClient'))|| (ts.isInterfaceDeclaration(s)&&s.name.text==='KickImageBytes')).map(s=>s.getText(ast)).join('\n\n');
    const adapterPath=feature==='transport'?`${backend}/api/platforms/kick/kick-transport.ts`:`${backend}/features/${feature}/adapters/${provider}/${provider}-${feature==='authentication'?'account-reader':feature+'-reader'}.ts`;
    let extra='';
    let constructor='';
    if(feature!=='transport') {
      const port=provider==='kick'?'KickRequestor':'TwitchHelixRequestPort';
      extra+=`import type { ${port} } from '@backend/api/platforms/${provider}/${provider}-${provider==='kick'?'requestor':'transport'}';\n`;
      let args=`private readonly requestor: ${port}`;
      if(cross.size) {
        extra+=`import type { ${cap}Discovery } from '@backend/features/discovery/adapters/${provider}/${provider}-discovery-reader';\n`;
        args+=`, private readonly discovery: Pick<${cap}Discovery, ${[...cross].map(n=>JSON.stringify(n)).join(' | ')}>`;
      }
      constructor=`constructor(${args}) {}\n`;
    }
    const contracts = feature==='discovery'?'IPlatformReader<UnifiedStream>, ChannelReader<Platform, UnifiedChannel, ChannelRef>, CategoryReader<Platform, UnifiedCategory>, CategoryStreamReader<Platform, UnifiedStream>, DiscoverySearchReader<Platform, UnifiedStream, UnifiedChannel, UnifiedCategory, AbortSignal>':feature==='playback'?'VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal>, ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>':feature==='authentication'?`AccountFollowReader<'${provider}', UnifiedChannel>, FollowedChannelReader<'${provider}', UnifiedChannel>`:'KickRequestor';
    write(adapterPath,relocate(imports+'\n'+extra+'\n'+helpers+`\n\nexport class ${className} implements ${contracts} {\n`+(feature==='transport'?'':`readonly platform = '${provider}' as const;\n`)+constructor+body+`\n}\n`+(feature==='transport'?`export const ${singleton} = new ${className}();\n`:''),old));
    if(feature!=='transport') {
      let composition=`import { ${className} } from '../adapters/${provider}/${provider}-${feature==='authentication'?'account-reader':feature+'-reader'}';\nimport { ${provider}Transport } from '@backend/api/platforms/${provider}/${provider}-transport';\n`;
      if(cross.size) composition+=`import { ${provider}Discovery } from '@backend/features/discovery/composition/${provider}-discovery';\n`;
      composition+=`export const ${singleton} = new ${className}(${provider}Transport${cross.size?', '+provider+'Discovery':''});\n`;
      write(`${backend}/features/${feature}/composition/${provider}-${feature==='authentication'?'account-reader':feature}.ts`,composition);
    }
  }
}
fs.writeFileSync('.scratch/feature-migration/provider-membership.json',JSON.stringify(membership,null,2));
fs.writeFileSync('.scratch/feature-migration/provider-created.json',JSON.stringify(created,null,2));
