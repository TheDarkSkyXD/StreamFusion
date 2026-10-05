import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import { ManageRow } from "../components/following-manage-screen";
import { guestFollow } from "../domain/following-fixtures";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("lucide-react-native", () => ({ ChevronRight: "ChevronRight" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type NodeProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  testID?: string;
}>;

function descendants(node: unknown): readonly ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<NodeProps>(node)) return [];
  const component = node.type;
  if (typeof component === "function") {
    return [node, ...descendants((component as (props: NodeProps) => unknown)(node.props))];
  }
  return [node, ...descendants(node.props.children)];
}

describe("Following Manage actions", () => {
  const follow = guestFollow({ channelId: "999", channelLogin: "bob", platform: "twitch" });
  const openProviderPage = vi.fn(async () => undefined);
  const removeGuestFollow = vi.fn(async () => ({
    kind: "unfollowed" as const,
    platform: "twitch" as const,
    channelId: "999",
  }));
  const session = {
    openProviderPage,
    removeGuestFollow,
    writeNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  };
  const props = {
    follow,
    notify: true,
    onRefresh: () => undefined,
    prefs: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    session,
  };

  it("hands an account-only follow to its provider without a guest removal action", () => {
    openProviderPage.mockClear();
    removeGuestFollow.mockClear();
    const nodes = descendants(ManageRow({ ...props, source: "account" }));
    expect(nodes.some((node) => node.props.testID === "following-unfollow-twitch-999")).toBe(false);
    nodes.find((node) => node.props.testID === "following-manage-provider-twitch-999")?.props.onPress?.();
    expect(openProviderPage).toHaveBeenCalledWith({ platform: "twitch", channelLogin: "bob" });
    expect(removeGuestFollow).not.toHaveBeenCalled();
  });

  it("uses explicit guest removal for a Guest Follow", () => {
    openProviderPage.mockClear();
    removeGuestFollow.mockClear();
    const nodes = descendants(ManageRow({ ...props, source: "guest" }));
    nodes.find((node) => node.props.testID === "following-unfollow-twitch-999")?.props.onPress?.();
    expect(removeGuestFollow).toHaveBeenCalledWith({ platform: "twitch", channelId: "999" });
    expect(openProviderPage).not.toHaveBeenCalled();
  });
});
