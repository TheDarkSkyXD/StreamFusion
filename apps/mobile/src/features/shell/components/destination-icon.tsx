import {
  Activity,
  Bell,
  CircleUserRound,
  Download,
  Heart,
  History,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Play,
  Search,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileRadii, mobileSizing } from "@mobile/design/tokens";

import type { ShellDestinationId } from "../domain/shell-navigation";
import { MORE_ROUTE_IDS } from "../domain/shell-navigation";

const destinationIcons: Readonly<Record<ShellDestinationId, LucideIcon>> = {
  search: Search,
  following: Heart,
  watch: Play,
  activity: Bell,
  more: Menu,
};

/** Electron sidebar / settings iconography mirrored for the More hub cards. */
export const moreRouteIcons = {
  "more/multistream": LayoutDashboard,
  "more/categories": LayoutGrid,
  "more/history": History,
  "more/downloads": Download,
  "more/moderation": Shield,
  "more/settings": Settings,
  "more/diagnostics": Activity,
  "more/accounts": CircleUserRound,
} as const satisfies Readonly<
  Record<(typeof MORE_ROUTE_IDS)[number], LucideIcon>
>;

export type MoreHubRouteId = (typeof MORE_ROUTE_IDS)[number];

export function MoreRouteIcon({
  color,
  routeId,
  size = mobileSizing.icon,
}: {
  readonly color: string;
  readonly routeId: MoreHubRouteId;
  readonly size?: number;
}) {
  const Icon = moreRouteIcons[routeId];
  return (
    <Icon
      accessibilityElementsHidden
      color={color}
      size={size}
      strokeWidth={2}
    />
  );
}

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
