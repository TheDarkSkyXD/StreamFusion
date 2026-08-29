import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  downloadDirectFile,
  DownloadCancelledError,
} from "@backend/services/direct-file-download-service";

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Length": bytes.byteLength.toString(),
      },
    }
  );
}

describe("direct file downloader", () => {
  it("writes bytes to the destination and reports progress", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sf-download-"));
    const destinationPath = path.join(dir, "clip.mp4");
    const onProgress = vi.fn();

    await downloadDirectFile({
      url: "https://cdn.example/clip.mp4",
      destinationPath,
      signal: new AbortController().signal,
      onProgress,
      fetchFile: vi.fn(async () => bytesResponse(new Uint8Array([1, 2, 3]))),
    });

    await expect(readFile(destinationPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(onProgress).toHaveBeenLastCalledWith({
      percent: 100,
      transferredBytes: 3,
      totalBytes: 3,
    });
  });

  it("removes the temp file when the request is cancelled", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sf-download-"));
    const destinationPath = path.join(dir, "clip.mp4");
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadDirectFile({
        url: "https://cdn.example/clip.mp4",
        destinationPath,
        signal: controller.signal,
        onProgress: vi.fn(),
        fetchFile: vi.fn(async () => bytesResponse(new Uint8Array([1]))),
      })
    ).rejects.toBeInstanceOf(DownloadCancelledError);

    expect(existsSync(destinationPath)).toBe(false);
    expect(existsSync(`${destinationPath}.part`)).toBe(false);
  });

  it("keeps the temp file when a disk write fails after partial bytes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sf-download-"));
    const destinationPath = path.join(dir, "clip.mp4");

    await expect(
      downloadDirectFile({
        url: "https://cdn.example/clip.mp4",
        destinationPath,
        signal: new AbortController().signal,
        onProgress: vi.fn(() => {
          throw new Error("disk full");
        }),
        fetchFile: vi.fn(async () => bytesResponse(new Uint8Array([1, 2, 3]))),
      })
    ).rejects.toThrow("disk full");

    expect(existsSync(destinationPath)).toBe(false);
    await expect(readFile(`${destinationPath}.part`)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });
});
