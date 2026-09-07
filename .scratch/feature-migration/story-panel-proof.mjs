import {execFileSync} from 'node:child_process';
import path from 'node:path';
const binary='C:/Users/Admin/AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe';
const session='sf-mod-panels-proof';
const dir=path.resolve('.scratch/feature-migration');
function drive(...args){const result=execFileSync(binary,['--session',session,...args],{encoding:'utf8',timeout:45000});console.log(JSON.stringify({args,result}));return result;}
try {
 for(const [story,label] of [['activity','Activity Feed'],['suspicious','Suspicious Activity'],['whispers','Whispers'],['community','Community'],['rewards','Reward Requests'],['permission','Connect Twitch'],['error','unavailable'],['loading','Connecting'],['empty','No events']]){
  drive('open',`http://localhost:6130/iframe.html?id=pages-moderation-workspace-newpanels--${story}&viewMode=story`);
  try{drive('wait','--text',label);}catch{console.log(`Expected text absent: ${label}`);}
  drive('snapshot');
  drive('screenshot',path.join(dir,`mod-story-${story}.png`));
  drive('errors');
 }
}finally{drive('close');}
