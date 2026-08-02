import { lstatSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function comparable(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSafeRecordingSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function normalizeRecordingDestination(destinationPath: string): string | null {
  if (!path.isAbsolute(destinationPath) || path.extname(destinationPath).toLowerCase() !== ".mp4") {
    return null;
  }
  return path.normalize(path.resolve(destinationPath));
}

export function createOwnedRecordingSectionPath(
  destinationPath: string,
  sessionId: string,
  sectionNumber: number
): string {
  const destination = normalizeRecordingDestination(destinationPath);
  if (!destination || !isSafeRecordingSessionId(sessionId) || sectionNumber < 1) {
    throw new Error("Recording section identity is not safe");
  }
  const parsed = path.parse(destination);
  return path.join(
    parsed.dir,
    `${parsed.name}.streamfusion-${sessionId}-part-${String(sectionNumber).padStart(3, "0")}.ts`
  );
}

export function isOwnedRecordingSection(
  destinationPath: string,
  sessionId: string,
  sectionNumber: number,
  section: { id: string; path: string }
): boolean {
  if (section.id !== `${sessionId}-part-${sectionNumber}`) return false;
  try {
    return (
      comparable(section.path) ===
      comparable(createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber))
    );
  } catch {
    return false;
  }
}

export function createOwnedRecordingOutputPath(
  destinationPath: string,
  format: "mp4" | "ts"
): string | null {
  const destination = normalizeRecordingDestination(destinationPath);
  if (!destination) return null;
  if (format === "mp4") return destination;
  const parsed = path.parse(destination);
  return path.join(parsed.dir, `${parsed.name}.ts`);
}

export function isOwnedRecordingOutput(
  destinationPath: string,
  outputPath: string,
  format: "mp4" | "ts",
  usedFallback: boolean
): boolean {
  if (usedFallback !== (format === "ts")) return false;
  const expected = createOwnedRecordingOutputPath(destinationPath, format);
  if (!expected) return false;
  return comparable(outputPath) === comparable(expected);
}

export function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function isRecordingSectionAvailable(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0) return false;
    const handle = await open(filePath, "r");
    await handle.close();
    return true;
  } catch {
    return false;
  }
}
