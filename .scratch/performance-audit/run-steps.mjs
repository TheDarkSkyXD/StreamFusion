import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const execute = promisify(execFile);
const [run, manifest] = process.argv.slice(2);
const steps = JSON.parse(await readFile(manifest, 'utf8'));
for (const step of steps) {
  const { stdout } = await execute(process.execPath, ['.scratch/performance-audit/drive.mjs', run, ...step], { maxBuffer: 4e6 });
  const r = JSON.parse(stdout);
  console.log(JSON.stringify({ label:r.label,frameP95:r.frameP95,taskMs:r.taskMs,visibleBroken:r.brokenImages.filter(i=>i.visible),exceptions:r.events.filter(e=>e.method==='Runtime.exceptionThrown'),retained:r.retainedMedia?.map(v=>v.connected) }));
}
