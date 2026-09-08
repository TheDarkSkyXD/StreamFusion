import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActivityScreen } from "../components/activity-screen";
import type { ActivityViewModel } from "../components/activity-controller";

type SystemActivityItem = Extract<
  ActivityViewModel["items"][number],
  { readonly kind: "system" }
>;

vi.mock("react-native", () => ({
  FlatList: "FlatList",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Bell: "Bell",
  BriefcaseBusiness: "BriefcaseBusiness",
  ChevronRight: "ChevronRight",
  CircleAlert: "CircleAlert",
}));

type ElementProps = Readonly<{
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
  accessibilityLabel?: string;
  accessibilityState?: Readonly<{ busy?: boolean; disabled?: boolean }>;
  accessible?: boolean;
  children?: unknown;
  numberOfLines?: number;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function item(overrides: Partial<SystemActivityItem> = {}): SystemActivityItem {
  return {
    body: "A saved device event.",
    destination: { kind: "diagnostics" },
    event: "device-health",
    eventId: "event:system",
    kind: "system",
    occurredAt: "2026-09-08T00:00:00.000Z" as SystemActivityItem["occurredAt"],
    readAt: null,
    schemaVersion: 1,
    source: "local",
    title: "Storage check finished after a long retained result",
    ...overrides,
  };
}

function model(overrides: Partial<ActivityViewModel> = {}): ActivityViewModel {
  const items = overrides.items ?? [item()];
  return {
    allItems: items,
    filter: "all",
    isMarkingAllRead: false,
    isRefreshing: false,
    items,
    markingReadEventIds: [],
    mutationFailure: null,
    status: "ready",
    unreadCount: items.filter((candidate) => candidate.readAt === null).length,
    ...overrides,
  };
}

function descendants(node: unknown): readonly Element[] {
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

function render(modelValue: ActivityViewModel) {
  const root = ActivityScreen({
    model: modelValue,
    onMarkAllRead: async () => undefined,
    onOpen: () => undefined,
    onRefresh: async () => undefined,
    onSelectFilter: () => undefined,
  }) as ReactElement<{
    ListHeaderComponent: unknown;
    ListEmptyComponent: unknown;
    renderItem: (input: { readonly item: SystemActivityItem }) => unknown;
  }>;
  const firstItem = modelValue.items[0];
  return [
    ...descendants(root.props.ListHeaderComponent),
    ...descendants(root.props.ListEmptyComponent),
    ...(firstItem
      ? descendants(
          root.props.renderItem({ item: firstItem as SystemActivityItem }),
        )
      : []),
  ];
}

describe("Activity screen", () => {
  it("renders typed row provenance and an uncapped title", () => {
    const nodes = render(model());
    expect(nodes.some((node) => node.type === "CircleAlert")).toBe(true);
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.startsWith("Unread · System · Local ·"),
      ),
    ).toBe(true);
    const title = nodes.find(
      (node) =>
        node.props.children ===
        "Storage check finished after a long retained result",
    );
    expect(title?.props.numberOfLines).toBeUndefined();
  });

  it("emits explicit disabled and busy state for mark-all", () => {
    const idle = render(model({ unreadCount: 0 })).find(
      (node) => node.props.testID === "activity-mark-all-read",
    );
    expect(idle?.props.accessibilityState).toEqual({
      busy: false,
      disabled: true,
    });

    const busy = render(model({ isMarkingAllRead: true })).find(
      (node) => node.props.testID === "activity-mark-all-read",
    );
    expect(busy?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  });

  it("keeps saved rows visible with a reachable retry after a failed refresh", () => {
    const nodes = render(model({ status: "unavailable" }));
    const notice = nodes.find(
      (node) => node.props.testID === "activity-availability",
    );
    expect(notice?.props.accessible).toBeUndefined();
    expect(
      nodes.some((node) => node.props.accessibilityLiveRegion === "polite"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "activity-retry-load"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "activity-item-event:system"),
    ).toBe(true);
  });

  it("does not group the unavailable empty-state retry with its status text", () => {
    const nodes = render(
      model({ allItems: [], items: [], status: "unavailable", unreadCount: 0 }),
    );
    const empty = nodes.find(
      (node) => node.props.testID === "activity-empty-state",
    );
    expect(empty?.props.accessible).toBeUndefined();
    expect(
      nodes.some((node) => node.props.accessibilityLiveRegion === "polite"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "activity-retry-load"),
    ).toBe(true);
  });
});
