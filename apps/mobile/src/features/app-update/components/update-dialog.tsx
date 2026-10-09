import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { UpdateAction, UpdateDialogModel } from "../domain/update-presentation";

const LABELS: Record<UpdateAction, string> = {
  download: "Yes",
  later: "No",
  cancel: "Cancel",
  hide: "Hide",
  retry: "Retry",
  install: "Install",
};

const byteNumberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function UpdateDialog({
  model,
  onAction,
  operationError,
  visible,
}: {
  readonly model: UpdateDialogModel | null;
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
      animationType="none"
      onRequestClose={() => onAction(model.dismissAction)}
      transparent
      visible={visible}
    >
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.card} testID="update-dialog">
          {model.title ? <Text style={styles.title} testID="update-dialog-title">{model.title}</Text> : null}
          {model.kind === "download" && model.progress ? (
            <Text style={styles.detail} testID="update-dialog-detail">
              {`Downloading update… ${formatBytes(model.progress.bytes)} / ${formatBytes(model.progress.total)}`}
            </Text>
          ) : <Text style={styles.detail} testID="update-dialog-detail">{model.detail}</Text>}
          {model.failureDetail ? (
            <Text accessibilityRole="alert" style={styles.error} testID="update-dialog-installer-failure">
              {model.failureDetail}
            </Text>
          ) : null}
          {operationError ? (
            <Text accessibilityRole="alert" style={styles.error} testID="update-dialog-operation-error">
              {operationError}
            </Text>
          ) : null}
          {model.progress ? (
            <View testID="update-progress">
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
                style={[styles.button, model.kind === "offer" || model.kind === "download"
                  ? styles.textButton
                  : action === "download" || action === "install" || action === "retry"
                    ? styles.primary : styles.secondary]}
                testID={`update-action-${action}`}
              >
                <Text style={model.kind === "offer" || model.kind === "download"
                  ? styles.textButtonLabel
                  : action === "download" || action === "install" || action === "retry"
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
  return `${byteNumberFormatter.format(bytes / 1_000_000)} MB`;
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
  track: {
    backgroundColor: mobileColors.border,
    borderRadius: mobileRadii.full,
    height: 8,
    overflow: "hidden",
  },
  fill: { backgroundColor: mobileColors.textPrimary, height: "100%" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small, justifyContent: "flex-end" },
  button: {
    borderRadius: mobileRadii.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.medium,
  },
  primary: { backgroundColor: mobileColors.textPrimary },
  secondary: { backgroundColor: mobileColors.surfaceMuted },
  textButton: { backgroundColor: "transparent" },
  textButtonLabel: { color: mobileColors.textPrimary, fontWeight: "600" },
  primaryLabel: { color: mobileColors.background, fontWeight: "700" },
  secondaryLabel: { color: mobileColors.textPrimary, fontWeight: "600" },
});
