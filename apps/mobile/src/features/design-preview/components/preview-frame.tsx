import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Ellipsis,
  Radio,
  Search,
  Users,
} from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MobileIconButton } from "@mobile/design/icon-button";
import {
  mobileColors as colors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

const destinations = [
  { id: "search", label: "Search", icon: Search },
  { id: "following", label: "Following", icon: Users },
  { id: "watch", label: "Watch", icon: Radio },
  { id: "activity", label: "Activity", icon: Bell },
  { id: "more", label: "More", icon: Ellipsis },
] as const;

export type PreviewDestination = (typeof destinations)[number]["id"];

export function PreviewFrame({
  children,
  destination = "more",
  headerAction,
  onBack,
  scroll = true,
  subtitle,
  title,
}: {
  readonly children: ReactNode;
  readonly destination?: PreviewDestination;
  readonly headerAction?: ReactNode;
  readonly onBack?: () => void;
  readonly scroll?: boolean;
  readonly subtitle?: string;
  readonly title: string;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const rail = width > mobileSizing.compactWindowMaximum;
  const [selected, setSelected] = useState(destination);
  const navigation = (
    <View
      accessibilityLabel="Primary navigation"
      accessibilityRole="tablist"
      style={
        rail
          ? styles.rail
          : [styles.navigation, { paddingBottom: insets.bottom }]
      }
    >
      {destinations.map(({ icon: Icon, id, label }) => (
        <Pressable
          key={id}
          accessibilityLabel={label}
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === id }}
          onPress={() => setSelected(id)}
          style={styles.navItem}
        >
          <View
            style={[styles.navIcon, selected === id ? styles.selected : null]}
          >
            <Icon
              color={colors.textPrimary}
              size={22}
              strokeWidth={selected === id ? 2.4 : 1.7}
            />
          </View>
          <Text
            style={[
              styles.navLabel,
              selected === id ? styles.navSelected : null,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.frame, { paddingTop: insets.top }]}
    >
      <View style={styles.status}>
        <Text style={styles.statusText}>9:41</Text>
        <Text style={styles.statusText}>5G · 96%</Text>
      </View>
      <View style={styles.workspace}>
        {rail ? navigation : null}
        <View style={styles.main}>
          <View style={styles.header}>
            {onBack ? (
              <MobileIconButton label="Go back" onPress={onBack}>
                <ArrowLeft color={colors.textPrimary} size={22} />
              </MobileIconButton>
            ) : null}
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={mobileType.display}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={mobileType.label}>{subtitle}</Text>
              ) : null}
            </View>
            {headerAction}
          </View>
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.fill}>{children}</View>
          )}
        </View>
      </View>
      {!rail ? navigation : null}
    </KeyboardAvoidingView>
  );
}

export function PreviewSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={mobileType.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export const previewStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    flexWrap: "wrap",
  },
  card: {
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  padded: { padding: mobileSpacing.medium, gap: mobileSpacing.medium },
  body: { ...mobileType.body, color: colors.textSecondary },
  title: { ...mobileType.title },
  label: { ...mobileType.label },
  grow: { flex: 1 },
  column: { gap: mobileSpacing.medium },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: mobileRadii.medium,
    paddingHorizontal: mobileSpacing.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    color: colors.textPrimary,
    fontSize: 16,
  },
});

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.background,
    width: "100%",
    height: "100%",
    minHeight: 640,
  },
  status: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: mobileSpacing.large,
    paddingVertical: mobileSpacing.small,
  },
  statusText: { ...mobileType.label, color: colors.textPrimary },
  workspace: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: "row",
    gap: mobileSpacing.small,
    alignItems: "center",
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.medium,
  },
  heading: { flex: 1, gap: mobileSpacing.xSmall },
  body: {
    padding: mobileSpacing.medium,
    paddingTop: 0,
    gap: mobileSpacing.large,
    width: "100%",
    maxWidth: 1060,
    alignSelf: "center",
  },
  fill: { flex: 1, minHeight: 0 },
  section: { gap: mobileSpacing.medium },
  navigation: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: mobileSpacing.small,
  },
  rail: {
    width: mobileSizing.navigationRailWidth,
    backgroundColor: colors.surface,
    gap: mobileSpacing.medium,
    paddingVertical: mobileSpacing.large,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    minHeight: 64,
    paddingBottom: mobileSpacing.small,
    gap: mobileSpacing.xSmall,
  },
  navIcon: {
    minHeight: 36,
    width: 56,
    borderRadius: mobileRadii.full,
    justifyContent: "center",
    alignItems: "center",
  },
  selected: { backgroundColor: colors.navigationSelected },
  navLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 16,
  },
  navSelected: { color: colors.textPrimary, fontWeight: "700" },
});
