import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

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
  it("keeps guest follow unsupported and Watch unavailable", () => {
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
    expect(view.follow).toEqual({ kind: "guest-unsupported" });
    expect(view.watch.kind).toBe("unavailable");
    expect(view.channel?.displayName).toBe(fixtureChannel("twitch", true).displayName);
    expect(view.phase).toBe("ready");
  });

  it("marks Kick videos and clips unsupported", () => {
    const view = fixtureChannelDetail(
      { id: "kick-c1", platform: "kick", username: "kick-live" },
      "kick-unsupported",
    );
    expect(view.videos).toEqual(unsupportedMedia("kick", "videos"));
    expect(view.clips).toEqual(unsupportedMedia("kick", "clips"));
  });
});

describe("channel detail screen", () => {
  it("renders header, tabs, about, and guest follow reason", () => {
    const root = ChannelDetailBody({
      channel: { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      tab: "home",
      view: fixtureChannelDetail(
        { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
        "ready",
      ),
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "channel-header")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-tabs")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-about")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "channel-follow-reason")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.children === "Guest Follow is not available yet."),
    ).toBe(true);
  });

  it("shows Kick unsupported copy for videos and clips", () => {
    const videos = descendants(
      ChannelDetailBody({
        channel: { id: "kick-c1", platform: "kick", username: "kick-live" },
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        tab: "videos",
        view: fixtureChannelDetail(
          { id: "kick-c1", platform: "kick", username: "kick-live" },
          "kick-unsupported",
        ),
      }),
    );
    const clips = descendants(
      ChannelDetailBody({
        channel: { id: "kick-c1", platform: "kick", username: "kick-live" },
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        tab: "clips",
        view: fixtureChannelDetail(
          { id: "kick-c1", platform: "kick", username: "kick-live" },
          "kick-unsupported",
        ),
      }),
    );
    expect(
      videos.some((node) => node.props.testID === "channel-videos-unsupported"),
    ).toBe(true);
    expect(
      clips.some((node) => node.props.testID === "channel-clips-unsupported"),
    ).toBe(true);
  });
});
