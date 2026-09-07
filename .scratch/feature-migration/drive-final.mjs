import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const run = process.argv[3] ?? '.scratch/verify-streamfusion/runs/feature-ownership-final2-20260906/run.json';
const cli = '.agents/skills/verify-streamfusion/scripts/control.mjs';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const step of steps) {
  const [command, ...args] = step;
  const result = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, command, '--run', run, ...args], { encoding: 'utf8' });
  console.log(JSON.stringify({ command, args, result: JSON.parse(result) }));
}
