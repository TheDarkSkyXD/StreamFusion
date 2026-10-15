import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

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
  autoFocus = false,
  onBack,
  onChangeText,
  onClear,
  onSubmit,
  value,
}: {
  readonly autoFocus?: boolean;
  readonly onBack?: () => void;
  readonly onChangeText: (value: string) => void;
  readonly onClear: () => void;
  readonly onSubmit: (value?: string) => void;
  readonly value: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.dock} testID="search-dock">
      {onBack ? (
        <Pressable
          accessibilityLabel="Back to categories"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.action}
          testID="search-back"
        >
          <ArrowLeft color={mobileColors.textPrimary} size={22} />
        </Pressable>
      ) : null}
      <View style={styles.fieldWrap}>
        <Search color={mobileColors.textSecondary} size={19} />
        <TextInput
          {...mobileTextFieldProps}
          accessibilityLabel={t("discovery.search.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          onChangeText={onChangeText}
          onSubmitEditing={({ nativeEvent }) => {
            Keyboard.dismiss();
            onSubmit(nativeEvent.text);
          }}
          placeholder={t("discovery.search.placeholder")}
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
            <X color={mobileColors.textSecondary} size={18} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.small,
  },
  fieldWrap: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceMuted,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingLeft: mobileSpacing.medium,
  },
  field: {
    ...mobileTextFieldStyle,
    backgroundColor: "transparent",
    flex: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  pressed: {
    opacity: 0.76,
  },
});
