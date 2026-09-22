import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";
import { fixtureOutcome } from "../domain/discovery-fixture";
import { HomeLiveDiscoveryView } from "../components/home-live-discovery-screen";

vi.mock("react-native", () => ({
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
    readonly featuredIndex?: number;
    readonly onFeaturedIndexChange?: (index: number) => void;
    readonly onSelectStream?: (stream: {
      readonly id: string;
      readonly platform: string;
    }) => void;
    readonly title?: string;
  } = {},
) {
  const retried: string[] = [];
  const root = HomeLiveDiscoveryView({
    featuredIndex: extras.featuredIndex ?? 0,
    onFeaturedIndexChange: extras.onFeaturedIndexChange,
    onOpenAccounts: () => undefined,
    onOpenChannel: () => undefined,
    onRetry: (platform) => {
      retried.push(platform);
    },
    ...(extras.onSelectStream
      ? { onSelectStream: extras.onSelectStream as never }
      : {}),
    ...(extras.title === undefined ? {} : { title: extras.title }),
    view: composeHomeLiveDiscovery({ kick, loading, twitch }),
  });
  return { nodes: descendants(root), retried, root };
}

describe("Home live discovery screen", () => {
  it("renders featured carousel and ready stream cards without Categories", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "ready"),
      fixtureOutcome("kick", "ready"),
    );
    expect(nodes.some((node) => node.props.testID === "home-featured-carousel")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "home-featured-watch")).toBe(
      true,
    );
    expect(
      nodes.some(
        (node) => node.props.testID === "home-stream-kick-kick-ready",
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children === "90 viewers",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "LIVE")).toBe(true);
    expect(nodes.some((node) => node.props.children === "proof")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "home-stream-tags-kick-ready")).toBe(
      true,
    );
    const homeTitle = nodes.find((node) => node.props.children === "Home");
    expect(homeTitle?.props.style).toMatchObject({ fontSize: 24, fontWeight: "700" });
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
      onRetry: () => undefined,
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
    expect(
      nodes.some((node) => node.props.children === "Recommended live"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "home-categories")).toBe(
      false,
    );
  });

  it("advances the featured carousel and watches the active slide", () => {
    const indexes: number[] = [];
    const selected: string[] = [];
    const { nodes } = render(
      fixtureOutcome("twitch", "ready"),
      fixtureOutcome("kick", "ready"),
      false,
      {
        featuredIndex: 0,
        onFeaturedIndexChange: (index) => indexes.push(index),
        onSelectStream: (stream) => {
          selected.push(`${stream.platform}:${stream.id}`);
        },
      },
    );
    expect(nodes.some((node) => node.props.testID === "home-featured-next")).toBe(
      true,
    );
    nodes.find((node) => node.props.testID === "home-featured-next")?.props.onPress?.();
    expect(indexes).toEqual([1]);
    nodes.find((node) => node.props.testID === "home-featured-watch")?.props.onPress?.();
    expect(selected).toEqual(["twitch:twitch-ready"]);
  });

  it("shows a loading phase before either catalog arrives", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "loading"),
      fixtureOutcome("kick", "loading"),
      true,
    );
    const phase = nodes.find((node) => node.props.testID === "home-phase");
    expect(phase?.props.children).toMatch(/Loading/);
    expect(nodes.some((node) => node.props.testID === "home-featured-carousel")).toBe(
      false,
    );
  });

  it("keeps Kick visible when only Twitch failed and retries Twitch alone", () => {
    const { nodes, retried } = render(
      fixtureOutcome("twitch", "twitch-fail"),
      fixtureOutcome("kick", "ready"),
    );
    expect(
      nodes.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "home-retry-kick")).toBe(
      false,
    );
    const retry = nodes.find(
      (node) => node.props.testID === "home-retry-twitch",
    );
    retry?.props.onPress?.();
    expect(retried).toEqual(["twitch"]);
  });

  it("surfaces stale cache age, guest retry after auth-lost, and Relay unavailability", () => {
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
    ).toBe(true);
    expect(
      authLost.nodes.some((node) => node.props.testID === "home-login"),
    ).toBe(false);

    const relayDown = render(
      fixtureOutcome("twitch", "relay-unavailable"),
      fixtureOutcome("kick", "cache-miss"),
    );
    expect(
      relayDown.nodes.some((node) => node.props.testID === "home-banner-twitch"),
    ).toBe(true);
    const phase = relayDown.nodes.find(
      (node) => node.props.testID === "home-phase",
    );
    expect(phase?.props.children).toMatch(/could not be loaded/);
  });

  it("supports Watch empty reuse via title and onSelectStream", () => {
    const selected: string[] = [];
    const root = HomeLiveDiscoveryView({
      onOpenAccounts: () => undefined,
      onRetry: () => undefined,
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
    expect(nodes.some((node) => node.props.testID === "home-live-discovery")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "home-featured-carousel")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "open-categories")).toBe(
      false,
    );
    nodes
      .find((node) => node.props.testID === "home-stream-kick-kick-ready")
      ?.props.onPress?.();
    expect(selected).toEqual(["kick:kick-ready"]);
  });
});
