const fs=require('node:fs');
const file='.scratch/feature-migration/backend-map.json';
const map=JSON.parse(fs.readFileSync(file,'utf8'));
const moves=JSON.parse(fs.readFileSync('.scratch/feature-migration/account-follow-moves.json','utf8'));
for(const move of moves){const recorded=map.moves.find(m=>m.to===move.from);if(recorded)recorded.to=move.to;}
for(const provider of ['kick','twitch']){
 const old=`apps/desktop/src/backend/api/platforms/${provider}/${provider}-client.ts`;
 map.retained=map.retained.filter(r=>r.path!==old);
 const split=map.splits.find(s=>s.from===old);
 split.status='completed';
 split.outputs=[
  {to:`apps/desktop/src/backend/api/platforms/${provider}/${provider}-transport.ts`,responsibility:'Shared authenticated request transport; Kick also retains CDN session and image-byte request policy.'},
  ...['discovery','playback','authentication'].map(feature=>({to:`apps/desktop/src/backend/features/${feature}/adapters/${provider}/${provider}-${feature==='authentication'?'account-reader':feature+'-reader'}.ts`,responsibility:`${feature} provider capability implementation. Feature composition creates its instance with shared request transport.`}))
 ];
 split.evidence={typecheck:'Desktop TypeScript passed.',tests:'20 suites / 451 tests passed; account-follow relocation 6 suites / 170 tests and DOM predicate 6 tests passed.',lint:'Scoped provider modules and callers passed ESLint.',legacyImports:0};
 const transport=split.outputs[0].to;
 if(!map.retained.some(r=>r.path===transport))map.retained.push({path:transport,reason:'Cross-feature authenticated request/session infrastructure only.'});
}
map.generatedFrom.completed.actualSplits.push('Kick and Twitch client facades removed; discovery, playback and account-follow readers separately composed','Signed-in identity and account-follow endpoints owned by authentication','Search dependencies separate channel discovery from recorded-content readers');
fs.writeFileSync(file,JSON.stringify(map,null,2)+'\n');
const how='.scratch/feature-migration/backend-how.md';
let text=fs.readFileSync(how,'utf8');
text=text.replace('provider client facades still need request/credential ports before they can be\nseparated safely, ','');
text+=`\n## Provider client ownership completed\n\nThe former KickClient and TwitchClient modules are deleted. Their callers use\nfeature-owned discovery, playback and account readers. Kick request retry, rate\nlimits, token refresh, isolated CDN session, binary response limits and image\ncaches remain in kick-transport. Twitch endpoints consume the narrow\nTwitchHelixRequestPort. Their shared TwitchRequestor retains request policy.\n\nAuthentication owns the signed-in user and account-follow endpoint implementations\nand the Kick followed-page predicate. The predicate's DOM test moved with it,\nand its explicit Vitest environment path was updated. Search now receives\ndiscovery and recorded-content readers separately. Channel routes receive the\nTwitch account-follow reader separately. No removed client path has a re-export\nor a production caller.\n\nVerification passed for desktop TypeScript, scoped ESLint, 451 provider and\ncaller tests, 170 follow and reader tests, and six DOM predicate tests. Some\nreader tests remain in the cross-feature transport test directory because each\nsuite verifies multiple feature adapters with the shared request transport.\n\nThe separate GraphQL endpoint extraction is assigned to the integration agent.\nIt remains explicit work until its request transport and discovery/playback\nendpoint modules have been separated and verified.\n`;
fs.writeFileSync(how,text);
