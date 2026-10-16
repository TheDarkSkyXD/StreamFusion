import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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
  heading,
  headerBackground,
  notice,
  onDismiss,
  size = "content",
  variant = "default",
  testID,
  title,
  visible,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly heading?: ReactNode;
  readonly headerBackground?: ReactNode;
  readonly notice?: ReactNode;
  readonly onDismiss: () => void;
  readonly size?: "content" | "expanded" | "selection";
  readonly variant?: "default" | "chat";
  readonly testID?: string;
  readonly title: string;
  readonly visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const sheetHeight = useRef(0);
  const [drag] = useState(() =>
    variant === "chat" ? new Animated.Value(0) : null,
  );
  const [responder] = useState(() => {
    if (!drag) return null;
    const restore = () =>
      Animated.spring(drag, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx),
      onPanResponderGrant: () => drag.stopAnimation(),
      onPanResponderMove: (_, gesture) =>
        drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy >= 80 || (gesture.dy >= 24 && gesture.vy > 0.8)) {
          Animated.timing(drag, {
            toValue: sheetHeight.current,
            duration: 180,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) dismiss.current();
          });
        } else restore();
      },
      onPanResponderTerminate: restore,
    });
  });
  useEffect(() => {
    if (visible) drag?.setValue(0);
    return () => drag?.stopAnimation();
  }, [drag, visible]);
  const SheetView = drag ? Animated.View : View;
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
        <SheetView
          accessibilityViewIsModal
          onAccessibilityEscape={onDismiss}
          accessibilityActions={[{ name: "dismiss", label: "Dismiss sheet" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "dismiss") onDismiss();
          }}
          accessibilityLabel={title}
          role="dialog"
          testID={testID ? `${testID}-menu` : undefined}
          onLayout={(event) => {
            sheetHeight.current = event.nativeEvent.layout.height;
          }}
          style={[
            styles.sheet,
            drag ? { transform: [{ translateY: drag }] } : null,
            variant === "chat" ? styles.chat : null,
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
          <View {...responder?.panHandlers}>
            {headerBackground}
            <View accessible={false} style={styles.handle} />
            {notice ? <View style={styles.notice}>{notice}</View> : null}
            <View style={styles.header}>
              <View style={styles.title}>
                {heading ?? (
                  <Text accessibilityRole="header" style={mobileType.title}>
                    {title}
                  </Text>
                )}
              </View>
              {variant !== "chat" ? (
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
              ) : null}
            </View>
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
        </SheetView>
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
  chat: {
    backgroundColor: "#1D1B20",
    borderColor: "#1D1B20",
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
  title: { flex: 1, minWidth: 0, paddingVertical: mobileSpacing.small },
  notice: { alignItems: "center", paddingTop: mobileSpacing.small },
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
