import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, link, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  StreamRecordingArtifactIdentity,
  StreamRecordingSection,
} from "@/shared/stream-recording-types";

export interface StreamRecordingCommitIntent {
  outputPath: string;
  format: "mp4" | "ts";
  usedFallback: boolean;
  artifactIdentity: StreamRecordingArtifactIdentity;
}

interface FinalizerProcess {
  stderr: { on(event: "data", listener: (chunk: unknown) => void): unknown };
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type StreamRecordingFinalizerSpawn = (
  command: string,
  args: string[],
  options: { windowsHide: boolean }
) => FinalizerProcess;

export interface StreamRecordingSectionFinalizer {
  finalize(input: {
    ffmpegPath: string;
    destinationPath: string;
    sections: Pick<StreamRecordingSection, "id" | "path">[];
    beforeCommit?: (intent: StreamRecordingCommitIntent) => Promise<void>;
  }): Promise<{
    outputPath: string;
    format: "mp4" | "ts";
    usedFallback: boolean;
    ownedSectionPaths: string[];
    artifactIdentity: StreamRecordingArtifactIdentity;
  }>;
}

const LINK_FALLBACK_CODES = new Set(["EPERM", "EACCES", "EXDEV", "EOPNOTSUPP", "ENOSYS"]);

export function createAtomicNoClobberCommit({
  linkFile = link,
  copyFileExclusive = (source, destination) =>
    copyFile(source, destination, constants.COPYFILE_EXCL),
}: {
  linkFile?: (source: string, destination: string) => Promise<void>;
  copyFileExclusive?: (source: string, destination: string) => Promise<unknown>;
} = {}): (source: string, destination: string) => Promise<void> {
  return async (source, destination) => {
    try {
      await linkFile(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !LINK_FALLBACK_CODES.has(code)) throw error;
    }

    await copyFileExclusive(source, destination);
  };
}

function escapeManifestPath(filePath: string): string {
  if (/[\r\n]/.test(filePath)) throw new Error("Recording section path is not safe to finalize");
  return filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  spawnProcess: StreamRecordingFinalizerSpawn
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function cleanupRecordingSectionPaths(paths: string[]): Promise<void> {
  await Promise.allSettled(paths.map((filePath) => removeIfPresent(filePath)));
}

export async function createStreamRecordingArtifactIdentity(
  filePath: string
): Promise<StreamRecordingArtifactIdentity> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  return { algorithm: "sha256", digest: hash.digest("hex"), size };
}

export async function verifyStreamRecordingArtifactIdentity(
  filePath: string,
  expected: StreamRecordingArtifactIdentity
): Promise<boolean> {
  try {
    if ((await stat(filePath)).size !== expected.size) return false;
    const actual = await createStreamRecordingArtifactIdentity(filePath);
    return actual.algorithm === expected.algorithm && actual.digest === expected.digest;
  } catch {
    return false;
  }
}

async function assembleAndCommit({
  ffmpegPath,
  args,
  tempPath,
  outputPath,
  spawnProcess,
  commitFile,
  format,
  usedFallback,
  beforeCommit,
}: {
  ffmpegPath: string;
  args: string[];
  tempPath: string;
  outputPath: string;
  spawnProcess: StreamRecordingFinalizerSpawn;
  commitFile: (source: string, destination: string) => Promise<void>;
  format: "mp4" | "ts";
  usedFallback: boolean;
  beforeCommit?: (intent: StreamRecordingCommitIntent) => Promise<void>;
}): Promise<StreamRecordingArtifactIdentity> {
  try {
    await runFfmpeg(ffmpegPath, args, spawnProcess);
    const artifactIdentity = await createStreamRecordingArtifactIdentity(tempPath);
    await beforeCommit?.({ outputPath, format, usedFallback, artifactIdentity });
    await commitFile(tempPath, outputPath);
    return artifactIdentity;
  } finally {
    await Promise.allSettled([removeIfPresent(tempPath)]);
  }
}

export function createStreamRecordingSectionFinalizer({
  spawnProcess = (command, args, options) => spawn(command, args, options),
  createNonce = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  commitFile = createAtomicNoClobberCommit(),
}: {
  spawnProcess?: StreamRecordingFinalizerSpawn;
  createNonce?: () => string;
  commitFile?: (source: string, destination: string) => Promise<void>;
} = {}): StreamRecordingSectionFinalizer {
  return {
    async finalize({ ffmpegPath, destinationPath, sections, beforeCommit }) {
      if (sections.length === 0) throw new Error("No captured sections are available");

      const nonce = createNonce();
      const manifestPath = `${destinationPath}.streamfusion-${nonce}.concat.txt`;
      const mp4TempPath = `${destinationPath}.streamfusion-${nonce}.finalizing.mp4`;
      const fallbackPath = replaceExtension(destinationPath, ".ts");
      const tsTempPath = `${fallbackPath}.streamfusion-${nonce}.finalizing.ts`;
      const manifest = sections
        .map((section) => `file '${escapeManifestPath(section.path)}'`)
        .join("\n");

      await writeFile(manifestPath, `${manifest}\n`, { encoding: "utf8", flag: "wx" });
      try {
        try {
          const artifactIdentity = await assembleAndCommit({
            ffmpegPath,
            args: [
              "-hide_banner",
              "-nostdin",
              "-f",
              "concat",
              "-safe",
              "0",
              "-i",
              manifestPath,
              "-c",
              "copy",
              "-movflags",
              "+faststart",
              mp4TempPath,
            ],
            tempPath: mp4TempPath,
            outputPath: destinationPath,
            spawnProcess,
            commitFile,
            format: "mp4",
            usedFallback: false,
            beforeCommit,
          });
          return {
            outputPath: destinationPath,
            format: "mp4",
            usedFallback: false,
            ownedSectionPaths: sections.map((section) => section.path),
            artifactIdentity,
          };
        } catch (mp4Error) {
          try {
            const artifactIdentity = await assembleAndCommit({
              ffmpegPath,
              args: [
                "-hide_banner",
                "-nostdin",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                manifestPath,
                "-c",
                "copy",
                "-f",
                "mpegts",
                tsTempPath,
              ],
              tempPath: tsTempPath,
              outputPath: fallbackPath,
              spawnProcess,
              commitFile,
              format: "ts",
              usedFallback: true,
              beforeCommit,
            });
            return {
              outputPath: fallbackPath,
              format: "ts",
              usedFallback: true,
              ownedSectionPaths: sections.map((section) => section.path),
              artifactIdentity,
            };
          } catch (fallbackError) {
            throw new AggregateError(
              [mp4Error, fallbackError],
              "Could not assemble the captured recording sections"
            );
          }
        }
      } finally {
        await Promise.allSettled([removeIfPresent(manifestPath)]);
      }
    },
  };
}
