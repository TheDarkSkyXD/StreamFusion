import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DestinationIcon,
  formatActivityUnreadBadge,
} from "../components/destination-icon";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Bell: "Bell",
  Heart: "Heart",
  Menu: "Menu",
  Play: "Play",
  Search: "Search",
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
