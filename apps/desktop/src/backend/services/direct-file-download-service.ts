import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { net } from "electron";

import type { DirectDownloadInput } from "./clip-download-service";

export class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelledError";
  }
}

export type FetchFile = (
  url: string,
  init: { signal: AbortSignal; headers: HeadersInit }
) => Promise<Response>;

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) throw new DownloadCancelledError();
}

export async function downloadDirectFile({
  url,
  destinationPath,
  signal,
  onProgress,
  fetchFile = (requestUrl, init) => net.fetch(requestUrl, init),
}: DirectDownloadInput & { fetchFile?: FetchFile }): Promise<void> {
  const tempPath = `${destinationPath}.part`;
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await removeIfExists(tempPath);

  try {
    abortIfRequested(signal);
    const response = await fetchFile(url, {
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
      },
    });
    abortIfRequested(signal);

    if (!response.ok || !response.body) {
      throw new Error(`Download request failed with status ${response.status}`);
    }

    const totalBytesHeader = response.headers.get("content-length");
    const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : null;
    let transferredBytes = 0;
    const writer = createWriteStream(tempPath);
    const reader = response.body.getReader();

    try {
      while (true) {
        abortIfRequested(signal);
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        transferredBytes += value.byteLength;
        onProgress({
          percent: totalBytes ? (transferredBytes / totalBytes) * 100 : null,
          transferredBytes,
          totalBytes,
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end((error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });
      reader.releaseLock();
    }

    abortIfRequested(signal);
    await rename(tempPath, destinationPath);
  } catch (error) {
    if (signal.aborted || error instanceof DownloadCancelledError) {
      await removeIfExists(tempPath);
      throw new DownloadCancelledError();
    }
    throw error;
  }
}
