import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DestinationIcon,
  formatActivityUnreadBadge,
  moreRouteIcons,
  MoreRouteIcon,
} from "../components/destination-icon";
import { MORE_ROUTE_IDS } from "../domain/shell-navigation";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Activity: "Activity",
  Bell: "Bell",
  CircleUserRound: "CircleUserRound",
  Download: "Download",
  Heart: "Heart",
  History: "History",
  LayoutGrid: "LayoutGrid",
  Menu: "Menu",
  Play: "Play",
  Search: "Search",
  Settings: "Settings",
  Shield: "Shield",
}));

type ElementProps = Readonly<{
  children?: unknown;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (!isValidElement<ElementProps>(node)) return [];
  const children = node.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [node, ...childNodes.flatMap((child) => descendants(child))];
}

// Guards: Activity unread badge appears only on the Activity destination
// Guards: unread counts above 99 render as 99+
describe("Activity destination badge", () => {
  it("caps the visible unread count at 99+", () => {
    expect(formatActivityUnreadBadge(1)).toBe("1");
    expect(formatActivityUnreadBadge(99)).toBe("99");
    expect(formatActivityUnreadBadge(100)).toBe("99+");
  });

  it("renders an unread badge only for Activity", () => {
    const activity = descendants(
      DestinationIcon({
        color: "#fff",
        destination: "activity",
        unreadCount: 3,
      }),
    );
    expect(
      activity.some((node) => node.props.testID === "nav-activity-unread-badge"),
    ).toBe(true);
    expect(
      activity.some((node) => node.props.children === "3"),
    ).toBe(true);

    const search = descendants(
      DestinationIcon({
        color: "#fff",
        destination: "search",
        unreadCount: 3,
      }),
    );
    expect(
      search.some((node) => node.props.testID === "nav-activity-unread-badge"),
    ).toBe(false);
  });

  it("hides the badge when Activity has no unread items", () => {
    const nodes = descendants(
      DestinationIcon({
        color: "#fff",
        destination: "activity",
        unreadCount: 0,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "nav-activity-unread-badge"),
    ).toBe(false);
  });
});

// Guards: More hub cards use Electron-aligned Lucide icons with no description text
describe("More hub route icons", () => {
  it("maps every More hub route to an icon", () => {
    for (const routeId of MORE_ROUTE_IDS) {
      expect(moreRouteIcons[routeId]).toBeTruthy();
      const node = MoreRouteIcon({
        color: "#fff",
        routeId,
      });
      expect(node.type).toBe(moreRouteIcons[routeId]);
    }
  });

  it("uses Electron-aligned icon names for the hub", () => {
    expect(moreRouteIcons["more/categories"]).toBe("LayoutGrid");
    expect(moreRouteIcons["more/history"]).toBe("History");
    expect(moreRouteIcons["more/downloads"]).toBe("Download");
    expect(moreRouteIcons["more/moderation"]).toBe("Shield");
    expect(moreRouteIcons["more/settings"]).toBe("Settings");
    expect(moreRouteIcons["more/diagnostics"]).toBe("Activity");
    expect(moreRouteIcons["more/accounts"]).toBe("CircleUserRound");
  });
});
