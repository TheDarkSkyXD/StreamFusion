import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ActivityDetailScreen,
  ActivityScreen,
} from "../components/activity-screen";
import type { ActivityViewModel } from "../components/activity-controller";
import type { DevelopmentActivityProofViewModel } from "../capabilities/development-activity-proof";

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

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: () => ({ current: null }),
  };
});

type ElementProps = Readonly<{
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
  accessibilityLabel?: string;
  accessibilityState?: Readonly<{ busy?: boolean; disabled?: boolean }>;
  accessible?: boolean;
  children?: unknown;
  onPress?: () => void;
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
    dismissalConfirmation: null,
    dismissalFailure: false,
    dismissalResult: null,
    filter: "all",
    isDismissing: false,
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

function render(
  modelValue: ActivityViewModel,
  developmentProof?: DevelopmentActivityProofViewModel,
) {
  const root = ActivityScreen({
    model: modelValue,
    onCancelDismissal: () => undefined,
    onConfirmDismissal: async () => undefined,
    onDismissVisibleCompleted: () => undefined,
    ...(developmentProof ? {
      developmentProof,
      onExitDevelopmentProof: async () => undefined,
      onRetryDevelopmentProof: async () => undefined,
    } : {}),
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

  it("emits a reachable clear-completed control with explicit busy state", () => {
    const ready = render(model()).find(
      (node) => node.props.testID === "activity-clear-completed",
    );
    expect(ready?.props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });

    const busy = render(model({ isDismissing: true })).find(
      (node) => node.props.testID === "activity-clear-completed",
    );
    expect(busy?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  });

  it("states that Clear completed applies across Activity tabs", () => {
    const nodes = render(
      model({
        dismissalConfirmation: {
          eventIds: ["event:system", "event:other"],
          kind: "clear-completed",
        },
        filter: "channels",
      }),
    );
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("across all Activity tabs"),
      ),
    ).toBe(true);
  });

  it("keeps a detail dismissal confirmation, cancel, and destination action together", () => {
    const onCancelDismissal = vi.fn();
    const onDismissItem = vi.fn();
    const onOpen = vi.fn();
    const detail = ActivityDetailScreen({
      dismissalConfirmation: {
        eventIds: ["event:system"],
        kind: "dismiss-item",
      },
      dismissalFailure: false,
      dismissalResult: null,
      eventId: "event:system",
      isDismissing: false,
      isMarkingRead: false,
      items: [item()],
      mutationFailure: null,
      onCancelDismissal,
      onConfirmDismissal: async () => undefined,
      onDismissItem,
      onMarkRead: async () => undefined,
      onOpen,
    });
    const nodes = descendants(detail);
    const dismiss = nodes.find(
      (node) => node.props.testID === "activity-dismiss-item",
    );
    const cancel = nodes.find(
      (node) => node.props.testID === "activity-dismissal-cancel",
    );
    const destination = nodes.find(
      (node) => node.props.testID === "activity-open-destination",
    );

    dismiss?.props.onPress?.();
    cancel?.props.onPress?.();
    destination?.props.onPress?.();

    expect(onDismissItem).toHaveBeenCalledWith("event:system");
    expect(onCancelDismissal).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({ route: "more/diagnostics" });
  });

  it("places a detail dismissal confirmation before the proof banner", () => {
    const detail = ActivityDetailScreen({
      developmentProof: {
        detail: "Isolated Activity proof data is selected.",
        kind: "proof",
        namespace: "activity-proof-11111111-1111-4111-8111-111111111111",
      },
      dismissalConfirmation: {
        eventIds: ["event:system"],
        kind: "dismiss-item",
      },
      dismissalFailure: false,
      dismissalResult: null,
      eventId: "event:system",
      isDismissing: false,
      isMarkingRead: false,
      items: [item()],
      mutationFailure: null,
      onCancelDismissal: () => undefined,
      onConfirmDismissal: async () => undefined,
      onDismissItem: () => undefined,
      onExitDevelopmentProof: async () => undefined,
      onMarkRead: async () => undefined,
      onOpen: () => undefined,
    });
    const children = Array.isArray(detail.props.children)
      ? detail.props.children
      : [detail.props.children];
    const confirmationIndex = children.findIndex((child) =>
      descendants(child).some(
        (node) => node.props.testID === "activity-dismissal-confirmation",
      ),
    );
    const proofBannerIndex = children.findIndex((child) =>
      descendants(child).some(
        (node) => node.props.testID === "activity-proof-banner",
      ),
    );

    expect(confirmationIndex).toBeGreaterThanOrEqual(0);
    expect(proofBannerIndex).toBeGreaterThanOrEqual(0);
    expect(confirmationIndex).toBeLessThan(proofBannerIndex);
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

  it("keeps proof failure identity and its cleanup retry reachable in Activity", () => {
    const nodes = render(model(), {
      detail: "Proof cleanup could not finish.",
      kind: "cleanup-required",
      namespace: "activity-proof-11111111-1111-4111-8111-111111111111",
      selected: true,
    });
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("activity-proof-11111111"),
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.props.testID === "retry-activity-proof-cleanup",
      ),
    ).toBe(true);
  });

  it("shows a replay failure and Exit from the selected proof Activity", () => {
    const nodes = render(model(), {
      detail: "Proof Activity replay could not be saved.",
      kind: "proof",
      namespace: "activity-proof-11111111-1111-4111-8111-111111111111",
    });
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("replay could not be saved"),
      ),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "exit-activity-proof"),
    ).toBe(true);
  });
});
