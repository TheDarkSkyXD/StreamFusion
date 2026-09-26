const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const evidenceDir = process.env.PROTOTYPE_EVIDENCE;
if (!evidenceDir) throw new Error('Set PROTOTYPE_EVIDENCE to an isolated evidence directory');
fs.mkdirSync(evidenceDir, { recursive: true });
app.setPath('userData', path.join(evidenceDir, 'disposable-profile'));
app.commandLine.appendSwitch('disable-background-networking');
const results = [];
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const variant of ['emitted', 'relative-diagnostic', 'csp-diagnostic', 'external-scripts-diagnostic']) {
    const messages = [];
    const failures = [];
    const window = new BrowserWindow({ show: false, width: 1100, height: 780, webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: false,
    } });
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      messages.push({ level, message, line, sourceId });
    });
    window.webContents.session.webRequest.onErrorOccurred(details => {
      failures.push({ url: details.url, error: details.error, resourceType: details.resourceType });
    });
    await window.loadFile(path.join(__dirname, variant, 'index.html'));
    const state = await window.webContents.executeJavaScript(`
      new Promise(resolve => {
        const started = performance.now();
        function poll() {
          const hydrated = document.querySelector('[data-hydrated="true"]') !== null;
          if ((hydrated && document.querySelector('button')) || performance.now() - started > 5000) {
            resolve({ href: location.href, hydrated, text: document.body.innerText,
              scripts: [...document.scripts].map(s => ({ src: s.src, inline: !s.src })),
              links: [...document.querySelectorAll('a')].map(a => ({ text: a.textContent, href: a.href })) });
          } else setTimeout(poll, 100);
        }
        poll();
      })
    `);
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(evidenceDir, variant + '.png'), screenshot.toPNG());
    results.push({ variant, state, messages, failures });
    window.destroy();
  }
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({
    packaged: app.isPackaged, electron: process.versions.electron, chromium: process.versions.chrome,
    diagnosticOnly: true, streamfusionBackendIntegrated: false, results,
  }, null, 2));
  app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(evidenceDir, 'fatal.txt'), error.stack);
  app.exit(1);
});
