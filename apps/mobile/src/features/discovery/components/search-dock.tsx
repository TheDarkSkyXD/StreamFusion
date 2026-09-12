import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

export function SearchDock({
  onChangeText,
  onClear,
  onSubmit,
  value,
}: {
  readonly onChangeText: (value: string) => void;
  readonly onClear: () => void;
  readonly onSubmit: () => void;
  readonly value: string;
}) {
  return (
    <View style={styles.dock} testID="search-dock">
      <TextInput
        accessibilityLabel="Search streams"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder="Search Twitch and Kick"
        placeholderTextColor={mobileColors.textSecondary}
        returnKeyType="search"
        style={styles.field}
        testID="search-field"
        value={value}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityLabel="Clear search field"
          accessibilityRole="button"
          onPress={onClear}
          style={({ pressed }) => [
            styles.action,
            pressed ? styles.pressed : null,
          ]}
          testID="clear-search-field"
        >
          <Text selectable style={styles.actionLabel}>
            Clear
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityHint="Submits the visible query"
        accessibilityLabel="Submit search"
        accessibilityRole="button"
        android_ripple={{ color: mobileColors.surfaceRaised }}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.submit,
          pressed ? styles.pressed : null,
        ]}
        testID="submit-search"
      >
        <Text selectable style={styles.submitLabel}>
          Search
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderTopColor: mobileColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.small,
  },
  field: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    color: mobileColors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  submit: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  submitLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.76,
  },
});
