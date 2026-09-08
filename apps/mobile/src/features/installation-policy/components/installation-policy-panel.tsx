import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { InstallationPolicyViewModel } from "../domain/installation-policy-runtime-controller";

export function InstallationPolicyPanel({
  model,
  onRefreshCapabilityPolicy,
  onRetryInstallationRegistration,
}: {
  readonly model: InstallationPolicyViewModel;
  readonly onRefreshCapabilityPolicy: () => void;
  readonly onRetryInstallationRegistration: () => void;
}) {
  const installationBusy = model.installation.phase === "checking";
  const policyBusy = model.policy.phase === "checking";
  return (
    <View
      accessibilityLabel="Installation and capability policy"
      style={styles.panel}
    >
      <Text selectable style={styles.label}>
        INSTALLATION AND CAPABILITY POLICY
      </Text>
      <Text selectable style={styles.rowLabel}>
        INSTALLATION
      </Text>
      <Text
        selectable
        style={styles.title}
        testID="installation-registration-status"
      >
        {installationStatus(model)}
      </Text>
      <Text
        selectable
        style={styles.detail}
        testID="installation-registration-detail"
      >
        {model.installation.detail}
      </Text>
      <Text selectable style={styles.metadata}>
        {`reconciled ${model.installation.reconciledAt ?? "unavailable"}`}
      </Text>
      <Text selectable style={styles.rowLabel}>
        EFFECTIVE CAPABILITY POLICY
      </Text>
      <Text selectable style={styles.title} testID="capability-policy-status">
        {policyStatus(model)}
      </Text>
      <Text selectable style={styles.detail} testID="capability-policy-detail">
        {model.policy.detail}
      </Text>
      <Text
        selectable
        style={styles.metadata}
        testID="installation-policy-metadata"
      >
        {policyMetadata(model)}
      </Text>
      <Text selectable style={styles.detail}>
        No policy-controlled compatibility integration is active in this build.
        Safe fallback never disables unrelated local app features.
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            installationBusy
              ? "Retrying installation"
              : "Retry installation"
          }
          accessibilityState={{
            busy: installationBusy,
            disabled:
              installationBusy ||
              !model.retryInstallationRegistrationEnabled,
          }}
          disabled={!model.retryInstallationRegistrationEnabled}
          onPress={onRetryInstallationRegistration}
          style={({ pressed }) => [
            styles.action,
            !model.retryInstallationRegistrationEnabled &&
              styles.actionDisabled,
            pressed &&
              model.retryInstallationRegistrationEnabled &&
              styles.actionPressed,
          ]}
          testID="retry-installation-registration"
        >
          <Text style={styles.actionText}>
            {installationBusy ? "Retrying installation" : "Retry installation"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            policyBusy ? "Refreshing policy" : "Refresh policy"
          }
          accessibilityState={{
            busy: policyBusy,
            disabled: policyBusy || !model.refreshCapabilityPolicyEnabled,
          }}
          disabled={!model.refreshCapabilityPolicyEnabled}
          onPress={onRefreshCapabilityPolicy}
          style={({ pressed }) => [
            styles.action,
            !model.refreshCapabilityPolicyEnabled && styles.actionDisabled,
            pressed &&
              model.refreshCapabilityPolicyEnabled &&
              styles.actionPressed,
          ]}
          testID="refresh-capability-policy"
        >
          <Text style={styles.actionText}>
            {policyBusy ? "Refreshing policy" : "Refresh policy"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function policyMetadata(model: InstallationPolicyViewModel): string {
  const policy = model.policy;
  return [
    `environment ${policy.environment}`,
    `source ${policy.effectiveSource}`,
    `reason ${policy.reason ?? "none"}`,
    `sequence ${policy.sequence ?? "unavailable"}`,
    `issued ${policy.issuedAt ?? "unavailable"}`,
    `verified ${policy.verifiedAt ?? "unavailable"}`,
    `checked ${policy.checkedAt ?? "unavailable"}`,
    `age at last check ${policy.cacheAgeSeconds === null ? "unavailable" : `${policy.cacheAgeSeconds}s`}`,
    `expires ${policy.expiresAt ?? "unavailable"}`,
  ].join(" · ");
}

function installationStatus(model: InstallationPolicyViewModel): string {
  if (model.installation.phase === "terminal")
    return "Installation credentials unavailable";
  if (model.installation.phase === "retryable")
    return "Installation retry available";
  if (model.installation.phase === "checking") return "Checking installation";
  return "Installation registered";
}

function policyStatus(model: InstallationPolicyViewModel): string {
  if (model.policy.phase === "checking") return "Checking capability policy";
  if (model.policy.phase === "valid") return "Signed policy verified";
  if (model.policy.phase === "cached") return "Using verified cached policy";
  return "Using baked safe fallback";
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  actionDisabled: { backgroundColor: mobileColors.surfaceMuted, opacity: 0.58 },
  actionPressed: { opacity: 0.78 },
  actionText: { color: mobileColors.textPrimary, fontWeight: "700" },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
    marginTop: mobileSpacing.small,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: mobileSpacing.xSmall,
  },
  label: {
    color: mobileColors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  metadata: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: mobileSpacing.small,
  },
  panel: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.medium,
  },
  rowLabel: {
    color: mobileColors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginTop: mobileSpacing.small,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    marginTop: mobileSpacing.xSmall,
  },
});
