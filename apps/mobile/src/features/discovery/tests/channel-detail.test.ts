import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MediaTab } from "../components/channel-detail-media";
import { ChannelDetailBody } from "../components/channel-detail-screen";
import { composeChannelDetail, unsupportedMedia } from "../domain/channel-detail";
import {
  fixtureChannel,
  fixtureChannelDetail,
  fixtureChannelPage,
  fixtureClip,
  fixtureVideo,
} from "../domain/channel-fixture";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  children?: unknown;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
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
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("channel detail compose", () => {
  it("defaults Guest Follow to absent and enables Watch for a live stream", () => {
    const view = composeChannelDetail({
      clips: {
        kind: "page",
        outcome: {
          cache: { kind: "miss" },
          items: [fixtureClip("twitch")],
          path: { kind: "relay", platform: "twitch" },
          platform: "twitch",
          status: "complete",
        },
      },
      loading: false,
      page: fixtureChannelPage("twitch", "ready"),
      videos: {
        kind: "page",
        outcome: {
          cache: { kind: "miss" },
          items: [fixtureVideo("twitch")],
          path: { kind: "relay", platform: "twitch" },
          platform: "twitch",
          status: "complete",
        },
      },
    });
    expect(view.follow).toEqual({ kind: "guest-absent" });
    expect(view.watch).toEqual({
      kind: "available",
      target: {
        channelId: "twitch-twitch-ready",
        channelName: "twitch-live",
        platform: "twitch",
      },
    });
    expect(view.channel?.displayName).toBe(fixtureChannel("twitch", true).displayName);
    expect(view.phase).toBe("ready");
  });

  it("marks Kick clips unsupported and lists Kick videos", () => {
    const view = fixtureChannelDetail(
      { id: "kick-c1", platform: "kick", username: "kick-live" },
      "kick-unsupported",
    );
    expect(view.videos.kind).toBe("page");
    expect(view.clips).toEqual(unsupportedMedia("kick", "clips"));
  });
});

function bodyProps(
  channel: { readonly id: string; readonly platform: "twitch" | "kick"; readonly username: string },
  mode: "ready" | "kick-unsupported",
  extras: {
    readonly follow?: ReturnType<typeof fixtureChannelDetail>["follow"];
    readonly tab?: "home" | "videos" | "clips";
  } = {},
) {
  const view = fixtureChannelDetail(channel, mode);
  return {
    channel,
    onFollow: () => undefined,
    onOpenProviderPage: () => undefined,
    onRetry: () => undefined,
    onSelectTab: () => undefined,
    tab: extras.tab ?? "home",
    view:
      extras.follow === undefined ? view : { ...view, follow: extras.follow },
  } as const;
}

describe("channel detail screen", () => {
  it("renders header, tabs, about, Follow, and provider page", () => {
    const root = ChannelDetailBody(
      bodyProps(
        { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
        "ready",
      ),
    );
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "channel-header")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-tabs")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-about")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-follow")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-open-provider")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "channel-follow-reason")).toBe(
      true,
    );
    expect(
      nodes.some(
        (node) =>
          node.props.children ===
          "Save this channel as a Guest Follow on this device.",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "Follow")).toBe(true);
    expect(nodes.some((node) => node.props.children === "Open on Twitch")).toBe(
      true,
    );
    const watch = nodes.find((node) => node.props.testID === "channel-watch");
    expect(watch?.props.disabled).toBe(false);
  });

  it("disables Follow while a Guest Follow write is pending", () => {
    const nodes = descendants(
      ChannelDetailBody(
        bodyProps(
          { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
          "ready",
          { follow: { kind: "pending" } },
        ),
      ),
    );
    const follow = nodes.find((node) => node.props.testID === "channel-follow");
    expect(follow?.props.disabled).toBe(true);
    expect(
      nodes.some((node) => node.props.children === "Updating Guest Follow state."),
    ).toBe(true);
  });

  it("labels Unfollow when the channel is already a Guest Follow", () => {
    const nodes = descendants(
      ChannelDetailBody(
        bodyProps(
          { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
          "ready",
          { follow: { kind: "guest-present" } },
        ),
      ),
    );
    expect(nodes.some((node) => node.props.children === "Unfollow")).toBe(true);
  });

  it("shows loading copy while guest clips are still partial", () => {
    const nodes = descendants(
      MediaTab({
        kind: "clips",
        lane: {
          kind: "page",
          outcome: {
            cache: { kind: "miss" },
            items: [],
            path: { kind: "guest", platform: "twitch" },
            platform: "twitch",
            status: "partial",
          },
        },
      }),
    );
    expect(nodes.some((node) => node.props.testID === "channel-clips-loading")).toBe(
      true,
    );
  });

  it("shows empty copy after a completed guest clips read with no items", () => {
    const nodes = descendants(
      MediaTab({
        kind: "clips",
        lane: {
          kind: "page",
          outcome: {
            cache: { kind: "miss" },
            items: [],
            path: { kind: "guest", platform: "twitch" },
            platform: "twitch",
            status: "complete",
          },
        },
      }),
    );
    expect(nodes.some((node) => node.props.testID === "channel-clips-empty")).toBe(
      true,
    );
  });

  it("shows Kick video rows and unsupported clips copy", () => {
    const videos = descendants(
      ChannelDetailBody(
        bodyProps(
          { id: "kick-c1", platform: "kick", username: "kick-live" },
          "kick-unsupported",
          { tab: "videos" },
        ),
      ),
    );
    const clips = descendants(
      ChannelDetailBody(
        bodyProps(
          { id: "kick-c1", platform: "kick", username: "kick-live" },
          "kick-unsupported",
          { tab: "clips" },
        ),
      ),
    );
    expect(
      videos.some((node) => node.props.testID === "channel-videos-list"),
    ).toBe(true);
    expect(
      clips.some((node) => node.props.testID === "channel-clips-unsupported"),
    ).toBe(true);
  });
});
