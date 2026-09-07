import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const [runPath, label, action = 'capture', ...args] = process.argv.slice(2);
const run = JSON.parse(await readFile(runPath, 'utf8'));
const out = path.join(run.evidenceDir, label);
await mkdir(out, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${run.port}/json/list`).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title === 'StreamFusion');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0, dragData;
const requests = new Map(), errors = [];
socket.onmessage = ({data}) => {
  const message = JSON.parse(data);
  if (message.id) { const pending = requests.get(message.id); requests.delete(message.id); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
  else if (message.method === 'Input.dragIntercepted') dragData = message.params.data;
  else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; requests.set(key, {resolve,reject}); socket.send(JSON.stringify({id:key,method,params})); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', {expression, returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing element');const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const frame = () => call('Page.captureScreenshot',{format:'png'});
async function capture(name) {
  const state = await evaluate(`({url:location.href,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight},widgets:[...document.querySelectorAll('[data-widget-id]')].map(e=>({id:e.dataset.widgetId,rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()})),splitters:[...document.querySelectorAll('[role=separator]')].map(e=>({orientation:e.getAttribute('aria-orientation'),value:e.getAttribute('aria-valuenow')})),videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,ready:v.readyState,width:v.videoWidth,paused:v.paused,frames:v.getVideoPlaybackQuality().totalVideoFrames})),handles:[...document.querySelectorAll('[data-drag-handle=true]')].map(e=>e.closest('[data-widget-id]').dataset.widgetId),preview:[...document.querySelectorAll('.mod-workspace-drop-preview')].map(e=>({color:getComputedStyle(e).borderColor,rect:e.getBoundingClientRect().toJSON()})),layout:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('streamfusion:mod-layout:'))),horizontalOverflow:document.documentElement.scrollWidth>innerWidth})`);
  await writeFile(path.join(out, `${name}.json`), JSON.stringify(state,null,2));
  const shot = await call('Page.captureScreenshot', {format:'png'});
  await writeFile(path.join(out,`${name}.png`), Buffer.from(shot.data,'base64'));
  return state;
}
try {
  await call('Page.bringToFront'); await call('Runtime.enable');
  await frame();
  const before = await capture('before');
  const identities = [];
  for (const selector of ['[data-widget-id="video"]','[data-widget-id="chat"]','[data-widget-id="video"] video']) {
    const node = await call('Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(selector)})`});
    if(node.result.objectId) identities.push({selector,objectId:node.result.objectId});
  }
  if(action === 'drag') {
    const [source,targetId,edge] = args;
    await call('Input.setInterceptDrags',{enabled:false});
    const from = await box('[data-widget-id="'+source+'"] [data-drag-handle=true]');
    const x=from.x+Math.min(80,from.width/2),y=from.y+20;
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x,y});
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:x+20,y:y+10});
    await frame();
    const to=await box(targetId==='workspace'?'.mod-workspace-canvas':'[data-widget-id="'+targetId+'"]');
    const point={x:to.x+to.width*(edge==='left'?(targetId==='workspace'?.005:.12):edge==='right'?(targetId==='workspace'?.995:.88):.5),y:to.y+to.height*(edge==='top'?.12:edge==='bottom'?.88:.5)};
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...point});
    await frame(); await capture('preview');
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
  } else if(action === 'click') {
    await evaluate(`document.querySelectorAll(${JSON.stringify(args[0])})[${Number(args[1]||0)}].scrollIntoView({block:'center'})`);
    await frame();
    const r=await evaluate(`(()=>{const r=document.querySelectorAll(${JSON.stringify(args[0])})[${Number(args[1]||0)}].getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`); const x=r.x+r.width/2,y=r.y+r.height/2;
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x,y});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x,y});
  } else if(action === 'key') {
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:args[0],code:args[0],windowsVirtualKeyCode:args[0]==='Escape'?27:args[0]==='ArrowRight'?39:args[0]==='Enter'?13:0});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:args[0],code:args[0]});
  } else if(action === 'reload') {
    await call('Page.reload');
  } else if(action === 'observe') {
    const observation=await evaluate(`new Promise(resolve=>{const initial=document.querySelector('[data-widget-id=chat]');let flashes=0;const watcher=new MutationObserver(()=>{if(document.body.innerText.includes('Verifying moderation access'))flashes++;});watcher.observe(document.body,{childList:true,subtree:true,characterData:true});setTimeout(()=>{watcher.disconnect();resolve({flashes,sameChat:initial===document.querySelector('[data-widget-id=chat]'),connected:initial?.isConnected})},15000)})`);
    await writeFile(path.join(out,'observation.json'),JSON.stringify(observation));
    console.log(JSON.stringify(observation));
  } else if(action === 'resize') {
    const trace=await evaluate(`(()=>{const events=window.__resizeEvents=[];for(const name of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture'])document.addEventListener(name,e=>events.push({type:e.type,target:e.target.className,x:e.clientX,buttons:e.buttons}),{capture:true});return 'installed'})()`);
    const r = await box('.mod-workspace-separator');
    const x=r.x+r.width/2,y=r.y+r.height/2;
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x,y});
    await frame();
    console.log(JSON.stringify(await evaluate(`({capture:document.querySelector('.mod-workspace-separator').hasPointerCapture(1),events:window.__resizeEvents})`)));
    for(let i=1;i<=10;i++) { await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:x+Number(args[0])*i/10,y}); await frame(); }
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:x+Number(args[0]),y});
  } else if(action === 'viewport') {
    await call('Emulation.setDeviceMetricsOverride',{width:Number(args[0]),height:Number(args[1]),deviceScaleFactor:1,mobile:false});
  }
  await frame();
  const after = await capture('after');
  const stable = [];
  for(const item of identities) {
    const r=await call('Runtime.callFunctionOn',{objectId:item.objectId,functionDeclaration:`function(){return this.isConnected && this===document.querySelector(${JSON.stringify(item.selector)})}`,returnByValue:true});
    stable.push({selector:item.selector,sameNode:r.result.value});
  }
  const result={action,args,before:before.widgets,after:after.widgets,splitters:after.splitters,stable,errors,horizontalOverflow:after.horizontalOverflow};
  await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{socket.close();}
