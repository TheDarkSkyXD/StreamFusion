import { EventEmitter } from "node:events";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupRecordingSectionPaths,
  createAtomicNoClobberCommit,
  createStreamRecordingArtifactIdentity,
  createStreamRecordingSectionFinalizer,
  type StreamRecordingCommitIntent,
  verifyStreamRecordingArtifactIdentity,
} from "@backend/services/stream-recording-section-finalizer";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-finalizer-"));
  temporaryDirectories.push(directory);
  const sections = ["first.mp4", "second.mp4", "third.mp4"].map((name, index) => {
    const sectionPath = path.join(directory, name);
    writeFileSync(sectionPath, `sentinel-${index + 1}|`);
    return { id: `part-${index + 1}`, path: sectionPath };
  });
  return { sections, destinationPath: path.join(directory, "recording.mp4") };
}

function successfulConcatSpawn() {
  return vi.fn((_command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: PassThrough };
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      const manifestPath = args[args.indexOf("-i") + 1]!;
      const outputPath = args.at(-1)!;
      const sectionPaths = readFileSync(manifestPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.slice(6, -1));
      writeFileSync(
        outputPath,
        sectionPaths.map((sectionPath) => readFileSync(sectionPath)).join("")
      );
      child.emit("close", 0);
    });
    return child;
  });
}

function failedSpawn(message: string) {
  return (_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: PassThrough };
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stderr.write(message);
      child.emit("close", 1);
    });
    return child;
  };
}

// Guards: finalization assembles every immutable capture section before committing one output.
// Guards: a durable pre-commit SHA-256 identity proves public-output ownership across restart.
describe("Stream Recording section finalizer", () => {
  it("atomically commits ordered sentinel bytes and returns section cleanup ownership", async () => {
    const { sections, destinationPath } = fixture();
    const spawnProcess = successfulConcatSpawn();
    const finalizer = createStreamRecordingSectionFinalizer({
      spawnProcess,
      createNonce: () => "1",
    });
    const beforeCommit = vi.fn(async (intent: StreamRecordingCommitIntent) => {
      expect(existsSync(destinationPath)).toBe(false);
      expect(intent).toMatchObject({
        outputPath: destinationPath,
        format: "mp4",
        usedFallback: false,
        artifactIdentity: { algorithm: "sha256", size: 33 },
      });
    });

    await expect(
      finalizer.finalize({ ffmpegPath: "ffmpeg", destinationPath, sections, beforeCommit })
    ).resolves.toEqual({
      outputPath: destinationPath,
      format: "mp4",
      usedFallback: false,
      ownedSectionPaths: sections.map((section) => section.path),
      artifactIdentity: {
        algorithm: "sha256",
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: 33,
      },
    });
    expect(beforeCommit).toHaveBeenCalledTimes(1);

    expect(readFileSync(destinationPath, "utf8")).toBe("sentinel-1|sentinel-2|sentinel-3|");
    expect(sections.every((section) => existsSync(section.path))).toBe(true);
    await cleanupRecordingSectionPaths(sections.map((section) => section.path));
    expect(sections.every((section) => !existsSync(section.path))).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-f", "concat", "-safe", "0", "-movflags", "+faststart"]),
      { windowsHide: true }
    );
  });

  it("falls back to a truthful TS output without creating the requested MP4", async () => {
    const { sections, destinationPath } = fixture();
    const concat = successfulConcatSpawn();
    const failMp4 = failedSpawn("MP4 remux failed");
    const spawnProcess = vi.fn().mockImplementationOnce(failMp4).mockImplementationOnce(concat);
    const finalizer = createStreamRecordingSectionFinalizer({
      spawnProcess,
      createNonce: () => "2",
    });
    const fallbackPath = destinationPath.replace(/\.mp4$/, ".ts");

    await expect(
      finalizer.finalize({ ffmpegPath: "ffmpeg", destinationPath, sections })
    ).resolves.toEqual({
      outputPath: fallbackPath,
      format: "ts",
      usedFallback: true,
      ownedSectionPaths: sections.map((section) => section.path),
      artifactIdentity: {
        algorithm: "sha256",
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: 33,
      },
    });

    expect(existsSync(destinationPath)).toBe(false);
    expect(readFileSync(fallbackPath, "utf8")).toBe("sentinel-1|sentinel-2|sentinel-3|");
    expect(sections.every((section) => existsSync(section.path))).toBe(true);
  });

  it("rejects a same-size public artifact after its owned bytes are replaced", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-identity-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "output.mp4");
    writeFileSync(outputPath, "owned-bytes");
    const identity = await createStreamRecordingArtifactIdentity(outputPath);

    await expect(verifyStreamRecordingArtifactIdentity(outputPath, identity)).resolves.toBe(true);
    writeFileSync(outputPath, "other-bytes");
    await expect(verifyStreamRecordingArtifactIdentity(outputPath, identity)).resolves.toBe(false);
  });

  it("preserves every section and commits no output when both formats fail", async () => {
    const { sections, destinationPath } = fixture();
    const spawnProcess = vi.fn(failedSpawn("assembly failed"));
    const finalizer = createStreamRecordingSectionFinalizer({
      spawnProcess,
      createNonce: () => "3",
    });

    await expect(
      finalizer.finalize({ ffmpegPath: "ffmpeg", destinationPath, sections })
    ).rejects.toThrow("Could not assemble the captured recording sections");

    expect(existsSync(destinationPath)).toBe(false);
    expect(existsSync(destinationPath.replace(/\.mp4$/, ".ts"))).toBe(false);
    expect(sections.map((section) => readFileSync(section.path, "utf8"))).toEqual([
      "sentinel-1|",
      "sentinel-2|",
      "sentinel-3|",
    ]);
  });

  it("never overwrites an existing destination or fallback file", async () => {
    const { sections, destinationPath } = fixture();
    const fallbackPath = destinationPath.replace(/\.mp4$/, ".ts");
    writeFileSync(destinationPath, "existing-mp4", { flag: "wx" });
    writeFileSync(fallbackPath, "existing-ts", { flag: "wx" });
    const finalizer = createStreamRecordingSectionFinalizer({
      spawnProcess: successfulConcatSpawn(),
      createNonce: () => "4",
    });

    await expect(
      finalizer.finalize({ ffmpegPath: "ffmpeg", destinationPath, sections })
    ).rejects.toThrow("Could not assemble the captured recording sections");

    expect(readFileSync(destinationPath, "utf8")).toBe("existing-mp4");
    expect(readFileSync(fallbackPath, "utf8")).toBe("existing-ts");
    expect(sections.map((section) => readFileSync(section.path, "utf8"))).toEqual([
      "sentinel-1|",
      "sentinel-2|",
      "sentinel-3|",
    ]);
  });

  it.each([
    "EPERM",
    "EXDEV",
    "EOPNOTSUPP",
  ])("uses exclusive no-clobber copy when hard links fail with %s", async (code) => {
    const linkFile = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }));
    const copyFileExclusive = vi.fn(async () => undefined);
    const commit = createAtomicNoClobberCommit({
      linkFile,
      copyFileExclusive,
    });

    await expect(commit("D:/Videos/temp.mp4", "D:/Videos/final.mp4")).resolves.toBeUndefined();

    expect(copyFileExclusive).toHaveBeenCalledWith("D:/Videos/temp.mp4", "D:/Videos/final.mp4");
  });

  it("uses exclusive copy on non-Windows filesystems without overwriting", async () => {
    const linkFile = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("unsupported"), { code: "EPERM" }));
    const copyFileExclusive = vi.fn(async () => undefined);
    const commit = createAtomicNoClobberCommit({
      linkFile,
      copyFileExclusive,
    });

    await commit("/videos/temp.mp4", "/videos/final.mp4");

    expect(copyFileExclusive).toHaveBeenCalledWith("/videos/temp.mp4", "/videos/final.mp4");
  });

  it("does not bypass an existing destination when the atomic link reports EEXIST", async () => {
    const existing = Object.assign(new Error("exists"), { code: "EEXIST" });
    const copyFileExclusive = vi.fn();
    const commit = createAtomicNoClobberCommit({
      linkFile: vi.fn().mockRejectedValue(existing),
      copyFileExclusive,
    });

    await expect(commit("D:/Videos/temp.mp4", "D:/Videos/final.mp4")).rejects.toBe(existing);
    expect(copyFileExclusive).not.toHaveBeenCalled();
  });

  it("preserves a destination created during the link-to-copy race", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-commit-race-"));
    temporaryDirectories.push(directory);
    const source = path.join(directory, "temp.mp4");
    const destination = path.join(directory, "final.mp4");
    writeFileSync(source, "new-output");
    const commit = createAtomicNoClobberCommit({
      linkFile: vi.fn(async () => {
        writeFileSync(destination, "race-winner", { flag: "wx" });
        throw Object.assign(new Error("hard links unsupported"), { code: "EPERM" });
      }),
      copyFileExclusive: async (from, to) => copyFileSync(from, to, constants.COPYFILE_EXCL),
    });

    await expect(commit(source, destination)).rejects.toMatchObject({ code: "EEXIST" });

    expect(readFileSync(destination, "utf8")).toBe("race-winner");
    expect(readFileSync(source, "utf8")).toBe("new-output");
  });

  it("normalizes Windows separators and escapes apostrophes in the concat manifest", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-'quoted'-"));
    temporaryDirectories.push(directory);
    const sectionPath = path.join(directory, "caster's section.ts");
    writeFileSync(sectionPath, "sentinel");
    const manifests: string[] = [];
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      manifests.push(readFileSync(args[args.indexOf("-i") + 1]!, "utf8"));
      return failedSpawn("expected probe failure")("", []);
    });
    const finalizer = createStreamRecordingSectionFinalizer({ spawnProcess });

    await expect(
      finalizer.finalize({
        ffmpegPath: "ffmpeg",
        destinationPath: path.join(directory, "output.mp4"),
        sections: [{ id: "part-1", path: sectionPath }],
      })
    ).rejects.toThrow("Could not assemble the captured recording sections");

    expect(manifests[0].replaceAll("'\\''", "'")).not.toContain("\\");
    expect(manifests[0]).toContain("caster'\\''s section.ts");
    expect(readFileSync(sectionPath, "utf8")).toBe("sentinel");
  });

  it.each([
    "line\nfeed.ts",
    "carriage\rreturn.ts",
  ])("rejects unsafe control characters in section path %j before spawning", async (unsafePath) => {
    const spawnProcess = vi.fn();
    const finalizer = createStreamRecordingSectionFinalizer({ spawnProcess });

    await expect(
      finalizer.finalize({
        ffmpegPath: "ffmpeg",
        destinationPath: "D:/Videos/output.mp4",
        sections: [{ id: "part-1", path: `D:/Videos/${unsafePath}` }],
      })
    ).rejects.toThrow("Recording section path is not safe to finalize");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
