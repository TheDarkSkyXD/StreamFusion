import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const [runPath, label, command = 'capture', ...args] = process.argv.slice(2);
const run = JSON.parse(await readFile(runPath, 'utf8'));
const output = path.join(run.evidenceDir, label);
await mkdir(output, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${run.port}/json/list`).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title === 'StreamFusion');
if (!target) throw new Error('StreamFusion renderer missing');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const events = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(message.method)) events.push(message);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function control(action, ...values) {
  return exec(process.execPath, ['.agents/skills/verify-streamfusion/scripts/control.mjs', action, '--run', runPath, ...values], { maxBuffer: 2e6 });
}
try {
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Performance.enable');
  await call('Page.bringToFront');
  const mediaHandles = [];
  const mediaLabels = await evaluate('Array.from(document.querySelectorAll("video")).map(v => v.closest("[data-diagnostics-stream-slot]")?.innerText.slice(0,60) || "standalone")');
  const mediaCount = await evaluate('document.querySelectorAll("video").length');
  for (let index = 0; index < mediaCount; index++) {
    const result = await call('Runtime.evaluate', { expression: `document.querySelectorAll("video")[${index}]` });
    if (result.result.objectId) mediaHandles.push(result.result.objectId);
  }
  const before = await call('Performance.getMetrics');
  const slotHandles = [];
  const slotCount = await evaluate('document.querySelectorAll("[data-diagnostics-stream-slot]").length');
  for (let index = 0; index < slotCount; index++) {
    const result = await call('Runtime.evaluate', { expression: `document.querySelectorAll("[data-diagnostics-stream-slot]")[${index}]` });
    if (result.result.objectId) slotHandles.push(result.result.objectId);
  }
  if (command === 'profile-click') {
    await call('Profiler.enable');
    await call('Profiler.start');
  }
  const started = performance.now();
  if (command === 'ctrl-key') {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: args[0], code: `Digit${args[0]}`, modifiers: 2, windowsVirtualKeyCode: 48 + Number(args[0]) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: args[0], code: `Digit${args[0]}`, modifiers: 2 });
  } else if (command === 'drag-slots') {
    const handles = await evaluate(`Array.from(document.querySelectorAll('button')).filter(e => e.getAttribute('title') === 'Drag to move' || e.getAttribute('aria-label') === 'Drag to move').map(e => { const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })`);
    const from = handles[Number(args[0] || 0)], to = handles[Number(args[1] || 1)];
    if (!from || !to) throw Error('Missing slot drag handles');
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from });
    for (let step=1; step<=20; step++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x:from.x+(to.x-from.x)*step/20, y:from.y+(to.y-from.y)*step/20 });
    await call('Page.captureScreenshot', { format: 'png' });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
  } else if (command === 'wheel') {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Number(args[1] || 900), y: Number(args[2] || 650), deltaX: 0, deltaY: Number(args[0]) });
  } else if (command === 'key') {
    for (let index = 0; index < Number(args[1] || 1); index++) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: args[0], code: args[0], windowsVirtualKeyCode: args[0] === 'Tab' ? 9 : args[0] === 'Escape' ? 27 : 0 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: args[0], code: args[0], windowsVirtualKeyCode: args[0] === 'Tab' ? 9 : args[0] === 'Escape' ? 27 : 0 });
    }
  } else if (command === 'reload') {
    await call('Network.clearBrowserCache');
    await call('Page.reload', { ignoreCache: true });
    await control('wait', '--text', 'Home');
  } else if (command !== 'capture') await control(command === 'profile-click' ? 'click' : command, ...args);
  const actionMs = performance.now() - started;
  const frames = await evaluate(`new Promise(resolve => {
    const gaps = []; let previous; const start = performance.now();
    const timeout = setTimeout(() => resolve(gaps), 4000);
    const frame = now => { if (previous !== undefined) gaps.push(now - previous); previous = now; if (now - start < 2200) requestAnimationFrame(frame); else { clearTimeout(timeout); resolve(gaps); } };
    requestAnimationFrame(frame);
  })`);
  const state = await evaluate(`(() => {
    const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const grid = document.querySelector('[data-testid=following-channel-grid]');
    return { url: location.href, title: document.title, visibility: document.visibilityState, text: document.body.innerText,
      active: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute('href') },
      channelGrid: grid ? { scrollTop: grid.scrollTop, height: grid.clientHeight, totalHeight: grid.scrollHeight, links: grid.querySelectorAll('a').length, first: grid.querySelector('a')?.textContent, last: Array.from(grid.querySelectorAll('a')).at(-1)?.textContent } : null,
      images: Array.from(document.images).map(i => ({ src: i.currentSrc || i.src, alt: i.alt, complete: i.complete, width: i.naturalWidth, visible: visible(i), loading: i.loading })),
      videos: Array.from(document.querySelectorAll('video')).map(v => ({ paused: v.paused, readyState: v.readyState, time: v.currentTime, width: v.videoWidth })),
      elements: Array.from(document.querySelectorAll('a,button,input,[role=tab],[role=switch],h1,h2,h3')).filter(e => e.getClientRects().length).map(e => ({ role: e.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox'}[e.tagName] || 'heading'), name: (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.textContent || '').trim().replace(/\\s+/g,' '), href: e.getAttribute('href'), selected: e.getAttribute('aria-selected') })),
      resources: performance.getEntriesByType('resource').filter(r => r.startTime > performance.now() - 5000).map(r => ({ name: r.name.split('?')[0], duration: r.duration, size: r.transferSize, type: r.initiatorType })) };
  })()`);
  const after = await call('Performance.getMetrics');
  const accessibility = await call('Accessibility.getFullAXTree');
  const accessibleControls = accessibility.nodes.filter(n => !n.ignored && ['button','checkbox','combobox','switch','slider','textbox','tab'].includes(n.role?.value)).map(n => ({ role:n.role.value,name:n.name?.value || '',backendNodeId:n.backendDOMNodeId,properties:n.properties }));
  await writeFile(path.join(output, 'accessibility.json'), JSON.stringify(accessibleControls,null,2));
  if (command === 'profile-click') {
    const {profile} = await call('Profiler.stop');
    await writeFile(path.join(output, 'cpu.cpuprofile'), JSON.stringify(profile));
    const counts = new Map();
    for (let index=0;index<profile.samples.length;index++) counts.set(profile.samples[index], (counts.get(profile.samples[index]) || 0) + (profile.timeDeltas[index] || 0));
    const hot = profile.nodes.map(n => ({ function:n.callFrame.functionName, url:n.callFrame.url.split('?')[0], line:n.callFrame.lineNumber, selfMs:(counts.get(n.id)||0)/1000 })).sort((a,b)=>b.selfMs-a.selfMs).slice(0,40);
    await writeFile(path.join(output, 'hot-functions.json'), JSON.stringify(hot,null,2));
  }
  const retainedMedia = [];
  const retainedSlots = [];
  for (const objectId of slotHandles) {
    const result = await call('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){return {connected:this.isConnected, label:this.getAttribute("data-diagnostics-stream-slot"), text:this.innerText.slice(0,100)}}', returnByValue: true });
    retainedSlots.push(result.result.value);
  }
  for (const objectId of mediaHandles) {
    const result = await call('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){return {connected:this.isConnected,time:this.currentTime,readyState:this.readyState,paused:this.paused}}', returnByValue: true });
    retainedMedia.push({ label: mediaLabels[retainedMedia.length], ...result.result.value });
  }
  const metrics = Object.fromEntries(after.metrics.map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value || 0)]));
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, 'screen.png'), Buffer.from(shot.data, 'base64'));
  const sorted = [...frames].sort((a,b) => a-b);
  const report = { actionMs, frameP95: sorted[Math.floor(sorted.length * .95)], frameMax: Math.max(...frames), metrics, events, retainedMedia, retainedSlots, ...state };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label, url: state.url, actionMs, frameP95: report.frameP95, frameMax: report.frameMax, taskMs: metrics.TaskDuration * 1000, nodes: metrics.Nodes, retainedMedia, brokenImages: state.images.filter(i => i.complete && !i.width), pendingImages: state.images.filter(i => !i.complete).length, events, controls: state.elements.filter(e => e.role !== 'link' && e.role !== 'heading').map(e => e.name).slice(0, 60) }));
} finally { socket.close(); }
