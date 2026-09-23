import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import type { NotificationPreferencePatch } from "../capabilities/notification-settings";
import { NotificationsSettingsView } from "../components/notifications-settings-panel";
import { composeNotificationSettingsView } from "../domain/notification-status";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  Switch: "Switch",
}));

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const rendered = renderFunction(element);
  if (rendered) return [element, ...descendants(rendered)];
  return [element, ...childNodes(element).flatMap((child) => descendants(child))];
}

function renderFunction(element: Element): unknown {
  const candidate = element.type as unknown;
  if (typeof candidate !== "function") return null;
  return (candidate as (props: ElementProps) => unknown)(element.props);
}

function childNodes(element: Element): readonly unknown[] {
  const children = element.props.children;
  return Array.isArray(children) ? children : [children];
}

function hasTestId(nodes: readonly Element[], testID: string): boolean {
  return nodes.some((node) => node.props.testID === testID);
}

function panelNodes(input: {
  readonly apiLevel: number;
  readonly onChange?: (patch: NotificationPreferencePatch) => void;
  readonly permission: "granted" | "denied";
}): readonly Element[] {
  return descendants(
    NotificationsSettingsView({
      onChange: input.onChange ?? (() => undefined),
      onOpenSettings: () => undefined,
      onRetry: () => undefined,
      view: composeNotificationSettingsView({
        apiLevel: input.apiLevel,
        network: "online",
        permission: input.permission,
        preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      }),
    }),
  );
}

// Guards: Notifications Settings expose contract testIDs and only show retry when posting is denied
describe("notifications settings panel", () => {
  it("renders guest notification controls and hides retry while posting is granted", () => {
    const toggled: string[] = [];
    const nodes = panelNodes({
      apiLevel: 30,
      onChange: (patch) => {
        toggled.push(Object.keys(patch)[0] ?? "");
      },
      permission: "granted",
    });
    expect(hasTestId(nodes, "panel-notifications")).toBe(true);
    expect(hasTestId(nodes, "android-notifications")).toBe(true);
    expect(hasTestId(nodes, "live-activity")).toBe(true);
    expect(hasTestId(nodes, "toast")).toBe(true);
    expect(hasTestId(nodes, "sound")).toBe(true);
    expect(hasTestId(nodes, "notify-twitch")).toBe(true);
    expect(hasTestId(nodes, "notify-kick")).toBe(true);
    expect(hasTestId(nodes, "notify-guest")).toBe(true);
    expect(hasTestId(nodes, "favorites-only")).toBe(true);
    expect(hasTestId(nodes, "restart-grace")).toBe(true);
    expect(hasTestId(nodes, "notifications-system-settings")).toBe(true);
    expect(hasTestId(nodes, "notifications-lifecycle")).toBe(true);
    expect(hasTestId(nodes, "fcm-registration-status")).toBe(true);
    expect(hasTestId(nodes, "notifications-retry")).toBe(false);
    nodes
      .find((node) => node.props.testID === "notify-guest" && node.props.onPress)
      ?.props.onPress?.();
    expect(toggled).toEqual(["guestFollows"]);
  });

  it("shows retry when Android blocked posting", () => {
    const nodes = panelNodes({
      apiLevel: 33,
      permission: "denied",
    });
    expect(hasTestId(nodes, "notifications-retry")).toBe(true);
  });
});
