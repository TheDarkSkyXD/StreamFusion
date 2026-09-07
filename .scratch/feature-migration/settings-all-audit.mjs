import fs from 'node:fs';
const groups = [
 ['General',['General']],
 ['Viewing',['Playback','Player controls','Buffer','Multiview']],
 ['Experience',['Notifications','Chat','Predictions']],
 ['Accounts & Network',['Ad-Block','Proxy','Integrations','API / Tokens']],
 ['System & Support',['Updates','Diagnostics','Logs','Report Bug','About']],
];
const steps=[];
for(const [group,tabs] of groups){
 steps.push(['click','--role','button','--name',`${group} settings section`]);
 for(const tab of tabs){
  const slug=tab.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  steps.push(['click','--role','link','--name',tab],['snapshot','--output',`settings-${slug}-audit.json`],['screenshot','--output',`settings-${slug}-audit.png`]);
 }
}
fs.writeFileSync('.scratch/feature-migration/settings-all-audit.json',JSON.stringify(steps,null,2)+'\n');
