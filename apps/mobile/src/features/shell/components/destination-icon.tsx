import {
  Bell,
  Heart,
  Menu,
  Play,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileRadii, mobileSizing } from "@mobile/design/tokens";

import type { ShellDestinationId } from "../domain/shell-navigation";

const destinationIcons: Readonly<Record<ShellDestinationId, LucideIcon>> = {
  search: Search,
  following: Heart,
  watch: Play,
  activity: Bell,
  more: Menu,
};

export function formatActivityUnreadBadge(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function DestinationIcon({
  color,
  destination,
  unreadCount = 0,
}: {
  readonly color: string;
  readonly destination: ShellDestinationId;
  readonly unreadCount?: number;
}) {
  const Icon = destinationIcons[destination];
  const showBadge = destination === "activity" && unreadCount > 0;
  return (
    <View>
      <Icon
        accessibilityElementsHidden
        color={color}
        size={mobileSizing.icon}
        strokeWidth={2}
      />
      {showBadge ? (
        <View
          accessibilityElementsHidden
          style={styles.badge}
          testID="nav-activity-unread-badge"
        >
          <Text style={styles.badgeText}>
            {formatActivityUnreadBadge(unreadCount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.full,
    justifyContent: "center",
    minHeight: 16,
    minWidth: 16,
    paddingHorizontal: 4,
    position: "absolute",
    right: -8,
    top: -6,
  },
  badgeText: {
    color: mobileColors.textPrimary,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 11,
  },
});
