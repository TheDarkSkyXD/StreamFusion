import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createVerificationLaunchPlan } from '../../.agents/skills/verify-streamfusion/scripts/control-launch-plan.mjs';
const root = process.cwd();
const evidenceDir = path.join(root, '.scratch/auth-drag/persistent-app');
mkdirSync(evidenceDir, { recursive: true });
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const profileDir = path.join(root, '.streamfusion-dev-user-data');
const plan = createVerificationLaunchPlan({ port, profileDir });
const fd = openSync(path.join(evidenceDir, 'launch.log'), 'a');
const child = spawn(plan.command, plan.args, {
  cwd: path.join(root, 'apps/desktop'), detached: true, windowsHide: true,
  env: { ...plan.env, STREAMFUSION_DEV_USER_DATA_DIR: profileDir, STREAMFUSION_DEV_ARTIFACT_ROOT: evidenceDir },
  stdio: ['ignore', fd, fd],
});
closeSync(fd);
child.unref();
const state = { pid: child.pid, port, profileDir, evidenceDir, launchedAt: new Date().toISOString(), persistent: true };
writeFileSync(path.join(evidenceDir, 'run.json'), JSON.stringify(state, null, 2));
console.log(JSON.stringify(state));
