import fs from 'node:fs';
const run=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const targets=await(await fetch(`http://127.0.0.1:${run.port}/json/list`)).json();
const target=targets.find(t=>t.type==='page'&&t.title==='StreamFusion');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>socket.addEventListener('open',r,{once:true}));
let id=0;const requests=new Map();
const redacted=v=>JSON.parse(JSON.stringify(v,(k,value)=>typeof value==='string'?value.replace(/(?:https?|twitch-clip-media):[^\s"<>]+/g,'[media URL]'):value));
socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method?.startsWith('Media.')) console.log(JSON.stringify(redacted(m)));if(m.id){requests.get(m.id)?.(m.result);requests.delete(m.id);}});
const call=(method,params={})=>new Promise(r=>{requests.set(++id,r);socket.send(JSON.stringify({id,method,params}));});
await call('Media.enable');
for(let step=0;step<5;step++){
 const result=await call('Runtime.evaluate',{expression:"Array.from(document.querySelectorAll('video')).map(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,network:v.networkState,duration:v.duration,buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]),seekable:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)]),quality:v.getVideoPlaybackQuality(),error:v.error?{code:v.error.code,message:v.error.message}:null}))",returnByValue:true});
 console.log(JSON.stringify({step,result:redacted(result)}));
 if(step<4)await new Promise(r=>setTimeout(r,4000));
}
await call('Media.disable');socket.close();
