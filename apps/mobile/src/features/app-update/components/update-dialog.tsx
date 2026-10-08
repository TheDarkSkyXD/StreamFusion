import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { UpdateAction, UpdatePresentation } from "../domain/update-presentation";

const LABELS: Record<UpdateAction, string> = {
  download: "Download",
  later: "Later",
  cancel: "Cancel download",
  hide: "Hide",
  retry: "Retry",
  install: "Install",
};

export function UpdateDialog({
  model,
  onAction,
  operationError,
  visible,
}: {
  readonly model: UpdatePresentation | null;
  readonly onAction: (action: UpdateAction) => void;
  readonly operationError?: string | null;
  readonly visible: boolean;
}) {
  if (!model) return null;
  const percent = model.progress
    ? Math.min(100, Math.floor(model.progress.bytes * 100 / model.progress.total))
    : null;
  return (
    <Modal
      animationType="fade"
      onRequestClose={() => onAction(model.actions.includes("hide") ? "hide" : "later")}
      transparent
      visible={visible}
    >
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.card} testID="update-dialog">
          <Text style={styles.title} testID="update-dialog-title">{model.title}</Text>
          <Text style={styles.detail} testID="update-dialog-detail">{model.detail}</Text>
          {operationError ? (
            <Text accessibilityRole="alert" style={styles.error} testID="update-dialog-operation-error">
              {operationError}
            </Text>
          ) : null}
          {model.progress ? (
            <View testID="update-progress">
              <Text style={styles.progressCopy} testID="update-progress-copy">
                {`${formatBytes(model.progress.bytes)} of ${formatBytes(model.progress.total)} · ${percent}%`}
              </Text>
              <View
                accessibilityLabel={`Download ${percent}%`}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent ?? 0 }}
                style={styles.track}
              >
                <View style={[styles.fill, { width: `${percent ?? 0}%` }]} />
              </View>
            </View>
          ) : null}
          <View style={styles.actions}>
            {model.actions.map((action) => (
              <Pressable
                accessibilityRole="button"
                key={action}
                onPress={() => onAction(action)}
                style={[styles.button, action === "download" || action === "install" || action === "retry"
                  ? styles.primary : styles.secondary]}
                testID={`update-action-${action}`}
              >
                <Text style={action === "download" || action === "install" || action === "retry"
                  ? styles.primaryLabel : styles.secondaryLabel}>
                  {action === "install" ? model.installLabel ?? LABELS.install : LABELS[action]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: mobileColors.overlay,
    justifyContent: "center",
    padding: mobileSpacing.large,
  },
  card: {
    alignSelf: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.medium,
    maxWidth: 560,
    padding: mobileSpacing.large,
    width: "100%",
  },
  title: { ...mobileType.title },
  detail: { ...mobileType.body },
  error: { ...mobileType.body, color: mobileColors.danger },
  progressCopy: { ...mobileType.label, marginBottom: mobileSpacing.small },
  track: {
    backgroundColor: mobileColors.border,
    borderRadius: mobileRadii.full,
    height: 8,
    overflow: "hidden",
  },
  fill: { backgroundColor: mobileColors.textPrimary, height: "100%" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  button: {
    borderRadius: mobileRadii.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.medium,
  },
  primary: { backgroundColor: mobileColors.textPrimary },
  secondary: { backgroundColor: mobileColors.surfaceMuted },
  primaryLabel: { color: mobileColors.background, fontWeight: "700" },
  secondaryLabel: { color: mobileColors.textPrimary, fontWeight: "600" },
});
