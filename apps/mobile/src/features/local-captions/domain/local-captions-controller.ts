import {
  LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
  LOCAL_CAPTION_FIXTURE_INSTALL_URI,
  LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI,
  LOCAL_CAPTION_FIXTURE_PCM_URI,
} from "@streamfusion/core/local-captions";

import type {
  CaptionModelState,
  CaptionProofState,
  CaptionSessionState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { LocalCaptionsPort } from "../capabilities/local-captions";

export interface LocalCaptionsViewModel {
  readonly busy: boolean;
  readonly cueText: string;
  readonly model: CaptionModelState | null;
  readonly proof: CaptionProofState | null;
  readonly session: CaptionSessionState | null;
  readonly status: string | null;
}

export function createLocalCaptionsController(port: LocalCaptionsPort) {
  const listeners = new Set<() => void>();
  let disposed = false;
  let revision = 0;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeModel: (() => void) | null = null;
  let snapshot: LocalCaptionsViewModel = {
    busy: false,
    cueText: "",
    model: null,
    proof: null,
    session: null,
    status: null,
  };
  const update = (next: Partial<LocalCaptionsViewModel>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const connect = () => {
    disposed = false;
    if (unsubscribe) return;
    unsubscribeModel =
      port.subscribeModel?.((model) => {
        update({ model, status: model.statusMessage });
      }) ?? null;
    unsubscribe = port.subscribe((event) => {
      revision += 1;
      update({
        session: event,
        cueText: event.cueText,
        status: event.reason ?? snapshot.status,
      });
    });
  };

  async function refresh() {
    const readiness = port.readiness();
    if (readiness.kind === "unavailable") {
      update({ status: readiness.failure.diagnostic });
      return;
    }
    const currentRevision = revision;
    const [model, proof] = await Promise.all([
      port.getEnglishModelState(),
      port.getCaptionProof(),
    ]);
    if (disposed || currentRevision !== revision) return;
    update({
      ...(model.kind === "completed"
        ? { model: model.value }
        : { status: model.failure.diagnostic }),
      ...(proof.kind === "completed"
        ? {
            proof: proof.value,
            session: proof.value,
            cueText: proof.value.cueText,
          }
        : { status: proof.failure.diagnostic }),
    });
  }

  async function run(work: () => Promise<void>) {
    if (snapshot.busy || disposed) return;
    update({ busy: true, status: null });
    revision += 1;
    try {
      await work();
      await refresh();
    } catch (error) {
      update({
        status:
          error instanceof Error
            ? error.message
            : "Local caption operation failed.",
      });
    } finally {
      update({ busy: false });
    }
  }

  function applyModel(
    result: Awaited<ReturnType<LocalCaptionsPort["installEnglishModel"]>>,
  ) {
    revision += 1;
    if (result.kind === "completed") {
      update({ model: result.value, status: result.value.statusMessage });
    } else {
      update({ status: result.failure.diagnostic });
    }
  }

  function applySession(
    result: Awaited<
      ReturnType<LocalCaptionsPort["startFocusedCaptionSession"]>
    >,
  ) {
    revision += 1;
    if (result.kind === "completed") {
      update({
        session: result.value,
        cueText: result.value.cueText,
        status:
          result.value.reason ??
          (result.value.state === "active"
            ? "Local captions are listening to this stream's program audio."
            : "Local captions stopped."),
      });
    } else {
      update({ status: result.failure.diagnostic });
    }
  }

  const install = (sourceUri?: string) =>
    run(async () => {
      applyModel(
        await port.installEnglishModel({
          modelId: "english-v1",
          ...(sourceUri === undefined ? {} : { sourceUri }),
        }),
      );
    });
  const startSession = (sessionId: string, sourceUri?: string) =>
    run(async () => {
      if (
        sourceUri === undefined &&
        (snapshot.model?.pack !== "product" ||
          !snapshot.model.installed ||
          !snapshot.model.sha256Verified)
      ) {
        update({
          status:
            "Install the verified English speech model before starting local captions.",
        });
        return;
      }
      applySession(
        await port.startFocusedCaptionSession({
          modelId: "english-v1",
          sessionId,
          ...(sourceUri === undefined ? {} : { sourceUri }),
        }),
      );
    });
  return {
    connect,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      revision += 1;
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeModel?.();
      unsubscribeModel = null;
    },
    refresh,
    installModel: () => install(),
    cancelInstall: async () => {
      if (disposed) return;
      const result = await port.cancelEnglishModelInstall?.();
      if (!result)
        update({
          status: "Model download cancellation is unavailable in this host.",
        });
      else if (result.kind !== "completed")
        update({ status: result.failure.diagnostic });
    },
    installFixture: () => install(LOCAL_CAPTION_FIXTURE_INSTALL_URI),
    installIntegrityFail: () =>
      install(LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI),
    removeModel: () =>
      run(async () => {
        if (snapshot.session?.state === "active") {
          const stopped = await port.stopFocusedCaptionSession(
            snapshot.session.sessionId,
          );
          applySession(stopped);
          if (
            stopped.kind !== "completed" ||
            stopped.value.state === "rejected"
          )
            return;
        }
        applyModel(await port.removeEnglishModel({ modelId: "english-v1" }));
      }),
    queueConstraint: () =>
      run(async () => {
        applyModel(await port.queueDevelopmentCaptionConstraint());
      }),
    clearConstraint: () =>
      run(async () => {
        applyModel(await port.clearDevelopmentCaptionConstraint());
      }),
    startSession,
    startFixtureSession: () =>
      startSession("cap-fixture-diagnostics", LOCAL_CAPTION_FIXTURE_PCM_URI),
    startSecondSession: () =>
      startSession("cap-fixture-second", LOCAL_CAPTION_FIXTURE_PCM_URI),
    startConstrainedSession: () =>
      startSession(
        "cap-fixture-diagnostics",
        LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
      ),
    stopSession: (sessionId?: string) =>
      run(async () => {
        const id = sessionId ?? snapshot.session?.sessionId;
        if (id) applySession(await port.stopFocusedCaptionSession(id));
      }),
  };
}
