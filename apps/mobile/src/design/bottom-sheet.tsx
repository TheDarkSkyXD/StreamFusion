import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileBottomSheet({
  children,
  footer,
  onDismiss,
  size = "content",
  testID,
  title,
  visible,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onDismiss: () => void;
  readonly size?: "content" | "expanded" | "selection";
  readonly testID?: string;
  readonly title: string;
  readonly visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={onDismiss}
      transparent
      visible={visible}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <Pressable
          accessibilityLabel={`Dismiss ${title}`}
          accessibilityRole="button"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}-dismiss` : undefined}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          role="dialog"
          testID={testID ? `${testID}-menu` : undefined}
          style={[
            styles.sheet,
            size === "expanded"
              ? styles.expanded
              : size === "selection"
                ? styles.selection
                : styles.content,
            {
              paddingBottom: Math.max(insets.bottom, mobileSpacing.medium),
              marginTop: insets.top + mobileSpacing.large,
            },
          ]}
        >
          <View accessible={false} style={styles.handle} />
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              style={[mobileType.title, styles.title]}
            >
              {title}
            </Text>
            <Pressable
              accessibilityLabel="Close sheet"
              accessibilityRole="button"
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.close,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.closeLabel}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            tabIndex={0}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            style={styles.scroll}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: mobileColors.overlay,
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderTopWidth: 1,
    borderTopLeftRadius: mobileRadii.extraLarge,
    borderTopRightRadius: mobileRadii.extraLarge,
    width: "100%",
    maxWidth: mobileSizing.readableContentMaximum,
    overflow: "hidden",
  },
  content: { maxHeight: "60%" },
  selection: { maxHeight: mobileSizing.selectSheetMaxHeight },
  expanded: { maxHeight: "90%" },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: mobileRadii.full,
    backgroundColor: mobileColors.textSecondary,
    marginTop: mobileSpacing.small,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: mobileSpacing.medium,
    paddingRight: mobileSpacing.small,
    gap: mobileSpacing.small,
  },
  title: { flex: 1, paddingVertical: mobileSpacing.small },
  close: {
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: mobileSpacing.small,
    borderRadius: mobileRadii.medium,
  },
  closeLabel: { ...mobileType.label, color: mobileColors.textPrimary },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
  scroll: { flexGrow: 0 },
  body: { padding: mobileSpacing.medium, gap: mobileSpacing.medium },
  footer: {
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.small,
    borderTopColor: mobileColors.border,
    borderTopWidth: 1,
    gap: mobileSpacing.small,
  },
});
