import { describe, expect, it, vi } from "vitest";

import type {
  CaptionModelState,
  CaptionSessionState,
  NativeCaptionEvent,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { LocalCaptionsPort } from "../capabilities/local-captions";
import { createLocalCaptionsController } from "../domain/local-captions-controller";

const missingModel: CaptionModelState = {
  audioUploadAttempts: 0,
  displaySize: "39.30 MiB",
  downloadedBytes: 0,
  expectedBytes: 41_205_931,
  installed: false,
  languageLabel: "English",
  license: "Apache-2.0",
  modelId: "english-v1",
  pack: "none",
  phase: "not-installed",
  sha256Verified: false,
  statusMessage: "Install the English model.",
};
const readyModel: CaptionModelState = {
  ...missingModel,
  installed: true,
  downloadedBytes: 41_205_931,
  pack: "product",
  phase: "ready",
  sha256Verified: true,
  statusMessage: "English model ready offline.",
};
const idleSession: CaptionSessionState = {
  audioLeftDevice: false,
  audioUploadAttempts: 0,
  cueText: "",
  microphonePermissionRequested: false,
  pcmBytesProcessed: 0,
  sessionId: "idle",
  state: "stopped",
};

function nativeBoundary() {
  let model = missingModel;
  let session = idleSession;
  let listener: ((event: NativeCaptionEvent) => void) | null = null;
  const calls: string[] = [];
  const port = {
    readiness: () => ({
      capability: "captions",
      contractVersion: 3,
      kind: "ready",
    }),
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    getEnglishModelState: async () => ({ kind: "completed", value: model }),
    getCaptionProof: async () => ({
      kind: "completed",
      value: { ...model, ...session },
    }),
    installEnglishModel: vi.fn(async (request) => {
      calls.push(`install:${request.sourceUri ?? "product"}`);
      model = request.sourceUri
        ? { ...readyModel, pack: "fixture" }
        : readyModel;
      return { kind: "completed", value: model };
    }),
    removeEnglishModel: async () => {
      calls.push("remove");
      model = missingModel;
      return { kind: "completed", value: model };
    },
    startFocusedCaptionSession: vi.fn(async (request) => {
      calls.push(
        `start:${request.sessionId}:${request.sourceUri ?? "program-pcm"}`,
      );
      session = {
        ...idleSession,
        sessionId: request.sessionId,
        state: "active",
      };
      return { kind: "completed", value: session };
    }),
    stopFocusedCaptionSession: async (id) => {
      calls.push(`stop:${id}`);
      session = { ...idleSession, sessionId: id };
      return { kind: "completed", value: session };
    },
    queueDevelopmentCaptionConstraint: async () => ({
      kind: "completed",
      value: model,
    }),
    clearDevelopmentCaptionConstraint: async () => ({
      kind: "completed",
      value: model,
    }),
  } satisfies LocalCaptionsPort;
  return {
    port,
    calls,
    emit: (event: NativeCaptionEvent) => listener?.(event),
  };
}

describe("production local captions controller", () => {
  it("installs a product model and starts only the actual player session", async () => {
    const native = nativeBoundary();
    const controller = createLocalCaptionsController(native.port);
    await controller.installModel();
    await controller.startSession("native-playback-42");
    expect(native.calls).toEqual([
      "install:product",
      "start:native-playback-42:program-pcm",
    ]);
    expect(controller.getSnapshot().session).toMatchObject({
      ...idleSession,
      sessionId: "native-playback-42",
      state: "active",
    });
    await controller.removeModel();
    expect(native.calls.slice(-2)).toEqual([
      "stop:native-playback-42",
      "remove",
    ]);
    expect(controller.getSnapshot().model?.installed).toBe(false);
    controller.dispose();
  });

  it("a diagnostics fixture never enables production captions", async () => {
    const native = nativeBoundary();
    const controller = createLocalCaptionsController(native.port);
    await controller.installFixture();
    await controller.startSession("real-player");
    expect(native.port.startFocusedCaptionSession).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toContain(
      "verified English speech model",
    );
    await controller.startFixtureSession();
    expect(native.port.startFocusedCaptionSession).toHaveBeenCalledWith({
      modelId: "english-v1",
      sessionId: "cap-fixture-diagnostics",
      sourceUri: "streamfusion-fixture://captions?pcm",
    });
    controller.dispose();
  });

  it("preserves the native unavailable reason without claiming an installed model", async () => {
    const native = nativeBoundary();
    const controller = createLocalCaptionsController({
      ...native.port,
      readiness: () => ({
        capability: "captions",
        kind: "unavailable",
        failure: {
          code: "NATIVE_BINDING_UNAVAILABLE",
          diagnostic: "Expo Go does not include the offline caption engine.",
        },
      }),
    });
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe(
      "Expo Go does not include the offline caption engine.",
    );
    expect(controller.getSnapshot().model).toBeNull();
    controller.dispose();
  });

  it("projects actual native cue events and detaches on disposal", async () => {
    const native = nativeBoundary();
    const controller = createLocalCaptionsController(native.port);
    controller.connect();
    const event: NativeCaptionEvent = {
      ...idleSession,
      kind: "cue",
      sessionId: "actual-player",
      state: "active",
      cueText: "one zero zero zero one",
      pcmBytesProcessed: 80_000,
    };
    native.emit(event);
    expect(controller.getSnapshot().cueText).toBe("one zero zero zero one");
    controller.dispose();
    native.emit({ ...event, cueText: "late cue" });
    expect(controller.getSnapshot().cueText).toBe("one zero zero zero one");
  });
});
