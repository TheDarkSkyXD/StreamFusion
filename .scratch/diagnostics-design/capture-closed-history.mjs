import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const destination = path.resolve(process.argv[3]);
const db = new DatabaseSync(path.join(run.profileDir, 'diagnostics-history.sqlite'), { readOnly: true });
try {
  const session = db.prepare('SELECT * FROM runtime_instance ORDER BY started_at_ms DESC LIMIT 1').get();
  if (session?.clean !== 1 || session.stopped_at_ms === null) throw new Error('The app did not record a clean shutdown');
  const report = {
    session,
    quickCheck: db.prepare('PRAGMA quick_check').all(),
    resources: db.prepare('SELECT COUNT(*) count, MIN(observed_at_ms) oldestAtMs, MAX(observed_at_ms) newestAtMs FROM resource_raw').get(),
    routes: db.prepare('SELECT route, COUNT(*) count FROM renderer_evidence GROUP BY route').all(),
    snapshot: destination,
  };
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  fs.writeFileSync(path.join(run.evidenceDir, 'clean-shutdown-history.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
