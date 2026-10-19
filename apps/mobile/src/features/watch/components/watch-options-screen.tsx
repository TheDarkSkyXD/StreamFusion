import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react-native";
import {
  Modal,
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
} from "@mobile/design/tokens";

export function WatchOptionsScreen({
  backLabel,
  backTestID,
  children,
  onBack,
  title,
  visible,
}: {
  readonly backLabel: string;
  readonly backTestID: string;
  readonly children: ReactNode;
  readonly onBack: () => void;
  readonly title: string;
  readonly visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={onBack}
      statusBarTranslucent
      visible={visible}
    >
      <View
        accessibilityLabel={title}
        accessibilityViewIsModal
        onAccessibilityEscape={onBack}
        role="dialog"
        style={[
          styles.screen,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
        testID="watch-tools-sheet-menu"
      >
        <View style={styles.header} testID="watch-options-header">
          <Pressable
            accessibilityLabel={backLabel}
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [
              styles.back,
              pressed ? styles.pressed : null,
            ]}
            testID={backTestID}
          >
            <ChevronLeft color={mobileColors.textPrimary} size={24} />
          </Pressable>
          <Text accessibilityRole="header" style={mobileType.title}>
            {title}
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
          testID="watch-options-scroll"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: mobileColors.surface },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: mobileColors.border,
  },
  back: {
    width: mobileSizing.minimumTouchTarget,
    height: mobileSizing.minimumTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: mobileRadii.medium,
  },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
  scroll: { flex: 1 },
  body: { padding: mobileSpacing.medium, gap: mobileSpacing.medium },
});
