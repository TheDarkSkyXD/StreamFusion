import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileListRow({
  description,
  destructive = false,
  leading,
  onPress,
  title,
  trailing,
}: {
  readonly description?: string;
  readonly destructive?: boolean;
  readonly leading?: ReactNode;
  readonly onPress?: () => void;
  readonly title: string;
  readonly trailing?: ReactNode;
}) {
  const content = (
    <>
      {leading}
      <View style={styles.copy}>
        <Text
          style={[
            mobileType.body,
            styles.title,
            destructive ? styles.danger : null,
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <ChevronRight color={mobileColors.textSecondary} size={20} />
        ) : null)}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={description ? `${title}, ${description}` : title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.row}>{content}</View>
  );
}

export function MobileSwitchRow({
  description,
  disabled = false,
  onChange,
  title,
  value,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
  readonly title: string;
  readonly value: boolean;
}) {
  return (
    <MobileListRow
      {...(description === undefined ? {} : { description })}
      title={title}
      trailing={
        <Switch
          accessibilityLabel={title}
          disabled={disabled}
          onValueChange={onChange}
          value={value}
          thumbColor={
            value ? mobileColors.textPrimary : mobileColors.textSecondary
          }
          trackColor={{
            false: mobileColors.border,
            true: mobileColors.navigationSelected,
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingVertical: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    borderRadius: mobileRadii.medium,
  },
  copy: { flex: 1, gap: mobileSpacing.xSmall },
  title: { color: mobileColors.textPrimary },
  description: { ...mobileType.label, color: mobileColors.textSecondary },
  danger: { color: "#ff8299" },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
});
