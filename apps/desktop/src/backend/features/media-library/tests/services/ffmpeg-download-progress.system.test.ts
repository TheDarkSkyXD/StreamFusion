import { spawnSync } from "node:child_process";
import { createReadStream, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  downloadHlsWithFfmpeg,
  resolveFfmpegPath,
} from "@backend/features/media-library/adapters/ffmpeg/ffmpeg-download-service";

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

// Guards: finite HLS downloads must derive useful progress from the real bundled FFmpeg when upstream metadata has no duration.
describe.runIf(process.platform === "win32")("Windows FFmpeg download progress", () => {
  it("reports multiple intermediate percentages for finite HLS without a supplied duration", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-download-progress-"));
    temporaryDirectories.push(directory);
    const ffmpegPath = resolveFfmpegPath();
    const playlistPath = path.join(directory, "source.m3u8");
    const generated = spawnSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x90:rate=25",
        "-t",
        "12",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-g",
        "25",
        "-hls_time",
        "1",
        "-hls_list_size",
        "0",
        playlistPath,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    expect(generated.status, generated.stderr).toBe(0);

    const server = createServer((request, response) => {
      const requestedName = path.basename(new URL(request.url ?? "/", "http://localhost").pathname);
      if (!readdirSync(directory).includes(requestedName)) {
        response.writeHead(404).end();
        return;
      }
      const send = () => createReadStream(path.join(directory, requestedName)).pipe(response);
      if (requestedName.endsWith(".ts")) setTimeout(send, 150);
      else send();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const percentages: number[] = [];
      await downloadHlsWithFfmpeg({
        ffmpegPath,
        inputUrl: `http://127.0.0.1:${address.port}/source.m3u8`,
        destinationPath: path.join(directory, "download.mp4"),
        durationSeconds: null,
        signal: new AbortController().signal,
        onProgress: (progress) => {
          if (progress.percent !== null && progress.percent > 0 && progress.percent < 100) {
            percentages.push(progress.percent);
          }
        },
      });

      expect(percentages.length).toBeGreaterThanOrEqual(2);
      expect(percentages.every((percent) => Number.isFinite(percent))).toBe(true);
      expect(percentages).toEqual([...percentages].sort((left, right) => left - right));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 120_000);
});
