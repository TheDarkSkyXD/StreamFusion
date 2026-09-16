import {
  LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
  LOCAL_CAPTION_FIXTURE_INSTALL_URI,
  LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI,
  LOCAL_CAPTION_FIXTURE_PCM_URI,
} from "@streamfusion/core/local-captions";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type {
  CaptionModelRequest,
  CaptionModelState,
  CaptionProofState,
  CaptionSessionRequest,
  CaptionSessionState,
  NativeCaptionEvent,
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

export interface LocalCaptionsController {
  readonly clearConstraint: () => Promise<void>;
  readonly installFixture: () => Promise<void>;
  readonly installIntegrityFail: () => Promise<void>;
  readonly model: LocalCaptionsViewModel;
  readonly queueConstraint: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly removeModel: () => Promise<void>;
  readonly startSession: (sessionId: string, sourceUri?: string) => Promise<void>;
  readonly startFixtureSession: () => Promise<void>;
  readonly startSecondSession: () => Promise<void>;
  readonly startConstrainedSession: () => Promise<void>;
  readonly stopSession: (sessionId?: string) => Promise<void>;
}

const englishModel = { modelId: "english-v1" } as const satisfies CaptionModelRequest;
const fixtureSessionId = "cap-fixture-diagnostics";
const secondSessionId = "cap-fixture-second";

type CaptionSnapshot = {
  readonly cueText: string;
  readonly model: CaptionModelState | null;
  readonly proof: CaptionProofState | null;
  readonly session: CaptionSessionState | null;
};

function emptySnapshot(): CaptionSnapshot {
  return { cueText: "", model: null, proof: null, session: null };
}

function sessionFromEvent(event: NativeCaptionEvent): CaptionSessionState {
  return {
    audioLeftDevice: event.audioLeftDevice,
    audioUploadAttempts: event.audioUploadAttempts,
    cueText: event.cueText,
    microphonePermissionRequested: event.microphonePermissionRequested,
    pcmBytesProcessed: event.pcmBytesProcessed,
    sessionId: event.sessionId,
    state: event.state,
    ...(event.reason === undefined ? {} : { reason: event.reason }),
  };
}

function createCaptionSnapshotStore(port: LocalCaptionsPort) {
  let snapshot = emptySnapshot();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const setSnapshot = (next: CaptionSnapshot) => {
    snapshot = next;
    emit();
  };
  const refresh = async () => {
    const [nextModel, nextProof] = await Promise.all([
      port.getEnglishModelState(),
      port.getCaptionProof(),
    ]);
    const current = snapshot;
    setSnapshot({
      cueText:
        nextProof.kind === "completed" ? nextProof.value.cueText : current.cueText,
      model: nextModel.kind === "completed" ? nextModel.value : current.model,
      proof: nextProof.kind === "completed" ? nextProof.value : current.proof,
      session: nextProof.kind === "completed" ? nextProof.value : current.session,
    });
  };
  void refresh();
  const unsubscribe = port.subscribe((event) => {
    const session = sessionFromEvent(event);
    setSnapshot({ ...snapshot, cueText: session.cueText, session });
  });
  return {
    applyModel: (model: CaptionModelState) => {
      setSnapshot({ ...snapshot, model });
    },
    applySession: (session: CaptionSessionState) => {
      setSnapshot({ ...snapshot, cueText: session.cueText, session });
    },
    dispose: () => unsubscribe(),
    getSnapshot: () => snapshot,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function englishSession(
  sessionId: string,
  sourceUri?: string,
): CaptionSessionRequest {
  return {
    ...englishModel,
    sessionId,
    ...(sourceUri === undefined ? {} : { sourceUri }),
  };
}

export function useLocalCaptionsController(options: {
  readonly port: LocalCaptionsPort;
}): LocalCaptionsController {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const store = useMemo(
    () => createCaptionSnapshotStore(options.port),
    [options.port],
  );
  useEffect(() => () => store.dispose(), [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await store.refresh();
    } finally {
      setBusy(false);
    }
  };

  const applyModel = async (
    result: Awaited<ReturnType<LocalCaptionsPort["installEnglishModel"]>>,
  ) => {
    if (result.kind === "completed") {
      store.applyModel(result.value);
      setStatus(result.value.statusMessage);
      return;
    }
    setStatus(result.failure.diagnostic);
  };

  const applySession = async (
    result: Awaited<ReturnType<LocalCaptionsPort["startFocusedCaptionSession"]>>,
  ) => {
    if (result.kind === "completed") {
      store.applySession(result.value);
      setStatus(result.value.reason ?? result.value.state);
      return;
    }
    setStatus(result.failure.diagnostic);
  };

  const install = (sourceUri?: string) =>
    run(async () => {
      await applyModel(
        await options.port.installEnglishModel({
          ...englishModel,
          ...(sourceUri === undefined ? {} : { sourceUri }),
        }),
      );
    });

  const start = (sessionId: string, sourceUri?: string) =>
    run(async () => {
      await applySession(
        await options.port.startFocusedCaptionSession(
          englishSession(sessionId, sourceUri),
        ),
      );
    });

  return {
    model: {
      busy,
      cueText: snapshot.cueText,
      model: snapshot.model,
      proof: snapshot.proof,
      session: snapshot.session,
      status,
    },
    refresh: store.refresh,
    installFixture: () => install(LOCAL_CAPTION_FIXTURE_INSTALL_URI),
    installIntegrityFail: () => install(LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI),
    removeModel: () =>
      run(async () => {
        await applyModel(await options.port.removeEnglishModel(englishModel));
      }),
    queueConstraint: () =>
      run(async () => {
        await applyModel(await options.port.queueDevelopmentCaptionConstraint());
      }),
    clearConstraint: () =>
      run(async () => {
        await applyModel(await options.port.clearDevelopmentCaptionConstraint());
      }),
    startSession: start,
    startFixtureSession: () => start(fixtureSessionId, LOCAL_CAPTION_FIXTURE_PCM_URI),
    startSecondSession: () => start(secondSessionId, LOCAL_CAPTION_FIXTURE_PCM_URI),
    startConstrainedSession: () =>
      start(fixtureSessionId, LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI),
    stopSession: (sessionId) =>
      run(async () => {
        await applySession(
          await options.port.stopFocusedCaptionSession(
            sessionId ?? snapshot.session?.sessionId ?? fixtureSessionId,
          ),
        );
      }),
  };
}
