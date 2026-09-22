import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MobileConnectivityBanner } from "../connectivity-banner";
import { MobileListState } from "../list-state";
import { mobileHitSlop, mobilePressedOpacity, mobileSizing } from "../tokens";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Warning: "warning" },
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
}));

vi.mock("lucide-react-native", () => ({
  WifiOff: "WifiOff",
}));

type ElementProps = Readonly<{
  children?: unknown;
  status?: string;
  testID?: string;
  phase?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof (candidate as { type: unknown }).type === "function"
        ? ((candidate as { type: (props: ElementProps) => unknown }).type)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("mobile UX primitives", () => {
  it("keeps touch targets at least 44pt and exposes shared hitSlop", () => {
    expect(mobileSizing.minimumTouchTarget).toBeGreaterThanOrEqual(44);
    expect(mobileHitSlop.top).toBeGreaterThanOrEqual(8);
    expect(mobilePressedOpacity).toBeLessThan(1);
  });

  it("hides the connectivity banner while online", () => {
    const tree = MobileConnectivityBanner({ status: "online" });
    expect(tree).toBeNull();
  });

  it("shows an offline connectivity banner without blocking chrome", () => {
    const nodes = descendants(
      MobileConnectivityBanner({ status: "offline" }),
    );
    expect(nodes.some((node) => node.props.testID === "connectivity-banner")).toBe(
      true,
    );
  });

  it("renders loading and error list states with honest copy", () => {
    const loading = descendants(
      MobileListState({
        message: "Loading live recommendations.",
        phase: "loading",
        testID: "list-loading",
      }),
    );
    expect(loading.some((node) => node.props.testID === "list-loading")).toBe(
      true,
    );

    const failed = descendants(
      MobileListState({
        message: "Could not load this feed.",
        onRetry: () => undefined,
        phase: "error",
        testID: "list-error",
        title: "Unavailable",
      }),
    );
    expect(failed.some((node) => node.props.testID === "list-error")).toBe(true);
    expect(
      failed.some((node) => node.props.testID === "list-error-retry"),
    ).toBe(true);
  });
});
