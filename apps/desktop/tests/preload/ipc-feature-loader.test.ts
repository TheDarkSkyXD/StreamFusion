import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createFeatureAwareIpc,
  createFeatureAwareInvoke,
  resolveIpcFeature,
  resolveIpcFeatures,
} from "@/preload/ipc-feature-loader";
import { IPC_CHANNELS, IPC_FEATURES } from "@/shared/ipc-channels";

// Guards: feature IPC requests load their handler chunk before sending the original request.
// Guards: concurrent and repeated requests share one feature-load operation.
// Guards: only the feature-loader transport bypasses on-demand handler loading.
// Guards: fire-and-forget shell and logging calls load their handler before sending.
// Guards: the sandboxed preload feature loader cannot import runtime schema compilers blocked by CSP.
describe("IPC feature loading", () => {
  it("keeps runtime schema compilers out of the sandboxed preload path", async () => {
    const source = await readFile(resolve("src/preload/ipc-feature-loader.ts"), "utf8");

    expect(source).not.toMatch(/(?:from\s+|import\()\s*["'][^"']*(?:zod|ipc-contracts)/);
  });

  it("maps split handler domains and special-case channels to their feature", () => {
    expect(resolveIpcFeature(IPC_CHANNELS.STREAMS_GET_TOP)).toBe(IPC_FEATURES.STREAMS);
    expect(resolveIpcFeature(IPC_CHANNELS.AUTH_TOKEN_STATUS)).toBe(IPC_FEATURES.TOKEN_STATUS);
    expect(resolveIpcFeature(IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW)).toBe(
      IPC_FEATURES.CHAT_REPLAY
    );
    expect(resolveIpcFeature(IPC_CHANNELS.APP_GET_VERSION)).toBe(IPC_FEATURES.SYSTEM);
    expect(resolveIpcFeature(IPC_CHANNELS.APP_GET_ENVIRONMENT)).toBe(IPC_FEATURES.APP);
    expect(resolveIpcFeature(IPC_CHANNELS.STORE_GET)).toBe(IPC_FEATURES.STORAGE);
    expect(resolveIpcFeatures(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL)).toEqual([
      IPC_FEATURES.STREAMS,
      IPC_FEATURES.PLAYBACK,
    ]);
  });

  it("loads a feature before invoking its handler", async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === IPC_CHANNELS.IPC_FEATURE_LOAD ? { kind: "ok", value: null } : channel
    );
    const featureInvoke = createFeatureAwareInvoke(invoke);

    await expect(featureInvoke(IPC_CHANNELS.STREAMS_GET_TOP, {})).resolves.toBe(
      IPC_CHANNELS.STREAMS_GET_TOP
    );
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.IPC_FEATURE_LOAD, IPC_FEATURES.STREAMS],
      [IPC_CHANNELS.STREAMS_GET_TOP, {}],
    ]);
  });

  it("accepts an empty success reply from the feature-loader transport", async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === IPC_CHANNELS.IPC_FEATURE_LOAD ? undefined : channel
    );
    const featureInvoke = createFeatureAwareInvoke(invoke);

    await expect(featureInvoke(IPC_CHANNELS.CONNECTIVITY_CHECK)).resolves.toBe(
      IPC_CHANNELS.CONNECTIVITY_CHECK
    );
  });

  it("shares one load across concurrent requests for the same feature", async () => {
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const invoke = vi.fn((channel: string) =>
      channel === IPC_CHANNELS.IPC_FEATURE_LOAD
        ? loadGate.then(() => ({ kind: "ok", value: null }))
        : Promise.resolve(channel)
    );
    const featureInvoke = createFeatureAwareInvoke(invoke);

    const first = featureInvoke(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const second = featureInvoke(IPC_CHANNELS.CATEGORIES_SEARCH, { query: "music" });
    expect(invoke).toHaveBeenCalledTimes(1);

    releaseLoad?.();
    await Promise.all([first, second]);
    expect(
      invoke.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.IPC_FEATURE_LOAD)
    ).toHaveLength(1);
  });

  it("invokes only the feature-loader transport directly", async () => {
    const invoke = vi.fn(async (channel: string) => channel);
    const featureInvoke = createFeatureAwareInvoke(invoke);

    await featureInvoke(IPC_CHANNELS.IPC_FEATURE_LOAD, IPC_FEATURES.SYSTEM);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.IPC_FEATURE_LOAD, IPC_FEATURES.SYSTEM);
  });

  it("loads a feature before a fire-and-forget send", async () => {
    const invoke = vi.fn().mockResolvedValue({ kind: "ok", value: null });
    const send = vi.fn();
    const featureIpc = createFeatureAwareIpc(invoke, send);

    featureIpc.send(IPC_CHANNELS.WINDOW_MINIMIZE);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MINIMIZE));
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.IPC_FEATURE_LOAD, IPC_FEATURES.SYSTEM);
  });

  it("rejects a malformed or failed feature-loader reply before invoking the feature", async () => {
    const malformed = createFeatureAwareInvoke(vi.fn().mockResolvedValue({ kind: "ok" }));
    await expect(malformed(IPC_CHANNELS.STREAMS_GET_TOP)).rejects.toThrow("invalid reply");

    const failed = createFeatureAwareInvoke(
      vi.fn().mockResolvedValue({
        kind: "error",
        error: {
          code: "internal",
          retry: { kind: "manual" },
          diagnosticId: "00000000-0000-4000-8000-000000000000",
        },
      })
    );
    await expect(failed(IPC_CHANNELS.STREAMS_GET_TOP)).rejects.toThrow(
      "00000000-0000-4000-8000-000000000000"
    );
  });
});
