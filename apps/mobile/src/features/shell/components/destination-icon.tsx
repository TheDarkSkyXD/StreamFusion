import {
  Activity,
  Bell,
  CircleUserRound,
  Download,
  Heart,
  House,
  Grid3X3,
  LayoutDashboard,
  History,
  Ellipsis,
  Search,
  Shield,
  type LucideIcon,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { MobileSettingsIcon } from "@mobile/design/settings-icon";
import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileRadii, mobileSizing } from "@mobile/design/tokens";

import type { ShellDestinationId } from "../domain/shell-navigation";
import { MORE_ROUTE_IDS } from "../domain/shell-navigation";

const destinationIcons: Readonly<Record<ShellDestinationId, LucideIcon>> = {
  search: Search,
  following: Heart,
  watch: House,
  activity: Bell,
  more: Ellipsis,
};

/** Electron sidebar / settings iconography mirrored for the More hub cards. */
export const moreRouteIcons = {
  "more/categories": Grid3X3,
  "more/history": History,
  "more/downloads": Download,
  "more/moderation": Shield,
  "more/multistream": LayoutDashboard,
  "more/settings": MobileSettingsIcon,
  "more/diagnostics": Activity,
  "more/accounts": CircleUserRound,
} as const satisfies Readonly<
  Record<
    (typeof MORE_ROUTE_IDS)[number],
    ComponentType<{ readonly color: string; readonly size: number }>
  >
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
  return <Icon accessibilityElementsHidden color={color} size={size} />;
}

export function formatActivityUnreadBadge(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function DestinationIcon({
  color,
  destination,
  selected = false,
  unreadCount = 0,
}: {
  readonly color: string;
  readonly destination: ShellDestinationId;
  readonly selected?: boolean;
  readonly unreadCount?: number;
}) {
  const Icon = destinationIcons[destination];
  const showBadge = destination === "activity" && unreadCount > 0;
  return (
    <View>
      <Icon
        accessibilityElementsHidden
        color={color}
        size={22}
        strokeWidth={selected ? 2.4 : 1.7}
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
