import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import type { LocalCaptionsPort } from "@mobile/features/local-captions/capabilities/local-captions";
import { useLocalCaptionsController } from "@mobile/features/local-captions/components/use-local-captions-controller";
import type {
  CaptionModelState,
  CaptionSessionState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import { WatchCaptionBar } from "@mobile/features/watch/components/watch-caption-bar";
import { WatchCaptionOverlay } from "@mobile/features/watch/components/watch-caption-overlay";

const missing: CaptionModelState = {
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
  statusMessage: "Download the English model to enable offline captions.",
};
const ready: CaptionModelState = {
  ...missing,
  installed: true,
  downloadedBytes: 41_205_931,
  pack: "product",
  phase: "ready",
  sha256Verified: true,
  statusMessage: "English speech model ready offline.",
};
const stopped: CaptionSessionState = {
  audioLeftDevice: false,
  audioUploadAttempts: 0,
  cueText: "",
  microphonePermissionRequested: false,
  pcmBytesProcessed: 0,
  sessionId: "story-player",
  state: "stopped",
};

function storyNativeBoundary(
  initial: "missing" | "ready" | "unavailable",
): LocalCaptionsPort {
  let model = initial === "ready" ? ready : missing;
  let session = stopped;
  return {
    readiness: () =>
      initial === "unavailable"
        ? {
            capability: "captions",
            kind: "unavailable",
            failure: {
              code: "NATIVE_BINDING_UNAVAILABLE",
              diagnostic:
                "Offline captions require the Android native client. Expo Go does not include this engine.",
            },
          }
        : { capability: "captions", kind: "ready", contractVersion: 3 },
    subscribe: () => () => undefined,
    getEnglishModelState: async () => ({ kind: "completed", value: model }),
    getCaptionProof: async () => ({
      kind: "completed",
      value: { ...model, ...session },
    }),
    installEnglishModel: async () => {
      model = ready;
      return { kind: "completed", value: model };
    },
    removeEnglishModel: async () => {
      model = missing;
      return { kind: "completed", value: model };
    },
    startFocusedCaptionSession: async (request) => {
      session = {
        ...stopped,
        sessionId: request.sessionId,
        state: "active",
        cueText: "[Story fixture] Recognized speech appears here.",
      };
      return { kind: "completed", value: session };
    },
    stopFocusedCaptionSession: async (sessionId) => {
      session = { ...stopped, sessionId };
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
  };
}

function LocalCaptionWorkflow({
  initial,
}: {
  readonly initial: "missing" | "ready" | "unavailable";
}) {
  const port = useMemo(() => storyNativeBoundary(initial), [initial]);
  const controller = useLocalCaptionsController({ port });
  const eligibility =
    initial === "unavailable"
      ? ({
          kind: "unsupported",
          reason:
            "Offline captions require the Android native client. Expo Go does not include this engine.",
        } as const)
      : ({
          kind: "eligible",
          label: "Local captions",
          sessionId: "story-player",
        } as const);
  return (
    <View style={styles.workspace}>
      <View style={styles.player}>
        <WatchCaptionOverlay text={controller.model.cueText} />
      </View>
      <WatchCaptionBar
        eligibility={eligibility}
        busy={controller.model.busy}
        model={controller.model.model}
        session={controller.model.session}
        status={controller.model.status}
        onInstall={() => {
          void controller.installModel();
        }}
        onStart={() => {
          void controller.startSession("story-player");
        }}
        onStop={() => {
          void controller.stopSession();
        }}
        onRemove={() => {
          void controller.removeModel();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: {
    backgroundColor: mobileColors.background,
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    width: 390,
  },
  player: {
    backgroundColor: "#000",
    aspectRatio: 16 / 9,
    justifyContent: "flex-end",
    position: "relative",
  },
});

const meta = {
  title: "Android/Implemented/Local captions",
  component: LocalCaptionWorkflow,
  parameters: {
    docs: {
      description: {
        component:
          "Production caption controls and controller with an injected Storybook native boundary. Model and recognition responses here are story fixtures. Native speech recognition is verified separately by the Android instrumented PCM test.",
      },
    },
  },
} satisfies Meta<typeof LocalCaptionWorkflow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DownloadAndStart: Story = { args: { initial: "missing" } };
export const ReadyOffline: Story = { args: { initial: "ready" } };
export const ExpoGoUnavailable: Story = { args: { initial: "unavailable" } };
