import { isValidElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import { composeFollowingView } from "../domain/compose-following-view";
import { FollowingTabBody } from "../components/following-tab-body";
import {
  followedClip,
  followedStream,
  followedVideo,
  guestFollow,
  liveOutcome,
  recordedOutcome,
} from "../domain/following-fixtures";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));



type ElementProps = Readonly<{
  accessibilityLabel?: string;
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

const twitchFollow = guestFollow();
const liveStream = followedStream({
  channelId: twitchFollow.channelId,
  channelName: twitchFollow.channelLogin,
  platform: "twitch",
});

describe("Following screen", () => {
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });


  it("renders live Guest Follow cards", () => {
    const stream = followedStream({
      categoryId: "509658",
      categoryName: "Just Chatting",
      channelId: twitchFollow.channelId,
      channelName: twitchFollow.channelLogin,
      platform: "twitch",
    });
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "live",
      twitch: liveOutcome("twitch", "complete", [stream]),
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        view,
      }),
    );
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "following-stream-twitch-twitch-stream",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "LIVE")).toBe(true);
    expect(nodes.some((node) => node.props.children === "Just Chatting")).toBe(
      true,
    );
    const phase = nodes.find((node) => node.props.testID === "following-phase");
    expect(phase?.props.children).toMatch(/Live Guest Follows/);
  });

  it("renders the empty Guest Follow copy", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "live",
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        view,
      }),
    );
    const phase = nodes.find((node) => node.props.testID === "following-phase");
    expect(phase?.props.children).toMatch(/Follow channels as a guest/);
  });

  it("shows failed live Guest Follow copy without a Retry button", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "live",
      twitch: liveOutcome("twitch", "failed"),
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        view,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "following-retry-twitch"),
    ).toBe(false);
    expect(
      nodes.some((node) =>
        typeof node.props.children === "string" &&
        /Retry twitch/i.test(node.props.children),
      ),
    ).toBe(false);
  });

  it("renders Kick recorded unsupported copy", () => {
    const view = composeFollowingView({
      chip: "kick",
      loadingLive: false,
      loadingRecorded: false,
      membership: [
        guestFollow({
          channelId: "kick-1",
          channelLogin: "kicklive",
          platform: "kick",
        }),
      ],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      recorded: [recordedOutcome({ platform: "kick", supported: false })],
      tab: "videos",
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        view,
      }),
    );
    const phase = nodes.find((node) => node.props.testID === "following-phase");
    expect(phase?.props.children).toMatch(/Kick does not offer videos/);
  });


  it("opens Watch from rich Following video cards", () => {
    const watched: string[] = [];
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      recorded: [
        recordedOutcome({
          items: [followedVideo({ title: "VOD one" })],
          platform: "twitch",
        }),
      ],
      tab: "videos",
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        onWatch: (target) => watched.push(target.media?.id ?? "missing"),
        view,
      }),
    );
    expect(
      nodes.some(
        (node) => node.props.testID === "following-video-twitch-twitch-video",
      ),
    ).toBe(true);
    nodes
      .find((node) => node.props.testID === "following-video-twitch-twitch-video")
      ?.props.onPress?.();
    expect(watched).toEqual(["twitch-video"]);
  });

  it("opens Watch from rich Following clip cards", () => {
    const watched: string[] = [];
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      recorded: [
        {
          channelId: "twitch-1",
          failed: false,
          items: [followedClip({ title: "Clip one" })],
          offline: false,
          platform: "twitch",
          stale: false,
          supported: true,
        },
      ],
      tab: "clips",
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        onWatch: (target) => watched.push(target.media?.id ?? "missing"),
        view,
      }),
    );
    nodes
      .find((node) => node.props.testID === "following-clip-twitch-twitch-clip")
      ?.props.onPress?.();
    expect(watched).toEqual(["twitch-clip"]);
  });

  it("opens category detail from Following category cards", () => {
    const opened: string[] = [];
    const stream = followedStream({
      categoryId: "509658",
      categoryName: "Just Chatting",
      channelId: twitchFollow.channelId,
      channelName: twitchFollow.channelLogin,
      platform: "twitch",
      viewerCount: 20,
    });
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "categories",
      twitch: liveOutcome("twitch", "complete", [stream]),
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenCategory: (category) => opened.push(category.id),
        onOpenProvider: () => undefined,
        view,
      }),
    );
    nodes
      .find((node) => node.props.testID === "following-category-twitch-509658")
      ?.props.onPress?.();
    expect(opened).toEqual(["509658"]);
  });

  it("renders a stronger live pill on Following channel cards", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "channels",
      twitch: liveOutcome("twitch", "complete", [liveStream]),
    });
    const nodes = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        view,
      }),
    );
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "following-channel-twitch-twitch-1",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "Live")).toBe(true);
  });

  it("keeps a Search CTA for empty guest membership in the Following screen", () => {
    const source = readFileSync(
      new URL("../components/following-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('testID="following-open-search"');
    expect(source).toContain("discovery.following.findChannelsInSearch");
    expect(source).toContain("onOpenSearch");
  });

});
