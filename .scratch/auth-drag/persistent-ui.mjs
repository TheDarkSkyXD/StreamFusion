import { readFileSync } from 'node:fs';
const run = JSON.parse(readFileSync('.scratch/auth-drag/persistent-app/run.json', 'utf8'));
const targets = await fetch(`http://127.0.0.1:${run.port}/json/list`).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title === 'StreamFusion');
if (!target) throw Error('Owned StreamFusion window is not ready');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); } };
const call = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; };
try {
  const label = process.argv[2];
  if (label) {
    const r = await evaluate(`(() => { const e = [...document.querySelectorAll('a,button,summary,[role="button"]')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(label)} || e.innerText.trim() === ${JSON.stringify(label)}); if (!e) throw Error('Missing control'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await call('Page.bringToFront');
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...r });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...r });
  }
  console.log(await evaluate('document.body.innerText'));
} finally { socket.close(); }
