import { describe, expect, it } from "vitest";

import {
  createAndroidCaptionsContractPort,
  createAndroidDiagnosticsContractPort,
  createAndroidMaintenanceContractPort,
  createAndroidMediaJobsContractPort,
  createAndroidPlaybackContractPort,
} from "../adapters/android-capability-contracts";
import type {
  ExpoBindingReader,
  ExpoCaptionsBinding,
  ExpoDiagnosticsBinding,
  ExpoMaintenanceBinding,
  ExpoMediaJobsBinding,
  ExpoPlaybackBinding,
} from "../adapters/expo-capability-contracts";
import { createAndroidCapabilityStubProof } from "../domain/android-capability-stub-proof";

const unsupported = async () => ({
  code: "NATIVE_OPERATION_UNSUPPORTED",
  diagnostic: "This operation belongs to a later Android capability ticket.",
  kind: "unsupported",
});

const playbackBinding: ExpoPlaybackBinding = {
  endFocusedSession: unsupported,
  enterPictureInPicture: unsupported,
  getContractVersion: () => 1,
  startFocusedSession: unsupported,
};
const mediaJobsBinding: ExpoMediaJobsBinding = {
  cancelRecoverableJob: unsupported,
  getContractVersion: () => 1,
  recoverJobs: unsupported,
  startRecoverableJob: unsupported,
};
const captionsBinding: ExpoCaptionsBinding = {
  getContractVersion: () => 1,
  installEnglishModel: unsupported,
  removeEnglishModel: unsupported,
  startFocusedCaptionSession: unsupported,
  stopFocusedCaptionSession: unsupported,
};
const diagnosticsBinding: ExpoDiagnosticsBinding = {
  getContractVersion: () => 1,
  readResourceSnapshot: unsupported,
};
const maintenanceBinding: ExpoMaintenanceBinding = {
  getContractVersion: () => 1,
  handoffVerifiedApk: unsupported,
  verifyDownloadedApk: unsupported,
};

function reader<TBinding>(binding: TBinding): ExpoBindingReader<TBinding> {
  return { read: () => binding };
}

describe("Android capability module contracts", () => {
  it("keeps each capability's typed unsupported operation contained", async () => {
    const contracts = {
      captions: createAndroidCaptionsContractPort(reader(captionsBinding)),
      diagnostics: createAndroidDiagnosticsContractPort(reader(diagnosticsBinding)),
      maintenance: createAndroidMaintenanceContractPort(reader(maintenanceBinding)),
      mediaJobs: createAndroidMediaJobsContractPort(reader(mediaJobsBinding)),
      playback: createAndroidPlaybackContractPort(reader(playbackBinding)),
    };

    expect(Object.values(contracts).map((port) => port.readiness())).toEqual([
      { capability: "captions", contractVersion: 1, kind: "ready" },
      { capability: "diagnostics", contractVersion: 1, kind: "ready" },
      { capability: "maintenance", contractVersion: 1, kind: "ready" },
      { capability: "media-jobs", contractVersion: 1, kind: "ready" },
      { capability: "playback", contractVersion: 1, kind: "ready" },
    ]);
    await expect(contracts.playback.enterPictureInPicture("watch-1")).resolves.toMatchObject({ kind: "unsupported", failure: { code: "NATIVE_OPERATION_UNSUPPORTED" } });
    await expect(contracts.mediaJobs.recoverJobs()).resolves.toMatchObject({ kind: "unsupported", failure: { code: "NATIVE_OPERATION_UNSUPPORTED" } });
    await expect(contracts.captions.installEnglishModel({ modelId: "english-v1" })).resolves.toMatchObject({ kind: "unsupported", failure: { code: "NATIVE_OPERATION_UNSUPPORTED" } });
    await expect(contracts.diagnostics.readResourceSnapshot()).resolves.toMatchObject({ kind: "unsupported", failure: { code: "NATIVE_OPERATION_UNSUPPORTED" } });
    await expect(contracts.maintenance.verifyDownloadedApk({ artifactUri: "file:///data/update.apk", expectedApplicationId: "com.thedarkskyxd.streamfusion", expectedSha256: "a".repeat(64), expectedSignerSha256: "b".repeat(64), minimumVersionCode: 2 })).resolves.toMatchObject({ kind: "unsupported", failure: { code: "NATIVE_OPERATION_UNSUPPORTED" } });
  });

  it("distinguishes missing bindings from failed invocation and malformed native responses", async () => {
    const absent: ExpoBindingReader<ExpoPlaybackBinding> = {
      read() {
        throw new Error("not linked");
      },
    };
    expect(createAndroidPlaybackContractPort(absent).readiness()).toMatchObject({
      capability: "playback",
      failure: { code: "NATIVE_BINDING_UNAVAILABLE" },
      kind: "unavailable",
    });

    expect(
      createAndroidDiagnosticsContractPort(
        reader({ ...diagnosticsBinding, getContractVersion: () => 2 }),
      ).readiness(),
    ).toMatchObject({
      failure: { code: "NATIVE_CONTRACT_VERSION_UNSUPPORTED" },
      kind: "unavailable",
    });

    await expect(
      createAndroidPlaybackContractPort(
        reader({
          ...playbackBinding,
          startFocusedSession: async () => {
            throw new Error("service crashed");
          },
        }),
      ).startFocusedSession({
        sessionId: "watch-1",
        sourceUri: "https://example.test/live.m3u8",
      }),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_INVOCATION_FAILED" },
      kind: "unavailable",
    });

    await expect(
      createAndroidDiagnosticsContractPort(
        reader({
          ...diagnosticsBinding,
          readResourceSnapshot: async () => ({ kind: "completed", value: { availableStorageBytes: -1 } }),
        }),
      ).readResourceSnapshot(),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_RESULT_INVALID" },
      kind: "unavailable",
    });

    await expect(
      createAndroidDiagnosticsContractPort(
        reader({
          ...diagnosticsBinding,
          readResourceSnapshot: async () => ({ kind: "unsupported" }),
        }),
      ).readResourceSnapshot(),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_RESULT_INVALID" },
      kind: "unavailable",
    });

  });

  it("parses typed successful results and rejects mismatched native identities", async () => {
    const playback = createAndroidPlaybackContractPort(reader({
      ...playbackBinding,
      startFocusedSession: async () => ({ kind: "completed", value: { pictureInPictureEligible: true, sessionId: "watch-1" } }),
    }));
    const mediaJobs = createAndroidMediaJobsContractPort(reader({
      ...mediaJobsBinding,
      startRecoverableJob: async () => ({ kind: "completed", value: { jobId: "job-1", kind: "download", phase: "queued" } }),
    }));
    const captions = createAndroidCaptionsContractPort(reader({
      ...captionsBinding,
      installEnglishModel: async () => ({ kind: "completed", value: { installed: true, modelId: "english-v1" } }),
    }));
    const diagnostics = createAndroidDiagnosticsContractPort(reader({
      ...diagnosticsBinding,
      readResourceSnapshot: async () => ({ kind: "completed", value: { availableStorageBytes: 1024, observedAtEpochMs: 1_700_000_000_000, thermalState: "nominal" } }),
    }));
    const maintenance = createAndroidMaintenanceContractPort(reader({
      ...maintenanceBinding,
      verifyDownloadedApk: async () => ({ kind: "completed", value: { applicationId: "com.thedarkskyxd.streamfusion", artifactUri: "file:///data/update.apk", sha256: "a".repeat(64), signerSha256: "b".repeat(64), versionCode: 2 } }),
    }));

    await expect(playback.startFocusedSession({ sessionId: "watch-1", sourceUri: "https://example.test/live.m3u8" })).resolves.toMatchObject({ kind: "completed", value: { sessionId: "watch-1" } });
    await expect(mediaJobs.startRecoverableJob({ jobId: "job-1", kind: "download", sourceUri: "https://example.test/video.mp4" })).resolves.toMatchObject({ kind: "completed", value: { jobId: "job-1" } });
    await expect(captions.installEnglishModel({ modelId: "english-v1" })).resolves.toMatchObject({ kind: "completed", value: { installed: true } });
    await expect(diagnostics.readResourceSnapshot()).resolves.toMatchObject({ kind: "completed", value: { thermalState: "nominal" } });
    await expect(maintenance.verifyDownloadedApk({ artifactUri: "file:///data/update.apk", expectedApplicationId: "com.thedarkskyxd.streamfusion", expectedSha256: "a".repeat(64), expectedSignerSha256: "b".repeat(64), minimumVersionCode: 2 })).resolves.toMatchObject({ kind: "completed", value: { versionCode: 2 } });

    await expect(
      createAndroidMaintenanceContractPort(
        reader({
          ...maintenanceBinding,
          verifyDownloadedApk: async () => ({
            kind: "completed",
            value: {
              applicationId: "com.thedarkskyxd.streamfusion",
              artifactUri: "file:///data/other.apk",
              sha256: "a".repeat(64),
              signerSha256: "b".repeat(64),
              versionCode: 2,
            },
          }),
        }),
      ).verifyDownloadedApk({
        artifactUri: "file:///data/update.apk",
        expectedApplicationId: "com.thedarkskyxd.streamfusion",
        expectedSha256: "a".repeat(64),
        expectedSignerSha256: "b".repeat(64),
        minimumVersionCode: 2,
      }),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_RESULT_INVALID" },
      kind: "unavailable",
    });
  });

  it("contains malformed native scalar values as invalid results", async () => {
    await expect(
      createAndroidDiagnosticsContractPort(
        reader({
          ...diagnosticsBinding,
          readResourceSnapshot: async () => ({
            kind: "completed",
            value: {
              availableStorageBytes: -1,
              observedAtEpochMs: 1_700_000_000_000,
              thermalState: "nominal",
            },
          }),
        }),
      ).readResourceSnapshot(),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_RESULT_INVALID" },
      kind: "unavailable",
    });

    await expect(
      createAndroidMaintenanceContractPort(
        reader({
          ...maintenanceBinding,
          verifyDownloadedApk: async () => ({
            kind: "completed",
            value: {
              applicationId: "com.thedarkskyxd.streamfusion",
              artifactUri: "file:///data/update.apk",
              sha256: "not-a-sha256",
              signerSha256: "b".repeat(64),
              versionCode: 2,
            },
          }),
        }),
      ).verifyDownloadedApk({
        artifactUri: "file:///data/update.apk",
        expectedApplicationId: "com.thedarkskyxd.streamfusion",
        expectedSha256: "a".repeat(64),
        expectedSignerSha256: "b".repeat(64),
        minimumVersionCode: 2,
      }),
    ).resolves.toMatchObject({
      failure: { code: "NATIVE_RESULT_INVALID" },
      kind: "unavailable",
    });
  });

  it("never invokes start, download, install, or handoff from the development proof", async () => {
    const calls: string[] = [];
    const unsafe = async () => {
      throw new Error("unsafe operation was invoked");
    };
    const proof = createAndroidCapabilityStubProof({
      captions: createAndroidCaptionsContractPort(reader({ ...captionsBinding, installEnglishModel: unsafe, removeEnglishModel: unsafe, startFocusedCaptionSession: unsafe, stopFocusedCaptionSession: async () => { calls.push("captions.stop"); return unsupported(); } })),
      diagnostics: createAndroidDiagnosticsContractPort(reader({ ...diagnosticsBinding, readResourceSnapshot: async () => { calls.push("diagnostics.snapshot"); return unsupported(); } })),
      maintenance: createAndroidMaintenanceContractPort(reader({ ...maintenanceBinding, handoffVerifiedApk: unsafe, verifyDownloadedApk: async () => { calls.push("maintenance.verify"); return unsupported(); } })),
      mediaJobs: createAndroidMediaJobsContractPort(reader({ ...mediaJobsBinding, cancelRecoverableJob: async () => { calls.push("media.cancel"); return unsupported(); }, recoverJobs: unsafe, startRecoverableJob: unsafe })),
      playback: createAndroidPlaybackContractPort(reader({ ...playbackBinding, endFocusedSession: async () => { calls.push("playback.end"); return unsupported(); }, enterPictureInPicture: unsafe, startFocusedSession: unsafe })),
    });

    await expect(proof.run()).resolves.toMatchObject({ kind: "safe-stubs" });
    expect(calls).toEqual([
      "playback.end",
      "media.cancel",
      "captions.stop",
      "diagnostics.snapshot",
      "maintenance.verify",
    ]);
  });
});
