import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const artifactRoot = import.meta.dirname;
const repoRoot = path.resolve(artifactRoot, '../../../..');
const runRoot = path.join(repoRoot, '.scratch', `tanstack-start-local-file-${Date.now()}`);
fs.cpSync(path.join(artifactRoot, 'source'), runRoot, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: runRoot,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120_000,
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result;
}

if (process.platform !== 'win32') throw new Error('This recorded probe targets packaged Windows Electron.');
run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund']);
const build = run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run build']);
fs.writeFileSync(path.join(runRoot, 'build.log'), build.stdout + build.stderr);
run(process.execPath, [path.join(runRoot, 'assemble.mjs')]);

const config = {
  appId: 'com.streamfusion.prototype.startloading',
  productName: 'StreamFusion Start loading prototype',
  electronVersion: '43.4.1',
  electronDist: path.join(repoRoot, 'node_modules/electron/dist'),
  npmRebuild: false,
  directories: { app: path.join(runRoot, 'probe-app'), output: path.join(runRoot, 'packaged') },
  files: ['**/*'],
  win: { signAndEditExecutable: false },
};
const configPath = path.join(runRoot, 'electron-builder.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
run(process.execPath, [path.join(repoRoot, 'node_modules/electron-builder/cli.js'), '--win', '--dir', '--config', configPath, '--publish', 'never'], { cwd: repoRoot });

const evidenceDir = path.join(runRoot, 'evidence');
const env = { ...process.env, PROTOTYPE_EVIDENCE: evidenceDir };
delete env.ELECTRON_RUN_AS_NODE;
run(path.join(runRoot, 'packaged/win-unpacked/StreamFusion Start loading prototype.exe'), [], { env, timeout: 45_000 });
const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'results.json'), 'utf8'));
console.log(JSON.stringify({ runRoot, packaged: evidence.packaged, results: evidence.results.map(result => ({
  variant: result.variant,
  hydrated: result.state.hydrated,
  text: result.state.text,
  errors: result.messages.filter(message => message.level === 3).map(message => message.message),
  failures: result.failures,
})) }, null, 2));

const profile = path.resolve(evidenceDir, 'disposable-profile');
if (!profile.startsWith(path.resolve(runRoot) + path.sep)) throw new Error('Unexpected cleanup path');
fs.rmSync(profile, { recursive: true, force: true });
const candidate = evidence.results.find(result => result.variant === 'external-scripts-diagnostic');
process.exitCode = candidate?.state.hydrated && !candidate.messages.some(message => message.level === 3) && candidate.failures.length === 0 ? 0 : 1;
