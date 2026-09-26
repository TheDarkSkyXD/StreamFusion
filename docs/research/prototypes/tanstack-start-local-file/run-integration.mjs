import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

if (process.platform !== 'win32') throw new Error('This prototype packages Windows Electron.');
const artifactRoot = import.meta.dirname;
const repoRoot = path.resolve(artifactRoot, '../../../..');
const desktopRoot = path.join(repoRoot, 'apps/desktop');
const compiledMain = path.join(desktopRoot, 'out/main/index.js');
if (!fs.existsSync(compiledMain)) throw new Error('Build the existing desktop app with npm run build first.');
const runRoot = path.join(repoRoot, '.scratch', `tanstack-start-integration-${Date.now()}`);
fs.cpSync(path.join(artifactRoot, 'source'), runRoot, { recursive: true });
fs.cpSync(path.join(artifactRoot, 'fixed'), runRoot, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: runRoot, windowsHide: true, encoding: 'utf8', timeout: 180_000, ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result;
}

const shell = process.env.ComSpec ?? 'cmd.exe';
run(shell, ['/d', '/s', '/c', 'npm ci --no-audit --no-fund']);
const build = run(shell, ['/d', '/s', '/c', 'npm run build']);
fs.writeFileSync(path.join(runRoot, 'build.txt'), build.stdout + build.stderr);
run(process.execPath, [path.join(runRoot, 'assemble.mjs')]);

const appDir = path.join(runRoot, 'integration-app');
fs.mkdirSync(appDir);
fs.cpSync(path.join(desktopRoot, 'out'), path.join(appDir, 'out'), { recursive: true });
fs.cpSync(path.join(desktopRoot, 'assets/icons'), path.join(appDir, 'assets/icons'), { recursive: true });
fs.cpSync(path.join(runRoot, 'probe-app/external-scripts-diagnostic'), path.join(appDir, 'out/renderer'), { recursive: true });
fs.copyFileSync(path.join(runRoot, 'integration-main.cjs'), path.join(appDir, 'prototype-main.cjs'));
const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
manifest.name = 'streamfusion-start-integration-prototype';
manifest.main = 'prototype-main.cjs';
delete manifest.scripts;
delete manifest.build;
delete manifest.devDependencies;
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(manifest, null, 2));

run(process.execPath, [path.join(repoRoot, 'node_modules/esbuild/bin/esbuild'), path.join(desktopRoot, 'src/backend/preload/slot.ts'), '--bundle', '--platform=node', '--format=cjs', '--external:electron', '--minify', `--outfile=${path.join(appDir, 'out/preload/slot.js')}`]);
const configPath = path.join(runRoot, 'integration-builder.json');
fs.writeFileSync(configPath, JSON.stringify({
  appId: 'com.streamfusion.prototype.startintegration',
  productName: 'StreamFusion Start integration prototype',
  electronVersion: '43.4.1',
  electronDist: path.join(repoRoot, 'node_modules/electron/dist'),
  npmRebuild: false,
  directories: { app: appDir, output: path.join(runRoot, 'packaged') },
  files: ['out/**/*', 'prototype-main.cjs', 'assets/**/*', 'package.json'],
  asarUnpack: ['**/node_modules/better-sqlite3/**', '**/node_modules/ffmpeg-static/**'],
  win: { signAndEditExecutable: false },
}, null, 2));
run(process.execPath, [path.join(repoRoot, 'node_modules/electron-builder/cli.js'), '--win', '--dir', '--config', configPath, '--publish', 'never'], { cwd: repoRoot });

const evidenceDir = path.join(runRoot, 'evidence');
const exe = path.join(runRoot, 'packaged/win-unpacked/StreamFusion Start integration prototype.exe');
const env = { ...process.env, PROTOTYPE_EVIDENCE: evidenceDir, STREAMFUSION_WEBCONTENTS_VIEW_SLOTS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
for (const phase of ['initial', 'restart']) {
  const processResult = run(exe, [], { cwd: path.dirname(exe), env: { ...env, PROTOTYPE_PHASE: phase }, timeout: 100_000 });
  fs.writeFileSync(path.join(evidenceDir, `${phase}-process.txt`), processResult.stdout + processResult.stderr);
}

const observations = ['initial', 'restart'].map(phase => JSON.parse(fs.readFileSync(path.join(evidenceDir, `${phase}.json`), 'utf8')));
const database = new DatabaseSync(path.join(evidenceDir, 'profile/streamfusion.db'), { readOnly: true });
const databaseCheck = database.prepare('pragma quick_check').all();
database.close();
const restartRead = JSON.parse(observations[1].snapshots.find(snapshot => snapshot.label === 'desktop-read').result);
const passed = observations.every(result => result.packaged && result.error === null && result.preloadErrors.length === 0 &&
  !result.console.some(message => message.level === 'error' || message.level === 3) && result.ffmpeg.status === 0 &&
  result.slots.length > 0 && result.slots.every(slot => slot.video && slot.slotBridge && !slot.fullBridge && slot.preferences.sandbox && slot.preferences.contextIsolation && !slot.preferences.nodeIntegration)) &&
  restartRead.theme === 'light' && restartRead.browserNote === 'kept' && databaseCheck.every(row => row.quick_check === 'ok');
const summary = { passed, runRoot, databaseCheck, restartRead, originalMainSha256: createHash('sha256').update(fs.readFileSync(compiledMain)).digest('hex'), phases: observations.map(result => ({ phase: result.phase, error: result.error, preloadErrors: result.preloadErrors, console: result.console, ffmpeg: result.ffmpeg, slots: result.slots.map(slot => ({ video: slot.video, slotBridge: slot.slotBridge, fullBridge: slot.fullBridge, sandbox: slot.preferences.sandbox, contextIsolation: slot.preferences.contextIsolation, nodeIntegration: slot.preferences.nodeIntegration })) })) };
fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
const profile = path.resolve(evidenceDir, 'profile');
if (!profile.startsWith(path.resolve(runRoot) + path.sep)) throw new Error('Unexpected cleanup path');
fs.rmSync(profile, { recursive: true, force: true });
process.exitCode = passed ? 0 : 1;
