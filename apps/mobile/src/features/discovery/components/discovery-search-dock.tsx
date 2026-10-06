import { StyleSheet, TextInput } from "react-native";

import {
  mobileTextFieldProps,
  mobileTextFieldStyle,
} from "@mobile/design/text-field";
import { mobileColors, mobileSizing } from "@mobile/design/tokens";

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
    <TextInput
      {...mobileTextFieldProps}
      accessibilityLabel={placeholder}
      autoCorrect={false}
      onChangeText={onChangeQuery}
      placeholder={placeholder}
      placeholderTextColor={mobileColors.textMuted}
      style={styles.input}
      testID={testID}
      value={query}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    ...mobileTextFieldStyle,
    minHeight: mobileSizing.minimumTouchTarget,
  },
});
