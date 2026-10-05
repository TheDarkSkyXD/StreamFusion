import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "./button";
import { mobileColors, mobileRadii, mobileSpacing, mobileType } from "./tokens";

export function MobileDialog({
  confirmLabel,
  destructive = false,
  message,
  onCancel,
  onConfirm,
  title,
  visible,
}: {
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly message: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly visible: boolean;
}) {
  return (
    <Modal
      animationType="none"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cancel dialog"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          role="alertdialog"
          style={styles.dialog}
        >
          <Text accessibilityRole="header" style={mobileType.title}>
            {title}
          </Text>
          <Text style={mobileType.body}>{message}</Text>
          <View style={styles.actions}>
            <MobileButton
              accessibilityLabel="Cancel"
              onPress={onCancel}
              testID="dialog-cancel"
              variant="ghost"
            >
              Cancel
            </MobileButton>
            <MobileButton
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              testID="dialog-confirm"
              variant={destructive ? "destructive" : "primary"}
            >
              {confirmLabel}
            </MobileButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: mobileColors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileSpacing.large,
  },
  dialog: {
    width: "100%",
    maxWidth: 480,
    padding: mobileSpacing.large,
    borderRadius: mobileRadii.extraLarge,
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderWidth: 1,
    gap: mobileSpacing.medium,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: mobileSpacing.small,
    marginTop: mobileSpacing.small,
  },
});
