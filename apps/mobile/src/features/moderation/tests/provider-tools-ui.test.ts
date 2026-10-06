import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModWorkspaceHome } from "../components/mod-workspace-home";
import {
  LocalModerationHistory,
  ObservedFeed,
} from "../components/provider-tool-sheet";
import { createPlatformWorkflowNavigation } from "../adapters/workflow-navigation";
import type { ModerationSnapshot } from "../domain/moderation-controller";

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options: { defaultValue: string }) =>
      options.defaultValue,
  }),
}));
vi.mock("lucide-react-native", () => ({
  Ban: "span",
  ChartColumn: "span",
  Clock: "span",
  Gem: "span",
  Inbox: "span",
  MessageSquare: "span",
  MoreHorizontal: "span",
  Shield: "span",
  Users: "span",
  Video: "span",
  ChevronRight: "ChevronRight",
  ChevronDown: "ChevronDown",
}));
vi.mock("react-native", async () => {
  const actual = await vi.importActual("react-native");
  const host = ({ children }: { readonly children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    ...actual,
    View: host,
    Text: host,
    ScrollView: host,
    Pressable: host,
    Modal: host,
    TextInput: () => createElement("input"),
  };
});
const channel = {
  id: "10",
  platform: "twitch",
  login: "owner",
  name: "Owner",
} as const;
const snapshot: ModerationSnapshot = {
  platform: "twitch",
  channels: [channel],
  selection: { channel, role: "broadcaster" },
  activity: { kind: "idle" },
  banned: null,
  settings: null,
  review: null,
  sessionRevision: 1,
};
function find(
  node: unknown,
  testID: string,
): { readonly onPress?: () => void } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, testID);
      if (found) return found;
    }
    return null;
  }
  if (
    !isValidElement<{
      readonly testID?: string;
      readonly onPress?: () => void;
      readonly children?: unknown;
    }>(node)
  )
    return null;
  return node.props.testID === testID
    ? node.props
    : find(node.props.children, testID);
}
describe("moderation workspace production controls", () => {
  it("opens the selected channel's real tool and does not repeat the shell heading", () => {
    const onOpenTool = vi.fn();
    const view = ModWorkspaceHome({
      snapshot,
      feedback: null,
      onLoadPlatform: vi.fn(),
      onSelectChannel: vi.fn(),
      onOpenTool,
    });
    const row = find(view, "mod-tool-stream");
    if (!row?.onPress) throw new Error("Stream tools control is missing");
    row.onPress();
    expect(onOpenTool).toHaveBeenCalledWith("stream");
    const html = renderToStaticMarkup(
      createElement(ModWorkspaceHome, {
        snapshot,
        feedback: null,
        onLoadPlatform: vi.fn(),
        onSelectChannel: vi.fn(),
        onOpenTool,
      }),
    );
    expect(html).toContain("Owner");
    expect(html).toContain("Channel workspace");
    expect(html).toContain("Verified broadcaster");
    expect(html).not.toContain(">Moderation<");
  });
  it("keeps Kick local retention reachable and hides unsupported Twitch feed tools", () => {
    const kick = { ...channel, platform: "kick" } as const;
    const onOpenTool = vi.fn();
    const view = ModWorkspaceHome({
      snapshot: {
        ...snapshot,
        platform: "kick",
        channels: [kick],
        selection: { channel: kick, role: "broadcaster" },
      },
      feedback: null,
      onLoadPlatform: vi.fn(),
      onSelectChannel: vi.fn(),
      onOpenTool,
    });
    const row = find(view, "mod-tool-retention");
    if (!row?.onPress) throw new Error("Local retention control is missing");
    row.onPress();
    expect(onOpenTool).toHaveBeenCalledWith("retention");
    expect(find(view, "mod-tool-automod")).toBeNull();
  });
  it("renders connected empty, disconnected, and permission states with different meaning", () => {
    const props = {
      tool: "automod",
      onReconnect: vi.fn(),
      onRequestScopes: vi.fn(),
      onUser: vi.fn(),
      onModerate: vi.fn(),
      onCommand: vi.fn(),
      pending: false,
    } as const;
    const live = renderToStaticMarkup(
      createElement(ObservedFeed, {
        ...props,
        state: { kind: "live", since: "2026-10-05T12:00:00Z", items: [] },
      }),
    );
    expect(live).toContain("No held messages observed since this connection.");
    const disconnected = renderToStaticMarkup(
      createElement(ObservedFeed, {
        ...props,
        state: {
          kind: "disconnected",
          since: "2026-10-05T12:00:00Z",
          items: [],
        },
      }),
    );
    expect(disconnected).toContain(
      "No buffered events. This is not an empty live feed.",
    );
    const permission = renderToStaticMarkup(
      createElement(ObservedFeed, {
        ...props,
        state: {
          kind: "permission",
          detail: "Grant AutoMod permissions",
          scopes: ["moderator:manage:automod"],
        },
      }),
    );
    expect(permission).toContain("Grant feed permissions");
    expect(permission).not.toContain("No held messages");
  });
  it("renders locally collected history for the selected user and labels its limits", () => {
    const html = renderToStaticMarkup(
      createElement(LocalModerationHistory, {
        userId: "20",
        state: {
          kind: "ready",
          value: {
            retentionDays: 30,
            startedAt: 0,
            entries: [
              {
                id: "action1",
                at: 1,
                channel,
                actorId: "10",
                userId: "20",
                action: "timeout",
                detail: "Spam",
                source: "app-issued",
                outcome: "confirmed",
              },
              {
                id: "action2",
                at: 2,
                channel,
                actorId: "10",
                userId: "30",
                action: "ban",
                detail: "Other user",
                source: "app-issued",
                outcome: "confirmed",
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain("Local user moderation history");
    expect(html).toContain("Spam");
    expect(html).toContain("This is not complete provider history.");
    expect(html).not.toContain("Other user");
  });
  it("opens actual provider destinations for unsupported tools and viewer participation", async () => {
    const open = vi.fn(async () => undefined);
    const navigation = createPlatformWorkflowNavigation(open);
    await navigation.openModeration(channel, "twitch");
    await navigation.openModeration({ ...channel, platform: "kick" }, "kick");
    await navigation.openChannel(channel);
    expect(open.mock.calls).toEqual([
      ["https://www.twitch.tv/moderator/owner"],
      ["https://kick.com/owner"],
      ["https://www.twitch.tv/owner"],
    ]);
  });
});
