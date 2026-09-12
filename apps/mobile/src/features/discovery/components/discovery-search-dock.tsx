import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

export function DiscoverySearchDock({
  onChangeQuery,
  placeholder,
  query,
  testID,
}: {
  readonly onChangeQuery: (query: string) => void;
  readonly placeholder: string;
  readonly query: string;
  readonly testID: string;
}) {
  return (
    <View style={styles.dock}>
      <TextInput
        accessibilityLabel={placeholder}
        autoCorrect={false}
        onChangeText={onChangeQuery}
        placeholder={placeholder}
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID={testID}
        value={query}
      />
      <Text selectable style={styles.hint}>
        Search stays on this screen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.medium,
  },
  input: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  hint: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
});
