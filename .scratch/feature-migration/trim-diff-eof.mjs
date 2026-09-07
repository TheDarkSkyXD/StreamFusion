import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const result = spawnSync('git', ['diff', '--cached', '--check'], {encoding:'utf8'});
const files = [...new Set(result.stdout.split('\n').filter(line => line.endsWith('new blank line at EOF.')).map(line => line.replace(/:\d+: new blank line at EOF\.$/, '')))];
for (const file of files) {
 const text = fs.readFileSync(file, 'utf8');
 fs.writeFileSync(file, text.replace(/(?:\r?\n)+$/, '\n'));
}
console.log(JSON.stringify(files));
