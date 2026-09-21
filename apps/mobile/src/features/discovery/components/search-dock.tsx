import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import {
  mobileTextFieldProps,
  mobileTextFieldStyle,
} from "@mobile/design/text-field";
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
  readonly onSubmit: (value?: string) => void;
  readonly value: string;
}) {
  return (
    <View style={styles.dock} testID="search-dock">
      <TextInput
        {...mobileTextFieldProps}
        accessibilityLabel="Search streams"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        onSubmitEditing={({ nativeEvent }) => onSubmit(nativeEvent.text)}
        placeholder="Search Twitch and Kick"
        placeholderTextColor={mobileColors.textMuted}
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
      <MobileButton
        accessibilityHint="Submits the visible query"
        accessibilityLabel="Submit search"
        onPress={() => onSubmit(value)}
        testID="submit-search"
        variant="primary"
      >
        Search
      </MobileButton>
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
    ...mobileTextFieldStyle,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    flex: 1,
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
  pressed: {
    opacity: 0.76,
  },
});
