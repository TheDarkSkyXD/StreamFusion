import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalCaptionModelPack } from "@backend/services/captions/caption-model-catalog";
import { LocalCaptionModelStore } from "@backend/services/captions/caption-model-store";

const roots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function testModel(artifacts: Record<string, Uint8Array>): LocalCaptionModelPack {
  const files = Object.entries(artifacts).map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    url: `https://models.example.test/revision/${path}`,
  }));
  const downloadBytes = files.reduce((total, file) => total + file.size, 0);

  return {
    id: "test-english-model",
    revision: "reviewed-revision",
    languageLabel: "English",
    languageTag: "en",
    downloadBytes,
    installedBytes: downloadBytes,
    displaySize: `${downloadBytes} bytes`,
    license: "Apache-2.0",
    sourceName: "Test model host",
    sourceUrl: "https://models.example.test",
    files,
  };
}

function downloadManifest(model: LocalCaptionModelPack) {
  return {
    schemaVersion: 1,
    modelId: model.id,
    revision: model.revision,
    files: model.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  };
}

async function temporaryModelsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "streamfusion-caption-model-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Guards: streamed bytes cannot exceed either the artifact or aggregate catalog ceilings.
// Guards: failed or interrupted replacement activation preserves the verified active model.
// Guards: a model is never reported ready until every pinned artifact and the exact manifest are verified and atomically activated.
describe("LocalCaptionModelStore", () => {
  it("downloads verified artifacts with progress and atomically activates the exact manifest", async () => {
    const artifacts = {
      "encoder.onnx": new Uint8Array([1, 2, 3, 4]),
      "tokens.txt": new TextEncoder().encode("blank\nhello\n"),
    };
    const model = testModel(artifacts);
    const fetchModel = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname.split("/").at(-1);
      const bytes = artifacts[path as keyof typeof artifacts];
      return new Response(bytes, { status: 200 });
    });
    const modelsRoot = await temporaryModelsRoot();
    const progress: number[] = [];
    const store = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    expect(await store.getState()).toMatchObject({
      phase: "not-installed",
      downloadedBytes: 0,
      license: "Apache-2.0",
      sourceUrl: model.sourceUrl,
    });

    const activePath = await store.install({
      onProgress: (state) => progress.push(state.downloadedBytes ?? 0),
    });

    expect(activePath).toBe(join(modelsRoot, model.id));
    expect(progress.at(-1)).toBe(model.downloadBytes);
    expect(await store.getActiveModelPath()).toBe(activePath);
    expect(await store.getState()).toMatchObject({
      phase: "ready",
      downloadedBytes: model.downloadBytes,
    });
    expect(await readdir(modelsRoot)).toEqual([model.id]);
    expect(JSON.parse(await readFile(join(activePath, "manifest.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      modelId: model.id,
      revision: model.revision,
      languageTag: model.languageTag,
      license: model.license,
      totalBytes: model.installedBytes,
      files: model.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    });
    for (const [path, bytes] of Object.entries(artifacts)) {
      expect(Array.from(await readFile(join(activePath, path)))).toEqual(Array.from(bytes));
    }
  });

  it("restores a verified active model when replacement activation fails", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const fetchModel = async () => new Response(bytes, { status: 200 });
    const installed = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });
    const activePath = await installed.install();
    const replacement = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: fetchModel,
      rename: async (source, destination) => {
        if (source.toString().endsWith(`.${model.id}.staging`) && destination === activePath) {
          throw new Error("injected activation rename failure");
        }
        await rename(source, destination);
      },
    });

    await expect(replacement.install()).rejects.toThrow("injected activation rename failure");

    expect(await replacement.getActiveModelPath()).toBe(activePath);
    expect(Array.from(await readFile(join(activePath, "encoder.onnx")))).toEqual(Array.from(bytes));
    expect(await readdir(modelsRoot)).toEqual([model.id]);

    await new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel }).install();
    expect(await readdir(modelsRoot)).toEqual([model.id]);
  });

  it("recovers a verified backup left by an interrupted replacement", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(bytes, { status: 200 }),
    });
    const activePath = await store.install();
    await rename(activePath, join(modelsRoot, `.${model.id}.backup`));

    const reopened = new LocalCaptionModelStore({ modelsRoot, model });

    expect(await reopened.getActiveModelPath()).toBe(activePath);
    expect(await readdir(modelsRoot)).toEqual([model.id]);
  });

  it("resumes an interrupted artifact with an exact HTTP byte range", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const stagePath = join(modelsRoot, `.${model.id}.staging`);
    await mkdir(stagePath, { recursive: true });
    await writeFile(
      join(stagePath, "download-manifest.json"),
      JSON.stringify(downloadManifest(model))
    );
    await writeFile(join(stagePath, "encoder.onnx"), bytes.slice(0, 3));
    const fetchModel = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=3-");
      return new Response(bytes.slice(3), {
        status: 206,
        headers: { "Content-Range": `bytes 3-5/${bytes.byteLength}` },
      });
    });
    const progress: number[] = [];
    const store = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    await store.install({
      onProgress: (state) => progress.push(state.downloadedBytes ?? 0),
    });

    expect(progress[0]).toBe(3);
    expect(fetchModel).toHaveBeenCalledOnce();
    expect(Array.from(await readFile(join(modelsRoot, model.id, "encoder.onnx")))).toEqual(
      Array.from(bytes)
    );
  });

  it.each([
    {
      label: "ignores Range",
      response: (bytes: Uint8Array) => new Response(Uint8Array.from(bytes).buffer, { status: 200 }),
    },
    {
      label: "returns the wrong Content-Range",
      response: (bytes: Uint8Array) =>
        new Response(Uint8Array.from(bytes.slice(3)).buffer, {
          status: 206,
          headers: { "Content-Range": `bytes 2-5/${bytes.byteLength}` },
        }),
    },
  ])("rejects and cleans staged bytes when the server $label", async ({ response }) => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const stagePath = join(modelsRoot, `.${model.id}.staging`);
    await mkdir(stagePath, { recursive: true });
    await writeFile(
      join(stagePath, "download-manifest.json"),
      JSON.stringify(downloadManifest(model))
    );
    await writeFile(join(stagePath, "encoder.onnx"), bytes.slice(0, 3));
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => response(bytes),
    });

    await expect(store.install()).rejects.toMatchObject({
      name: "ModelIntegrityError",
      message: expect.stringContaining("byte range response"),
    });
    expect(await readdir(modelsRoot)).toEqual([]);
  });

  it("rejects an oversized response chunk before retaining staged bytes", async () => {
    const expected = new Uint8Array([1, 2, 3, 4]);
    const model = testModel({ "encoder.onnx": expected });
    const modelsRoot = await temporaryModelsRoot();
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }),
    });

    await expect(store.install()).rejects.toMatchObject({
      name: "ModelIntegrityError",
      message: expect.stringContaining("allowlisted size"),
    });
    expect(await readdir(modelsRoot)).toEqual([]);
  });

  it("rejects a multi-chunk response that exceeds the aggregate allowlisted download size", async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const model = { ...testModel({ "encoder.onnx": expected }), downloadBytes: 4 };
    const modelsRoot = await temporaryModelsRoot();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(expected.slice(0, 3));
        controller.enqueue(expected.slice(3, 5));
        controller.close();
      },
    });
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(body, { status: 200 }),
    });

    await expect(store.install()).rejects.toMatchObject({
      name: "ModelIntegrityError",
      message: expect.stringContaining("aggregate allowlisted download size"),
    });
    expect(await readdir(modelsRoot)).toEqual([]);
  });

  it("preserves a retriable stream interruption and range-resumes it on the next install", async () => {
    const bytes = new Uint8Array([11, 22, 33, 44, 55, 66]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    let attempt = 0;
    const fetchModel = vi.fn(async (_input: string, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        let sentPrefix = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sentPrefix) {
                sentPrefix = true;
                controller.enqueue(bytes.slice(0, 3));
                return;
              }
              controller.error(new Error("socket reset"));
            },
          }),
          { status: 200 }
        );
      }

      expect(new Headers(init?.headers).get("Range")).toBe("bytes=3-");
      return new Response(bytes.slice(3), {
        status: 206,
        headers: { "Content-Range": `bytes 3-5/${bytes.byteLength}` },
      });
    });
    const store = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    await expect(store.install()).rejects.toThrow("socket reset");
    expect(await store.getState()).toMatchObject({
      phase: "not-installed",
      downloadedBytes: 3,
      error: "socket reset",
    });

    await store.install();

    expect(fetchModel).toHaveBeenCalledTimes(2);
    expect(await store.getState()).toMatchObject({
      phase: "ready",
      downloadedBytes: model.downloadBytes,
    });
  });

  it("discards staged bytes when the allowlisted catalog revision changes", async () => {
    const oldBytes = new Uint8Array([1, 1, 1, 1, 1, 1]);
    const newBytes = new Uint8Array([2, 2, 2, 2, 2, 2]);
    const oldModel = testModel({ "encoder.onnx": oldBytes });
    const model: LocalCaptionModelPack = {
      ...testModel({ "encoder.onnx": newBytes }),
      revision: "new-reviewed-revision",
    };
    const modelsRoot = await temporaryModelsRoot();
    const stagePath = join(modelsRoot, `.${model.id}.staging`);
    await mkdir(stagePath, { recursive: true });
    await writeFile(
      join(stagePath, "download-manifest.json"),
      JSON.stringify(downloadManifest(oldModel))
    );
    await writeFile(join(stagePath, "encoder.onnx"), oldBytes.slice(0, 3));
    const fetchModel = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Range")).toBeNull();
      return new Response(newBytes, { status: 200 });
    });
    const store = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    await store.install();

    expect(fetchModel).toHaveBeenCalledOnce();
    expect(Array.from(await readFile(join(modelsRoot, model.id, "encoder.onnx")))).toEqual(
      Array.from(newBytes)
    );
  });

  it("cleans staged bytes after a non-retriable HTTP failure", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const stagePath = join(modelsRoot, `.${model.id}.staging`);
    await mkdir(stagePath, { recursive: true });
    await writeFile(
      join(stagePath, "download-manifest.json"),
      JSON.stringify(downloadManifest(model))
    );
    await writeFile(join(stagePath, "encoder.onnx"), bytes.slice(0, 3));
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(null, { status: 403 }),
    });

    await expect(store.install()).rejects.toThrow("HTTP 403");

    expect(await readdir(modelsRoot)).toEqual([]);
    expect(await store.getState()).toMatchObject({
      phase: "not-installed",
      downloadedBytes: 0,
      error: expect.stringContaining("HTTP 403"),
    });
  });

  it("explicitly cancels an in-flight download and removes its staging files", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const fetchModel = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const store = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    const installation = store.install({
      onProgress: (state) => {
        if ((state.downloadedBytes ?? 0) > 0) store.cancel();
      },
    });

    await expect(installation).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(modelsRoot)).toEqual([]);
    expect(await store.getActiveModelPath()).toBeNull();
    expect(await store.getState()).toMatchObject({ phase: "not-installed", downloadedBytes: 0 });
  });

  it("rejects a same-size SHA mismatch without activating or retaining staging files", async () => {
    const expected = new Uint8Array([1, 2, 3, 4]);
    const corrupt = new Uint8Array([4, 3, 2, 1]);
    const model = testModel({ "encoder.onnx": expected });
    const modelsRoot = await temporaryModelsRoot();
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(corrupt, { status: 200 }),
    });

    await expect(store.install()).rejects.toMatchObject({
      name: "ModelIntegrityError",
      message: expect.stringContaining("SHA-256"),
    });

    expect(await readdir(modelsRoot)).toEqual([]);
    expect(await store.getActiveModelPath()).toBeNull();
    expect(await store.getState()).toMatchObject({
      phase: "integrity-error",
      downloadedBytes: 0,
      error: expect.stringContaining("SHA-256"),
    });
  });

  it("refuses an installed directory whose manifest file set is not exact", async () => {
    const bytes = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const fetchModel = async () => new Response(bytes, { status: 200 });
    const installer = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });
    const activePath = await installer.install();
    await writeFile(join(activePath, "unreviewed.bin"), new Uint8Array([1]));

    const reopened = new LocalCaptionModelStore({ modelsRoot, model, fetch: fetchModel });

    expect(await reopened.getActiveModelPath()).toBeNull();
    expect(await reopened.getState()).toMatchObject({
      phase: "integrity-error",
      error: expect.stringContaining("exactly match"),
    });
  });

  it("removes the activated model and returns to not-installed", async () => {
    const bytes = new Uint8Array([2, 4, 6, 8]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(bytes, { status: 200 }),
    });
    await store.install();

    await store.remove();

    expect(await readdir(modelsRoot)).toEqual([]);
    expect(await store.getActiveModelPath()).toBeNull();
    expect(await store.getState()).toMatchObject({ phase: "not-installed", downloadedBytes: 0 });
  });

  it("publishes state changes to subscribers until they unsubscribe", async () => {
    const bytes = new Uint8Array([1, 3, 3, 7]);
    const model = testModel({ "encoder.onnx": bytes });
    const modelsRoot = await temporaryModelsRoot();
    const store = new LocalCaptionModelStore({
      modelsRoot,
      model,
      fetch: async () => new Response(bytes, { status: 200 }),
    });
    const phases: string[] = [];
    const unsubscribe = store.subscribe((state) => phases.push(state.phase));

    await store.install();

    expect(phases).toContain("downloading");
    expect(phases.at(-1)).toBe("ready");
    unsubscribe();
    await store.remove();
    expect(phases.at(-1)).toBe("ready");
  });
});
