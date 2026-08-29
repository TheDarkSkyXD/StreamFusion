import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

import type { LocalCaptionModelState } from "@shared/local-caption-types";

import { ENGLISH_ZIPFORMER_20M_MODEL, type LocalCaptionModelPack } from "./caption-model-catalog";

interface ModelManifest {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  languageTag: string;
  license: string;
  totalBytes: number;
  files: Array<{ path: string; size: number; sha256: string }>;
}

interface DownloadManifest {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

type FetchModel = (input: string, init?: RequestInit) => Promise<Response>;
type RenamePath = typeof rename;

export interface LocalCaptionModelStoreOptions {
  modelsRoot: string;
  model?: LocalCaptionModelPack;
  fetch?: FetchModel;
  rename?: RenamePath;
}

export interface InstallLocalCaptionModelOptions {
  signal?: AbortSignal;
  onProgress?: (state: LocalCaptionModelState) => void;
}

export type LocalCaptionModelStateListener = (state: LocalCaptionModelState) => void;

export class ModelIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelIntegrityError";
  }
}

class RetriableModelDownloadError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "RetriableModelDownloadError";
  }
}

function missing(path: string): Promise<boolean> {
  return stat(path).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return true;
      throw error;
    }
  );
}

function safeArtifactPath(root: string, artifactPath: string): string {
  const normalized = normalize(artifactPath);
  if (
    !artifactPath ||
    isAbsolute(artifactPath) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new ModelIntegrityError(`Unsafe model artifact path: ${artifactPath}`);
  }

  const destination = join(root, normalized);
  if (relative(root, destination).startsWith("..")) {
    throw new ModelIntegrityError(`Unsafe model artifact path: ${artifactPath}`);
  }
  return destination;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function abortError(): DOMException {
  return new DOMException("Model download cancelled", "AbortError");
}

export class LocalCaptionModelStore {
  readonly #modelsRoot: string;
  readonly #model: LocalCaptionModelPack;
  readonly #fetch: FetchModel;
  readonly #rename: RenamePath;
  #state: LocalCaptionModelState;
  #downloadController: AbortController | null = null;
  readonly #listeners = new Set<LocalCaptionModelStateListener>();

  constructor({
    modelsRoot,
    model = ENGLISH_ZIPFORMER_20M_MODEL,
    fetch = globalThis.fetch,
    rename: renamePath = rename,
  }: LocalCaptionModelStoreOptions) {
    this.#modelsRoot = modelsRoot;
    this.#model = model;
    this.#fetch = fetch;
    this.#rename = renamePath;
    this.#state = this.#baseState("not-installed", 0);
  }

  subscribe(listener: LocalCaptionModelStateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async getState(): Promise<LocalCaptionModelState> {
    if (
      this.#state.phase === "downloading" ||
      this.#state.phase === "integrity-error" ||
      this.#state.error
    ) {
      return { ...this.#state };
    }

    await this.#recoverBackup();
    const activePath = this.#activePath();
    if (await missing(activePath)) {
      this.#setState(this.#baseState("not-installed", 0));
      return { ...this.#state };
    }

    try {
      await this.#verifyDirectory(activePath);
      this.#setState(this.#baseState("ready", this.#model.downloadBytes));
    } catch (error) {
      this.#setState({
        ...this.#baseState("integrity-error", 0),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { ...this.#state };
  }

  async getActiveModelPath(): Promise<string | null> {
    await this.#recoverBackup();
    const activePath = this.#activePath();
    if (await missing(activePath)) return null;
    try {
      await this.#verifyDirectory(activePath);
      return activePath;
    } catch {
      return null;
    }
  }

  async install(options: InstallLocalCaptionModelOptions = {}): Promise<string> {
    if (this.#downloadController) throw new Error("A model download is already in progress");

    const controller = new AbortController();
    this.#downloadController = controller;
    const cancelFromCaller = () => controller.abort(abortError());
    options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
    if (options.signal?.aborted) cancelFromCaller();

    const stagePath = this.#stagePath();
    let downloadedBytes = 0;
    const reportProgress = () => {
      this.#setState(this.#baseState("downloading", downloadedBytes));
      options.onProgress?.({ ...this.#state });
    };

    try {
      await mkdir(this.#modelsRoot, { recursive: true });
      await this.#recoverBackup();
      await this.#prepareStage(stagePath);

      for (const artifact of this.#model.files) {
        const destination = safeArtifactPath(stagePath, artifact.path);
        if (!(await missing(destination))) {
          const partialSize = (await stat(destination)).size;
          if (partialSize <= artifact.size) downloadedBytes += partialSize;
          else await rm(destination, { force: true });
        }
      }
      reportProgress();

      for (const artifact of this.#model.files) {
        if (controller.signal.aborted) throw abortError();
        const destination = safeArtifactPath(stagePath, artifact.path);
        let offset = (await missing(destination)) ? 0 : (await stat(destination)).size;
        if (offset === artifact.size) {
          if ((await sha256File(destination)) === artifact.sha256) continue;
          downloadedBytes -= offset;
          offset = 0;
          await rm(destination, { force: true });
          reportProgress();
        }

        let response: Response;
        try {
          response = await this.#fetch(artifact.url, {
            signal: controller.signal,
            headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
          });
        } catch (error) {
          if (controller.signal.aborted) throw abortError();
          throw new RetriableModelDownloadError(
            error instanceof Error ? error.message : String(error),
            error
          );
        }
        if (!response.ok || !response.body) {
          throw new Error(`Model host returned HTTP ${response.status} for ${artifact.path}`);
        }

        const append = offset > 0;
        if (append) {
          if (response.status !== 206) {
            throw new ModelIntegrityError(`Invalid byte range response for ${artifact.path}`);
          }
          const contentRange = response.headers.get("Content-Range");
          if (contentRange !== `bytes ${offset}-${artifact.size - 1}/${artifact.size}`) {
            throw new ModelIntegrityError(`Invalid byte range response for ${artifact.path}`);
          }
        } else if (response.status !== 200) {
          throw new ModelIntegrityError(`Invalid full download response for ${artifact.path}`);
        }

        await mkdir(dirname(destination), { recursive: true });
        const file = await open(destination, append ? "a" : "w");
        try {
          const reader = response.body.getReader();
          let artifactBytes = offset;
          while (true) {
            let result: ReadableStreamReadResult<Uint8Array>;
            try {
              result = await reader.read();
            } catch (error) {
              if (controller.signal.aborted) throw abortError();
              throw new RetriableModelDownloadError(
                error instanceof Error ? error.message : String(error),
                error
              );
            }
            const { done, value } = result;
            if (done) break;
            if (controller.signal.aborted) throw abortError();
            const nextArtifactBytes = artifactBytes + value.byteLength;
            if (nextArtifactBytes > artifact.size) {
              const error = new ModelIntegrityError(
                `${artifact.path} exceeds its allowlisted size of ${artifact.size} bytes`
              );
              await reader.cancel(error).catch(() => undefined);
              throw error;
            }
            const nextDownloadedBytes = downloadedBytes + value.byteLength;
            if (nextDownloadedBytes > this.#model.downloadBytes) {
              const error = new ModelIntegrityError(
                `Model download exceeds its aggregate allowlisted download size of ${this.#model.downloadBytes} bytes`
              );
              await reader.cancel(error).catch(() => undefined);
              throw error;
            }
            await file.write(value);
            artifactBytes = nextArtifactBytes;
            downloadedBytes = nextDownloadedBytes;
            reportProgress();
          }
          if (controller.signal.aborted) throw abortError();
        } finally {
          await file.close();
        }

        const fileStat = await stat(destination);
        if (fileStat.size !== artifact.size) {
          throw new ModelIntegrityError(
            `${artifact.path} size mismatch: expected ${artifact.size}, received ${fileStat.size}`
          );
        }
        const actualSha = await sha256File(destination);
        if (actualSha !== artifact.sha256) {
          throw new ModelIntegrityError(`${artifact.path} SHA-256 mismatch`);
        }
      }

      if (controller.signal.aborted) throw abortError();
      await rm(join(stagePath, "download-manifest.json"), { force: true });
      await writeFile(join(stagePath, "manifest.json"), JSON.stringify(this.#manifest(), null, 2));
      await this.#verifyDirectory(stagePath);
      await this.#activateStage(stagePath);
      this.#setState(this.#baseState("ready", this.#model.downloadBytes));
      return this.#activePath();
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const retriable = error instanceof RetriableModelDownloadError && !cancelled;
      if (!retriable) await rm(stagePath, { recursive: true, force: true });
      if (cancelled) {
        this.#setState(this.#baseState("not-installed", 0));
        throw abortError();
      }
      this.#setState({
        ...this.#baseState(
          error instanceof ModelIntegrityError ? "integrity-error" : "not-installed",
          retriable ? downloadedBytes : 0
        ),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancelFromCaller);
      this.#downloadController = null;
    }
  }

  cancel(): void {
    this.#downloadController?.abort(abortError());
  }

  async remove(): Promise<void> {
    this.cancel();
    await Promise.all([
      rm(this.#activePath(), { recursive: true, force: true }),
      rm(this.#stagePath(), { recursive: true, force: true }),
      rm(this.#backupPath(), { recursive: true, force: true }),
    ]);
    this.#setState(this.#baseState("not-installed", 0));
  }

  #setState(state: LocalCaptionModelState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener({ ...state });
      } catch {
        // A renderer notification failure must not corrupt an in-progress model operation.
      }
    }
  }

  #baseState(
    phase: LocalCaptionModelState["phase"],
    downloadedBytes: number
  ): LocalCaptionModelState {
    return {
      phase,
      languageLabel: this.#model.languageLabel,
      languageTag: this.#model.languageTag,
      downloadBytes: this.#model.downloadBytes,
      installedBytes: this.#model.installedBytes,
      displaySize: this.#model.displaySize,
      license: this.#model.license,
      sourceName: this.#model.sourceName,
      sourceUrl: this.#model.sourceUrl,
      downloadedBytes,
    };
  }

  #activePath(): string {
    return join(this.#modelsRoot, this.#model.id);
  }

  #stagePath(): string {
    return join(this.#modelsRoot, `.${this.#model.id}.staging`);
  }

  #backupPath(): string {
    return join(this.#modelsRoot, `.${this.#model.id}.backup`);
  }

  async #recoverBackup(): Promise<void> {
    const activePath = this.#activePath();
    const backupPath = this.#backupPath();
    if (await missing(backupPath)) return;
    if (await missing(activePath)) {
      await this.#rename(backupPath, activePath);
      return;
    }
    await rm(backupPath, { recursive: true, force: true });
  }

  async #activateStage(stagePath: string): Promise<void> {
    const activePath = this.#activePath();
    const backupPath = this.#backupPath();
    await rm(backupPath, { recursive: true, force: true });
    const replacingActive = !(await missing(activePath));
    if (replacingActive) await this.#rename(activePath, backupPath);

    try {
      await this.#rename(stagePath, activePath);
    } catch (error) {
      if (replacingActive) await this.#rename(backupPath, activePath);
      throw error;
    }

    await rm(backupPath, { recursive: true, force: true });
  }

  #downloadManifest(): DownloadManifest {
    return {
      schemaVersion: 1,
      modelId: this.#model.id,
      revision: this.#model.revision,
      files: this.#model.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    };
  }

  async #prepareStage(stagePath: string): Promise<void> {
    if (!(await missing(stagePath))) {
      try {
        const manifest = JSON.parse(
          await readFile(join(stagePath, "download-manifest.json"), "utf8")
        );
        if (JSON.stringify(manifest) !== JSON.stringify(this.#downloadManifest())) {
          await rm(stagePath, { recursive: true, force: true });
        }
      } catch {
        await rm(stagePath, { recursive: true, force: true });
      }
    }

    await mkdir(stagePath, { recursive: true });
    await writeFile(
      join(stagePath, "download-manifest.json"),
      JSON.stringify(this.#downloadManifest())
    );
  }

  #manifest(): ModelManifest {
    return {
      schemaVersion: 1,
      modelId: this.#model.id,
      revision: this.#model.revision,
      languageTag: this.#model.languageTag,
      license: this.#model.license,
      totalBytes: this.#model.installedBytes,
      files: this.#model.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    };
  }

  async #verifyDirectory(directory: string): Promise<void> {
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    } catch {
      throw new ModelIntegrityError("Model manifest is missing or invalid");
    }
    if (JSON.stringify(manifest) !== JSON.stringify(this.#manifest())) {
      throw new ModelIntegrityError("Model manifest does not match the allowlisted revision");
    }

    const expectedEntries = ["manifest.json", ...this.#model.files.map((file) => file.path)].sort();
    const actualEntries = (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
      .sort();
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw new ModelIntegrityError("Installed model files do not exactly match the manifest");
    }

    for (const artifact of this.#model.files) {
      const artifactPath = safeArtifactPath(directory, artifact.path);
      const artifactStat = await stat(artifactPath);
      if (
        artifactStat.size !== artifact.size ||
        (await sha256File(artifactPath)) !== artifact.sha256
      ) {
        throw new ModelIntegrityError(`${artifact.path} failed integrity verification`);
      }
    }
  }
}
