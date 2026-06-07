import fsp from "node:fs/promises";
import path from "node:path";

export interface PruneResult {
  /** Absolute paths of files we kept, sorted newest -> oldest. */
  kept: string[];
  /** Absolute paths of files we successfully deleted. */
  pruned: string[];
}

export interface PruneOptions {
  /** Basename prefix to scope the prune to (e.g. "streamfusion-"). */
  prefix: string;
  /** Number of newest files to keep. Must be >= 0. */
  keep: number;
}

/**
 * Prune old log files in `logsDir` whose basename starts with `prefix` and
 * ends with `.log`. Keeps the newest `keep` files (by mtime, descending; ties
 * broken by descending basename so ISO-timestamped names sort chronologically)
 * and deletes the rest.
 *
 * Creates `logsDir` recursively if it does not yet exist. Never throws on a
 * single-file delete failure — logs via console.warn and continues. Files
 * whose delete failed are NOT included in `pruned`.
 */
export async function pruneLogs(logsDir: string, opts: PruneOptions): Promise<PruneResult> {
  if (opts.keep < 0) {
    throw new RangeError("keep must be >= 0");
  }

  await fsp.mkdir(logsDir, { recursive: true });

  const entries = await fsp.readdir(logsDir, { withFileTypes: true });
  const matches: { absPath: string; basename: string; mtimeMs: number }[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.startsWith(opts.prefix)) continue;
    // path.extname returns the LAST extension, so "foo.log.gz" -> ".gz" and
    // is correctly excluded; only true ".log" files match.
    if (path.extname(name) !== ".log") continue;

    const absPath = path.join(logsDir, name);
    let mtimeMs = 0;
    try {
      const stat = await fsp.stat(absPath);
      mtimeMs = stat.mtimeMs;
    } catch {
      // File vanished between readdir and stat — skip it; not our concern.
      continue;
    }
    matches.push({ absPath, basename: name, mtimeMs });
  }

  // Newest first by mtime; descending basename tiebreaker keeps the
  // chronologically-latest ISO-timestamped file on ties.
  matches.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.basename < b.basename ? 1 : a.basename > b.basename ? -1 : 0;
  });

  const survivors = matches.slice(0, opts.keep);
  const victims = matches.slice(opts.keep);

  const pruned: string[] = [];
  for (const victim of victims) {
    try {
      await fsp.unlink(victim.absPath);
      pruned.push(victim.absPath);
    } catch (err) {
      // Don't have the structured logger yet — fall back to console.warn so
      // the failure is at least visible in dev. Continue with the rest.
      console.warn(`pruneLogs: failed to delete ${victim.absPath}:`, err);
    }
  }

  return {
    kept: survivors.map((s) => s.absPath),
    pruned,
  };
}
