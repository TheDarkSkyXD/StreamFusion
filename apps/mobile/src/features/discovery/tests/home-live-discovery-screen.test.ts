import {
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
} from "react";
import type { FlatListProps } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import { describe, expect, it, vi } from "vitest";

import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";
import { fixtureOutcome } from "../domain/discovery-fixture";
import { HomeLiveDiscoveryView } from "../components/home-live-discovery-screen";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  FlatList(props: FlatListProps<Stream>) {
    const slot = (value: FlatListProps<Stream>["ListHeaderComponent"]) =>
      typeof value === "function" ? createElement(value) : value;
    return createElement(
      Fragment,
      null,
      slot(props.ListHeaderComponent),
      props.data?.flatMap((item, index) => [
        props.renderItem?.({
          item,
          index,
          separators: {
            highlight() {},
            unhighlight() {},
            updateProps() {},
          },
        }),
        index < (props.data?.length ?? 0) - 1 && props.ItemSeparatorComponent
          ? createElement(props.ItemSeparatorComponent)
          : null,
      ]),
      slot(props.ListFooterComponent),
    );
  },
  Image: "Image",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFillObject: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
  },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  accessibilityRole?: string;
  children?: unknown;
  onPress?: () => void;
  style?: Readonly<{ fontSize?: number; fontWeight?: string }>;
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

function render(
  twitch: ReturnType<typeof fixtureOutcome>,
  kick: ReturnType<typeof fixtureOutcome>,
  loading = false,
  extras: {
    readonly onSelectStream?: (stream: {
      readonly id: string;
      readonly platform: string;
    }) => void;
    readonly title?: string;
  } = {},
) {
  const root = HomeLiveDiscoveryView({
    onOpenAccounts: () => undefined,
    onOpenChannel: () => undefined,
    ...(extras.onSelectStream
      ? { onSelectStream: extras.onSelectStream as never }
      : {}),
    ...(extras.title === undefined ? {} : { title: extras.title }),
    view: composeHomeLiveDiscovery({ kick, loading, twitch }),
  });
  return { nodes: descendants(root), root };
}

describe("Home live discovery screen", () => {
  it("renders every live stream card without a carousel or Categories", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "ready"),
      fixtureOutcome("kick", "ready"),
    );
    expect(nodes.some((node) => node.props.testID === "home-featured-carousel")).toBe(false);
    expect(nodes.some((node) => node.props.testID === "home-stream-twitch-twitch-ready")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "home-stream-kick-kick-ready"),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children === "40 viewers" &&
          node.props.accessibilityLabel === "40 viewers",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "LIVE")).toBe(true);
    expect(nodes.some((node) => node.props.children === "proof")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "home-stream-tags-kick-ready"),
    ).toBe(true);
    const watchTitle = nodes.find((node) => node.props.children === "Watch");
    expect(watchTitle?.props.style).toMatchObject({
      fontSize: 24,
      fontWeight: "700",
    });
    expect(nodes.some((node) => node.props.testID === "open-categories")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "home-categories")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.children === "Categories")).toBe(
      false,
    );
  });

  it("stamps the Home proof panel with the D04 source token", () => {
    const root = HomeLiveDiscoveryView({
      onOpenAccounts: () => undefined,
      onOpenChannel: () => undefined,
      onSelectProofMode: () => undefined,
      proofMode: "ready",
      view: composeHomeLiveDiscovery({
        kick: fixtureOutcome("kick", "ready"),
        loading: false,
        twitch: fixtureOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    expect(
      nodes.some((node) => node.props.testID === "home-proof-source"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.children === "issue-148-d05-60c4"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "Live Channels")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "home-categories")).toBe(
      false,
    );
  });

  it("watches a stream from the full live list", () => {
    const selected: string[] = [];
    const { nodes } = render(
      fixtureOutcome("twitch", "ready"),
      fixtureOutcome("kick", "ready"),
      false,
      {
        onSelectStream: (stream) => {
          selected.push(`${stream.platform}:${stream.id}`);
        },
      },
    );
    nodes
      .find((node) => node.props.testID === "home-stream-twitch-twitch-ready")
      ?.props.onPress?.();
    expect(selected).toEqual(["twitch:twitch-ready"]);
  });

  it("shows a loading phase before either catalog arrives", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "loading"),
      fixtureOutcome("kick", "loading"),
      true,
    );
    const spinner = nodes.find(
      (node) => node.props.testID === "home-loading-spinner",
    );
    expect(spinner?.props.accessibilityRole).toBe("progressbar");
    expect(spinner?.props.accessibilityLabel).toBe("Loading live channels");
    expect(nodes.some((node) => node.props.testID === "home-phase")).toBe(false);
    expect(
      nodes.some((node) => node.props.testID === "home-featured-carousel"),
    ).toBe(false);
  });

  it("keeps Kick visible and shows automatic recovery when Twitch fails", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "twitch-fail"),
      fixtureOutcome("kick", "ready"),
    );
    expect(
      nodes.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(false);
    expect(nodes.some((node) => node.props.testID === "home-retry-kick")).toBe(
      false,
    );
    expect(
      nodes.some((node) => node.props.testID === "home-banner-twitch"),
    ).toBe(true);
  });

  it("surfaces stale cache age, sign in after auth loss, and Relay unavailability", () => {
    const stale = render(
      fixtureOutcome("twitch", "stale-cache"),
      fixtureOutcome("kick", "stale-cache"),
    );
    expect(
      stale.nodes.some((node) => node.props.testID === "home-cache-age-twitch"),
    ).toBe(true);

    const authLost = render(
      fixtureOutcome("twitch", "auth-lost"),
      fixtureOutcome("kick", "ready"),
    );
    expect(
      authLost.nodes.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(false);
    expect(
      authLost.nodes.some((node) => node.props.testID === "home-login-twitch"),
    ).toBe(true);

    const relayDown = render(
      fixtureOutcome("twitch", "relay-unavailable"),
      fixtureOutcome("kick", "cache-miss"),
    );
    expect(
      relayDown.nodes.some(
        (node) => node.props.testID === "home-banner-twitch",
      ),
    ).toBe(true);
    const phase = relayDown.nodes.find(
      (node) => node.props.testID === "home-phase",
    );
    expect(phase?.props.children).toMatch(/Couldn.t load live channels/);
  });

  it("supports Watch empty reuse via title and onSelectStream", () => {
    const selected: string[] = [];
    const root = HomeLiveDiscoveryView({
      onOpenAccounts: () => undefined,
      onSelectStream: (stream) => {
        selected.push(`${stream.platform}:${stream.id}`);
      },
      title: "Watch",
      view: composeHomeLiveDiscovery({
        kick: fixtureOutcome("kick", "ready"),
        loading: false,
        twitch: fixtureOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.children === "Watch")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "home-live-discovery"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "home-featured-carousel"),
    ).toBe(false);
    expect(nodes.some((node) => node.props.testID === "open-categories")).toBe(
      false,
    );
    nodes
      .find((node) => node.props.testID === "home-stream-kick-kick-ready")
      ?.props.onPress?.();
    expect(selected).toEqual(["kick:kick-ready"]);
  });
});
