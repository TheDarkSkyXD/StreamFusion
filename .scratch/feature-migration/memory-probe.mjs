import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
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
 await call('Performance.enable');
 if(process.argv.includes('--gc'))await call('HeapProfiler.collectGarbage');
 const [dom,heap,metrics,frameTree]=await Promise.all([call('Memory.getDOMCounters'),call('Runtime.getHeapUsage'),call('Performance.getMetrics'),call('Page.getFrameTree')]);
 const frames=[];const visit=f=>{frames.push({id:f.frame.id,origin:f.frame.securityOrigin});for(const child of f.childFrames??[])visit(child);};visit(frameTree.frameTree);
 console.log(JSON.stringify({at:new Date().toISOString(),gc:process.argv.includes('--gc'),dom,heap,frames,metrics:Object.fromEntries(metrics.metrics.filter(m=>['Documents','Frames','JSEventListeners','Nodes','LayoutCount','RecalcStyleCount','JSHeapUsedSize','JSHeapTotalSize'].includes(m.name)).map(m=>[m.name,m.value]))}));
} finally {socket.close();}
