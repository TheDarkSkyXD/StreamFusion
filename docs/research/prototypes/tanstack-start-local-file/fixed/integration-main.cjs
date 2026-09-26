const { app, BrowserWindow, webContents, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const evidenceDir = process.env.PROTOTYPE_EVIDENCE;
if (!evidenceDir) throw new Error('Missing isolated evidence directory');
fs.mkdirSync(evidenceDir, { recursive: true });
app.setPath('userData', path.join(evidenceDir, 'profile'));
const phase = process.env.PROTOTYPE_PHASE || 'initial';
const output = { packaged: app.isPackaged, phase, actions: [], console: [], snapshots: [], preloadErrors: [] };
app.on('web-contents-created', (_event, contents) => contents.on('preload-error', (_event, preloadPath, error) => { output.preloadErrors.push({preloadPath, message:error.message}); save(); }));
let tested = false;
const deadline = setTimeout(() => { output.error = 'integration deadline'; save(); app.exit(1); }, 75000);
function save() { fs.writeFileSync(path.join(evidenceDir, phase + '.json'), JSON.stringify(output, null, 2)); }
app.on('ready', () => session.defaultSession.enableNetworkEmulation({ offline: true }));
app.on('browser-window-created', (_event, win) => {
  win.on('show', () => win.hide());
  const wc = win.webContents;
  wc.on('console-message', (event) => output.console.push({ level: event.level, message: event.message }));
  wc.once('did-finish-load', async () => {
    if (tested || !wc.getURL().endsWith('/out/renderer/index.html')) return;
    tested = true;
    try {
      async function state(label) {
        const state = await wc.executeJavaScript('({ url: location.href, text: document.body.innerText, bridge: !!window.electronAPI, result: document.querySelector("[data-probe-result]")?.textContent })');
        output.snapshots.push({ label, ...state });
        save();
        return state;
      }
      async function waitText(text) {
        return wc.executeJavaScript(`new Promise((resolve, reject) => {
          const start = performance.now();
          function poll() { if (document.body.innerText.includes(${JSON.stringify(text)})) resolve(true);
            else if (performance.now() - start > 10000) reject(new Error('Missing expected text'));
            else setTimeout(poll, 100); }
          poll();
        })`);
      }
      async function click(label) {
        const point = await wc.executeJavaScript(`(() => {
          const el = [...document.querySelectorAll('button,a')].find(el => el.textContent === ${JSON.stringify(label)});
          if (!el) throw new Error('Missing control');
          const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
        })()`);
        output.actions.push({ action: 'click', label });
        wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      }
      await waitText('Read desktop state');
      await state('initial');
      await click('Count 0');
      await waitText('Count 1');
      await click('Read desktop state');
      await waitText('"version"');
      await state('desktop-read');
      if (phase === 'initial') {
        await click('Save probe preference');
        await waitText('"theme":"light"');
        await state('saved-preference');
      }
      await click('Create player slot');
      await waitText('Player slot created');
      const slotDeadline = Date.now() + 10000;
      while (!webContents.getAllWebContents().some(view => view.getURL().includes('slot-renderer/index.html')) && Date.now() < slotDeadline) await new Promise(resolve => setTimeout(resolve, 100));
      output.slots = [];
      for (const view of webContents.getAllWebContents().filter(view => view.getURL().includes('slot-renderer/index.html'))) {
        const details = await view.executeJavaScript('({ url: location.href, video: !!document.querySelector("video"), fullBridge: !!window.electronAPI, slotBridge: !!window.slotAPI })');
        output.slots.push({ ...details, preferences: view.getLastWebPreferences() });
      }
      await click('Destroy player slot');
      await waitText('Player slot destroyed');
      await click('Details');
      await waitText('Tab: saved');
      await state('details');
      await new Promise(resolve => { wc.once('did-finish-load', resolve); wc.reload(); });
      await waitText('Tab: saved');
      await state('reload');
      wc.navigationHistory.goBack();
      await waitText('Read desktop state');
      await state('back');
      wc.navigationHistory.goForward();
      await waitText('Tab: saved');
      await state('forward');
      await click('Home');
      await waitText('Read desktop state');
      await click('Read desktop state');
      await waitText('"theme":"light"');
      await state('persisted-preference');
      win.removeAllListeners('show'); win.showInactive();
      await wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const screenshot = await wc.capturePage();
      fs.writeFileSync(path.join(evidenceDir, phase + '.png'), screenshot.toPNG());
      const ffmpeg = require('ffmpeg-static').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      const ffmpegResult = spawnSync(ffmpeg, ['-version'], { windowsHide: true, encoding: 'utf8' });
      output.ffmpeg = { exists: fs.existsSync(ffmpeg), status: ffmpegResult.status, version: ffmpegResult.stdout?.split('\n')[0], error: ffmpegResult.error?.message };
      output.userData = app.getPath('userData');
      output.error = null;
      save();
      clearTimeout(deadline);
      app.quit();
      setTimeout(() => app.exit(0), 12000).unref();
    } catch (error) {
      output.error = error.stack;
      save(); clearTimeout(deadline); app.exit(1);
    }
  });
});
require('./out/main/index.js');
