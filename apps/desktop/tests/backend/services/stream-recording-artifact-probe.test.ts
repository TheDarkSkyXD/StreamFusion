import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamRecordingArtifactProbe } from "@/backend/services/stream-recording-artifact-probe";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Guards: reconnect exhaustion may call an artifact Partial only after ffmpeg accepts non-empty media.
describe("Stream Recording artifact probe", () => {
  it("rejects missing or empty output before spawning ffmpeg", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-probe-"));
    temporaryDirectories.push(directory);
    const emptyPath = path.join(directory, "empty.mp4");
    writeFileSync(emptyPath, "");
    const spawnProcess = vi.fn();
    const probe = createStreamRecordingArtifactProbe({ spawnProcess });

    await expect(probe({ ffmpegPath: "ffmpeg", outputPath: emptyPath })).resolves.toBe(false);
    await expect(
      probe({ ffmpegPath: "ffmpeg", outputPath: path.join(directory, "missing.mp4") })
    ).resolves.toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("accepts non-empty output only when ffmpeg can read it", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-probe-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "partial.mp4");
    writeFileSync(outputPath, "media-bytes");
    const process = new EventEmitter();
    const spawnProcess = vi.fn(() => process);
    const probe = createStreamRecordingArtifactProbe({ spawnProcess });

    const result = probe({ ffmpegPath: "ffmpeg", outputPath });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    process.emit("close", 0);

    await expect(result).resolves.toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-i", outputPath, "-t", "0.1"])
    );
  });
});
