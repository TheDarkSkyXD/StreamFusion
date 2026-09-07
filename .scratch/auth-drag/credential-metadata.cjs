const {app,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');const isolated=path.join(__dirname,'metadata-profile');fs.mkdirSync(isolated,{recursive:true});
fs.copyFileSync(path.join(root,'.streamfusion-dev-user-data','Local State'),path.join(isolated,'Local State'));
app.setPath('userData',isolated); console.log=(value)=>fs.appendFileSync(path.join(__dirname,'credential-metadata.jsonl'),value+'\n');
app.whenReady().then(async()=>{
 const profile=path.join(root,'.streamfusion-dev-user-data');
 for(const name of fs.readdirSync(profile).filter(n=>n.startsWith('streamfusion-storage.json'))){
  try {const data=JSON.parse(fs.readFileSync(path.join(profile,name),'utf8'));const envelope=data.authTokens?.twitch;if(!envelope){console.log(JSON.stringify({file:name,tokenPresent:false}));continue;}
  const bytes=Buffer.from(envelope.encrypted,'base64');const token=JSON.parse(envelope.encoding==='base64'?bytes.toString('utf8'):safeStorage.decryptString(bytes));
  let status=null; if(name==='streamfusion-storage.json'){try{status=(await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+token.accessToken},signal:AbortSignal.timeout(12000)})).status;}catch{status='network-unavailable';}}
  console.log(JSON.stringify({file:name,modified:fs.statSync(path.join(profile,name)).mtime.toISOString(),expiresAt:token.expiresAt?new Date(token.expiresAt).toISOString():null,authFlow:token.authFlow,hasRefreshToken:!!token.refreshToken,scopeCount:token.scope?.length,validationStatus:status}));
  }catch{console.log(JSON.stringify({file:name,error:'Unable to inspect credential metadata'}));}
 }
 app.quit();
});
