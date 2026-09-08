import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import {
  runtimeMitigationLabel,
} from "../domain/capability-profile";
import type { CapabilityProfileViewModel } from "./capability-profile-runtime-controller";
import { formatBytes, formatObservationAge } from "../utils/format-observation";

export function CapabilityProfilePanel({
  model,
  onRetry,
}: {
  readonly model: CapabilityProfileViewModel;
  readonly onRetry: () => void;
}) {
  return (
    <View style={styles.panel} testID="capability-profile">
      <Text selectable style={styles.label}>
        CAPABILITY PROFILE
      </Text>
      <Text selectable style={styles.title}>
        {model.phase === "measuring"
          ? "Measuring device resources"
          : model.profile
          ? model.profile.apiAbiFormFactorEligibility === "physical-candidate"
            ? "Physical device candidate"
            : model.profile.apiAbiFormFactorEligibility === "development-emulator"
              ? "Development emulator"
              : "Outside the API, ABI, or form-factor floor"
          : "Measurement unavailable"}
      </Text>
      <Text selectable style={styles.body} testID="capability-profile-detail">
        {model.detail}
      </Text>
      {model.phase === "unavailable" ? (
        <Pressable
          accessibilityHint="Retries the current Android resource measurement"
          accessibilityLabel="Retry capability measurement"
          accessibilityRole="button"
          android_ripple={{ color: mobileColors.surfaceRaised }}
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}
          testID="retry-capability-profile"
        >
          <Text selectable style={styles.retryLabel}>
            Retry measurement
          </Text>
        </Pressable>
      ) : null}
      {model.profile ? (
        <>
          <Text selectable style={styles.body}>
            {`Observed ${formatObservationAge(model.observationAgeMs ?? 0)} at the last sample. ${model.profile.observation.runtime.apiLevel} API. ${model.profile.observation.runtime.supportedAbis.join(", ")}.`}
          </Text>
          <Text selectable style={styles.body}>
            {`Storage ${formatBytes(model.profile.observation.storage.availableBytes)} free. Memory ${formatBytes(model.profile.observation.memory.availableBytes)} available. ${model.profile.observation.memory.lowMemory ? "Android reports low memory." : "Android does not report low memory."}`}
          </Text>
          <Text selectable style={styles.body}>
            {model.profile.observation.thermal.kind === "observed"
              ? `Thermal status ${model.profile.observation.thermal.state}.`
              : `Thermal status unavailable. ${model.profile.observation.thermal.detail}`}
          </Text>
          <Text selectable style={styles.body}>
            {`${model.profile.observation.decoders.length} decoder records observed. Decoder inventory is not a concurrent-video qualification.`}
          </Text>
          <Text selectable style={styles.body}>
            Active video, captions, recording, and downloads remain unexercised. This device is not lowest-profile qualified.
          </Text>
          <Text selectable style={styles.body}>
            {model.persistence === "history-confirmed"
              ? "This snapshot was confirmed in local history. History never restores admission or runtime protection after restart."
              : "This snapshot could not be confirmed in local history. The next sample will retry."}
          </Text>
          <Text selectable style={styles.body}>
            Sampling, reserve, and recovery values are provisional local safeguards. They do not qualify this device.
          </Text>
        </>
      ) : null}
      {model.projection ? (
        <>
          <Text selectable style={styles.title}>
            {`Runtime degradation stage ${model.projection.stage}`}
          </Text>
          {model.projection.actions.map((action) => (
            <Text key={action} selectable style={styles.body}>
              {runtimeMitigationLabel(action)}
            </Text>
          ))}
          <Text selectable style={styles.body}>
            {model.projection.recoveryCondition}
          </Text>
          {model.projection.consumerStatus.map((status) => (
            <Text key={status} selectable style={styles.body}>
              {status}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: mobileColors.textSecondary, lineHeight: 20 },
  label: { color: mobileColors.textSecondary, fontSize: 12, fontWeight: "700" },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  pressed: { opacity: 0.76 },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  retryLabel: { color: mobileColors.background, fontWeight: "700" },
  title: { color: mobileColors.textPrimary, fontSize: 16, fontWeight: "700" },
});
