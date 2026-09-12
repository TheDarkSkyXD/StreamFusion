import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";
import { fixtureOutcome } from "../domain/discovery-fixture";
import { HomeLiveDiscoveryView } from "../components/home-live-discovery-screen";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View"
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

function render(
  twitch: ReturnType<typeof fixtureOutcome>,
  kick: ReturnType<typeof fixtureOutcome>,
  loading = false
) {
  const retried: string[] = [];
  const root = HomeLiveDiscoveryView({
    onOpenCategories: () => undefined,
    onOpenChannel: () => undefined,
    onRetry: (platform) => {
      retried.push(platform);
    },
    view: composeHomeLiveDiscovery({ kick, loading, twitch })
  });
  return { nodes: descendants(root), retried, root };
}

describe("Home live discovery screen", () => {
  it("renders ready stream cards with live viewer counts", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "ready"),
      fixtureOutcome("kick", "ready")
    );
    expect(
      nodes.some(
        (node) => node.props.testID === "home-stream-twitch-twitch-ready"
      )
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children === "90 viewers"
      )
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === "LIVE")).toBe(true);
  });

  it("stamps the Home proof panel with the D04 source token", () => {
    const opened: string[] = [];
    const root = HomeLiveDiscoveryView({
      onOpenCategories: () => opened.push("categories"),
      onOpenChannel: (channel) => opened.push(`${channel.platform}:${channel.username}`),
      onRetry: () => undefined,
      onSelectProofMode: () => undefined,
      proofMode: "ready",
      view: composeHomeLiveDiscovery({
        kick: fixtureOutcome("kick", "ready"),
        loading: false,
        twitch: fixtureOutcome("twitch", "ready")
      })
    });
    const nodes = descendants(root);
    expect(
      nodes.some((node) => node.props.testID === "home-proof-source")
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.children === "issue-148-d05-60c4")
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.children === "Recommended live")
    ).toBe(true);
    nodes.find((node) => node.props.testID === "home-categories")?.props.onPress?.();
    expect(opened).toEqual(["categories"]);
  });

  it("shows a loading phase before either catalog arrives", () => {
    const { nodes } = render(
      fixtureOutcome("twitch", "loading"),
      fixtureOutcome("kick", "loading"),
      true
    );
    const phase = nodes.find((node) => node.props.testID === "home-phase");
    expect(phase?.props.children).toMatch(/Loading/);
  });

  it("keeps Kick visible when only Twitch failed and retries Twitch alone", () => {
    const { nodes, retried } = render(
      fixtureOutcome("twitch", "twitch-fail"),
      fixtureOutcome("kick", "ready")
    );
    expect(
      nodes.some((node) => node.props.testID === "home-retry-twitch")
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "home-retry-kick")).toBe(
      false
    );
    const retry = nodes.find(
      (node) => node.props.testID === "home-retry-twitch"
    );
    retry?.props.onPress?.();
    expect(retried).toEqual(["twitch"]);
  });

  it("surfaces stale cache age, guest retry after auth-lost, and Relay unavailability", () => {
    const stale = render(
      fixtureOutcome("twitch", "stale-cache"),
      fixtureOutcome("kick", "stale-cache")
    );
    expect(
      stale.nodes.some((node) => node.props.testID === "home-cache-age-twitch")
    ).toBe(true);

    const authLost = render(
      fixtureOutcome("twitch", "auth-lost"),
      fixtureOutcome("kick", "ready")
    );
    expect(
      authLost.nodes.some((node) => node.props.testID === "home-retry-twitch")
    ).toBe(true);
    expect(
      authLost.nodes.some((node) => node.props.testID === "home-login")
    ).toBe(false);

    const relayDown = render(
      fixtureOutcome("twitch", "relay-unavailable"),
      fixtureOutcome("kick", "cache-miss")
    );
    expect(
      relayDown.nodes.some((node) => node.props.testID === "home-banner-twitch")
    ).toBe(true);
    const phase = relayDown.nodes.find(
      (node) => node.props.testID === "home-phase"
    );
    expect(phase?.props.children).toMatch(/could not be loaded/);
  });
});
