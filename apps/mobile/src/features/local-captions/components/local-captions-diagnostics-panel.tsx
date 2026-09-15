import {
  LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
  LOCAL_CAPTION_FIXTURE_INSTALL_URI,
  LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI,
  LOCAL_CAPTION_FIXTURE_PCM_URI,
} from "@streamfusion/core/local-captions";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type {
  LocalCaptionsController,
  LocalCaptionsViewModel,
} from "./use-local-captions-controller";

const fixtureUris = [
  LOCAL_CAPTION_FIXTURE_INSTALL_URI,
  LOCAL_CAPTION_FIXTURE_PCM_URI,
  LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI,
  LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI,
] as const;

export function LocalCaptionsDiagnosticsHost({
  controller,
}: {
  readonly controller: LocalCaptionsController;
}) {
  return (
    <LocalCaptionsDiagnosticsPanel
      model={controller.model}
      onClearConstraint={() => {
        void controller.clearConstraint();
      }}
      onInstallFixture={() => {
        void controller.installFixture();
      }}
      onInstallIntegrityFail={() => {
        void controller.installIntegrityFail();
      }}
      onQueueConstraint={() => {
        void controller.queueConstraint();
      }}
      onRemove={() => {
        void controller.removeModel();
      }}
      onStartConstrained={() => {
        void controller.startConstrainedSession();
      }}
      onStartFixture={() => {
        void controller.startFixtureSession();
      }}
      onStartSecond={() => {
        void controller.startSecondSession();
      }}
      onStop={() => {
        void controller.stopSession();
      }}
    />
  );
}

export function LocalCaptionsDiagnosticsPanel({
  model,
  onClearConstraint,
  onInstallFixture,
  onInstallIntegrityFail,
  onQueueConstraint,
  onRemove,
  onStartConstrained,
  onStartFixture,
  onStartSecond,
  onStop,
}: {
  readonly model: LocalCaptionsViewModel;
  readonly onClearConstraint: () => void;
  readonly onInstallFixture: () => void;
  readonly onInstallIntegrityFail: () => void;
  readonly onQueueConstraint: () => void;
  readonly onRemove: () => void;
  readonly onStartConstrained: () => void;
  readonly onStartFixture: () => void;
  readonly onStartSecond: () => void;
  readonly onStop: () => void;
}) {
  const actions = [
    { label: "Install fixture English model", onPress: onInstallFixture, testID: "local-captions-install-fixture" },
    { label: "Install integrity-fail fixture", onPress: onInstallIntegrityFail, testID: "local-captions-install-integrity-fail" },
    { label: "Start fixture caption session", onPress: onStartFixture, testID: "local-captions-start-fixture" },
    { label: "Start second caption session", onPress: onStartSecond, testID: "local-captions-start-second" },
    { label: "Start constrained captions", onPress: onStartConstrained, testID: "local-captions-start-constrained" },
    { label: "Queue caption constraint", onPress: onQueueConstraint, testID: "local-captions-queue-constraint" },
    { label: "Clear caption constraint", onPress: onClearConstraint, testID: "local-captions-clear-constraint" },
    { label: "Stop captions", onPress: onStop, testID: "local-captions-stop" },
    { label: "Remove English model", onPress: onRemove, testID: "local-captions-remove" },
  ];
  return (
    <View style={styles.panel} testID="local-captions-diagnostics">
      <Text selectable style={styles.label}>
        LOCAL CAPTIONS
      </Text>
      <Text selectable style={styles.meta} testID="local-captions-build-stamp">
        M04 Captions · contract 2
      </Text>
      <Text selectable style={styles.body}>
        Install the 43.11 MiB English model locally, run one focused caption
        session, and keep decoded PCM on this device.
      </Text>
      {fixtureUris.map((uri) => (
        <Text key={uri} selectable style={styles.meta}>
          {uri}
        </Text>
      ))}
      <Text selectable style={styles.body} testID="local-captions-status">
        {model.status ?? model.model?.statusMessage ?? "Model not installed."}
      </Text>
      <Text selectable style={styles.meta} testID="local-captions-proof">
        {proofLabel(model)}
      </Text>
      {model.cueText ? (
        <Text selectable style={styles.body} testID="local-captions-cue">
          {model.cueText}
        </Text>
      ) : null}
      {actions.map((action) => (
        <Action busy={model.busy} key={action.testID} {...action} />
      ))}
    </View>
  );
}

function proofLabel(model: LocalCaptionsViewModel): string {
  const proof = model.proof;
  if (!proof) return "No caption proof yet.";
  return `${proof.displaySize} · ${proof.pack} · sha256 ${
    proof.sha256Verified ? "verified" : "unverified"
  } · PCM ${proof.pcmBytesProcessed} · uploads ${proof.audioUploadAttempts} · mic ${
    proof.microphonePermissionRequested ? "requested" : "not requested"
  }`;
}

function Action({
  busy,
  label,
  onPress,
  testID,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={styles.action}
      testID={testID}
    >
      <Text selectable style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  body: { color: mobileColors.textSecondary, lineHeight: 20 },
  buttonLabel: { color: mobileColors.textPrimary, fontWeight: "700" },
  label: { color: mobileColors.textSecondary, fontSize: 12, fontWeight: "700" },
  meta: { color: mobileColors.textSecondary, fontSize: 12, lineHeight: 16 },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
});
