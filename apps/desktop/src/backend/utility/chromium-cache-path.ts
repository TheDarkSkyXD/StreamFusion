import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

interface ResolveChromiumDiskCachePathOptions {
  tempPath: string;
  userDataPath: string;
  processId: number;
  launchId: string;
}

interface PruneStaleChromiumDiskCachesOptions {
  cacheRoot: string;
  currentCachePath: string;
  userDataPath: string;
  isProcessRunning?: (processId: number) => boolean;
}

function isInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveChromiumDiskCachePath({
  tempPath,
  userDataPath,
  processId,
  launchId,
}: ResolveChromiumDiskCachePathOptions): string {
  const profileKey = createHash("sha256").update(userDataPath).digest("hex").slice(0, 12);
  const launchKey = createHash("sha256").update(launchId).digest("hex").slice(0, 12);
  return path.join(
    tempPath,
    "StreamFusion",
    "chromium-cache",
    profileKey,
    `${processId}-${launchKey}`
  );
}

export async function pruneStaleChromiumDiskCaches({
  cacheRoot,
  currentCachePath,
  userDataPath,
  isProcessRunning: checkProcess = isProcessRunning,
}: PruneStaleChromiumDiskCachesOptions): Promise<void> {
  const resolvedRoot = path.resolve(cacheRoot);
  const resolvedCurrent = path.resolve(currentCachePath);
  const resolvedUserData = path.resolve(userDataPath);

  if (
    path.dirname(resolvedCurrent) !== resolvedRoot ||
    isInside(resolvedUserData, resolvedRoot) ||
    isInside(resolvedRoot, resolvedUserData)
  ) {
    throw new Error("Refusing to prune outside the disposable Chromium cache root");
  }

  const currentProcessId = Number(path.basename(resolvedCurrent).split("-", 1)[0]);

  const entries = await readdir(resolvedRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || !/^\d+-[a-f0-9]+$/.test(entry.name)) return;

      const candidate = path.join(resolvedRoot, entry.name);
      if (candidate === resolvedCurrent) return;

      const processId = Number(entry.name.slice(0, entry.name.indexOf("-")));
      // If the OS reused our PID, another launch directory with that same PID
      // cannot belong to a live process: this process owns the PID now.
      if (processId !== currentProcessId && checkProcess(processId)) return;

      await rm(candidate, { recursive: true, force: true });
    })
  );
}
