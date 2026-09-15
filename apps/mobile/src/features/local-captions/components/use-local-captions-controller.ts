import {
  LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
  LOCAL_CAPTION_FIXTURE_INSTALL_URI,
  LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI,
  LOCAL_CAPTION_FIXTURE_PCM_URI,
} from "@streamfusion/core/local-captions";
import { useEffect, useState } from "react";

import type {
  CaptionModelRequest,
  CaptionModelState,
  CaptionProofState,
  CaptionSessionRequest,
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
  const [cueText, setCueText] = useState("");
  const [model, setModel] = useState<CaptionModelState | null>(null);
  const [proof, setProof] = useState<CaptionProofState | null>(null);
  const [session, setSession] = useState<CaptionSessionState | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const [nextModel, nextProof] = await Promise.all([
      options.port.getEnglishModelState(),
      options.port.getCaptionProof(),
    ]);
    if (nextModel.kind === "completed") setModel(nextModel.value);
    if (nextProof.kind === "completed") {
      setProof(nextProof.value);
      setCueText(nextProof.value.cueText);
      setSession(nextProof.value);
    }
  };

  useEffect(() => {
    void refresh();
    return options.port.subscribe((event) => {
      setSession(event);
      setCueText(event.cueText);
    });
  }, [options.port]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const applyModel = async (
    result: Awaited<ReturnType<LocalCaptionsPort["installEnglishModel"]>>,
  ) => {
    if (result.kind === "completed") {
      setModel(result.value);
      setStatus(result.value.statusMessage);
      return;
    }
    setStatus(result.failure.diagnostic);
  };

  const applySession = async (
    result: Awaited<ReturnType<LocalCaptionsPort["startFocusedCaptionSession"]>>,
  ) => {
    if (result.kind === "completed") {
      setSession(result.value);
      setCueText(result.value.cueText);
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
    model: { busy, cueText, model, proof, session, status },
    refresh,
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
            sessionId ?? session?.sessionId ?? fixtureSessionId,
          ),
        );
      }),
  };
}
