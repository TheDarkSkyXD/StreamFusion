import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const steps=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const targets=await(await fetch(`http://127.0.0.1:${state.port}/json/list`)).json();
const target=targets.find(t=>t.type==='page'&&t.title==='StreamFusion');
if(!target)throw new Error('StreamFusion renderer is unavailable');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let id=0;
const pending=new Map();
socket.addEventListener('message',event=>{
 const response=JSON.parse(event.data);const task=pending.get(response.id);if(!task)return;
 pending.delete(response.id);clearTimeout(task.timeout);
 if(response.error)task.reject(new Error(response.error.message));else task.resolve(response.result);
});
function call(method,params={}){return new Promise((resolve,reject)=>{const requestId=++id;const timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error(`${method} timed out`));},15000);pending.set(requestId,{resolve,reject,timeout});socket.send(JSON.stringify({id:requestId,method,params}));});}
try {
 for(const step of steps){
  if(step.wait){
   const end=Date.now()+(step.timeout??15000);let result;
   do{
    result=await call('Runtime.evaluate',{expression:step.wait,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    if(result.result.value)break;
    await new Promise(resolve=>setTimeout(resolve,250));
   }while(Date.now()<end);
   console.log(JSON.stringify({wait:step.wait,matched:!!result.result.value}));
   if(!result.result.value)throw new Error('Visible UI condition timed out');
  }else{
   console.log(JSON.stringify({step,result:await call(step.method,step.params)}));
  }
 }
}finally{socket.close();}
