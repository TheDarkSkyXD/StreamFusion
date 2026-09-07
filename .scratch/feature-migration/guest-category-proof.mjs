import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const run = process.argv[2];
const cli = '.agents/skills/verify-streamfusion/scripts/control.mjs';
function drive(...args) {
  return JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args, '--run', run], { encoding: 'utf8' }));
}
function cdp(steps) {
  const file = '.scratch/feature-migration/guest-category-current-step.json';
  fs.writeFileSync(file, JSON.stringify(steps));
  console.log(execFileSync(process.execPath, ['.scratch/feature-migration/cdp-audit.mjs', run, file], { encoding: 'utf8' }));
}
console.log(drive('evaluate', '--expression', "location.hash='/categories/twitch/509660?tab=videos&platform=twitch'"));
for (const kind of ['Videos', 'Clips']) {
  if (kind === 'Clips') console.log(drive('click', '--role', 'link', '--name', 'Clips'));
  const section = `section[aria-label="Category ${kind} filters"]`;
  const cards = kind === 'Videos' ? 'a[href*="/video/twitch/"]' : 'button[aria-label^="Play clip "]';
  cdp([{ wait: `document.querySelector(${JSON.stringify(section)})?.querySelectorAll(${JSON.stringify(cards)}).length > 0`, timeout: 45000 }]);
  cdp([{ method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(()=>{const s=document.querySelector(${JSON.stringify(section)});return {route:location.hash,visibility:document.visibilityState,cards:s.querySelectorAll(${JSON.stringify(cards)}).length,text:s.innerText.slice(0,650),controls:[...document.querySelectorAll('[role="combobox"]')].map(e=>({name:e.getAttribute('aria-label'),text:e.textContent})),images:[...s.querySelectorAll('img')].slice(0,8).map(i=>({alt:i.alt,complete:i.complete,width:i.naturalWidth}))}})()` }}]);
  console.log(drive('snapshot', '--output', `guest-category-${kind.toLowerCase()}-success.json`));
  console.log(drive('screenshot', '--output', `guest-category-${kind.toLowerCase()}-success.png`));
}
