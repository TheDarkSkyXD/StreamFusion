import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const runPath = process.argv[2];
const run = JSON.parse(await readFile(runPath, 'utf8'));
const groups = [
  ['General', ['general']],
  ['Viewing', ['playback', 'player-controls', 'buffer', 'multiview']],
  ['Experience', ['notifications', 'chat', 'predictions']],
  ['Accounts & Network', ['adblock', 'proxy', 'integrations', 'api-tokens']],
  ['System & Support', ['updates', 'diagnostics', 'logs', 'report-bug', 'about']],
];
let step = 0;
for (const [group, tabs] of groups) {
  const label = `settings-group-${++step}`;
  await exec(process.execPath, ['.scratch/performance-audit/drive.mjs', runPath, label, 'click', '--role', 'button', '--name', `${group} settings section`]);
  const report = JSON.parse(await readFile(path.join(run.evidenceDir, label, 'report.json'), 'utf8'));
  const links = report.elements.filter(e => e.role === 'link' && tabs.includes(new URLSearchParams(e.href?.split('?')[1]).get('tab')));
  for (const link of links) {
    const tab = new URLSearchParams(link.href.split('?')[1]).get('tab');
    const result = await exec(process.execPath, ['.scratch/performance-audit/drive.mjs', runPath, `settings-${tab}`, 'click', '--role', 'link', '--name', link.name], { maxBuffer: 2e6 });
    const data = JSON.parse(result.stdout);
    console.log(JSON.stringify({ tab, frameP95: data.frameP95, taskMs: data.taskMs, errors: data.events.length, broken: data.brokenImages.length }));
  }
}
