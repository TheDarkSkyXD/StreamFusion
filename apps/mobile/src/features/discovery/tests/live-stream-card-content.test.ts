import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { HomeStreamCard } from "../components/home-stream-card";
import { LiveStreamCardContent } from "../components/live-stream-card-content";
import { fixtureStream } from "../domain/discovery-fixture";

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  numberOfLines?: number;
  onPress?: () => void;
  source?: unknown;
  style?: unknown;
  testID?: string;
}>;

function descendants(node: unknown): readonly ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<ElementProps>(node)) return [];
  const candidate: unknown = node.type;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : null;
  const children = component ? component(node.props) : node.props.children;
  return [node, ...descendants(children)];
}

describe("live stream card content", () => {
  it("shows a compact count, readable language, maturity, and one-line title", () => {
    const stream = {
      ...fixtureStream("twitch", "large", 10_400),
      channelIsVerified: true,
      channelDisplayName: "A very long channel name that must fit on a phone",
      isMature: true,
      tags: ["an extremely long stream tag that should not stretch the card"],
    };
    const nodes = descendants(LiveStreamCardContent({ stream }));
    const viewers = nodes.find(
      (node) => node.props.testID === "stream-viewer-count",
    );
    expect(viewers?.props.children).toBe("10.4K");
    expect(viewers?.props.accessibilityLabel).toBe("10400 viewers");
    expect(nodes.some((node) => node.props.children === "English")).toBe(true);
    expect(nodes.some((node) => node.props.children === "18+")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "verified-badge-twitch"),
    ).toBe(true);
    expect(
      nodes.find((node) => node.props.children === stream.channelDisplayName)
        ?.props.numberOfLines,
    ).toBe(1);
    expect(
      nodes.find((node) => node.props.children === stream.title)?.props
        .numberOfLines,
    ).toBe(1);
    expect(nodes.some((node) => node.props.children === "LIVE")).toBe(false);
  });

  it("uses the Kick badge only for verified streams and keeps the card action", () => {
    const stream = fixtureStream("kick", "ready", 90);
    const opened: string[] = [];
    const unverified = descendants(
      HomeStreamCard({
        onOpen: () => opened.push("kick"),
        stream,
      }),
    );
    const card = unverified.find(
      (node) => node.props.testID === "home-stream-kick-ready",
    );
    expect(card?.props.accessibilityLabel).toContain("90 viewers");
    expect(
      unverified.some((node) => node.props.testID === "verified-badge-kick"),
    ).toBe(false);
    card?.props.onPress?.();
    expect(opened).toEqual(["kick"]);

    const verified = descendants(
      HomeStreamCard({
        stream: { ...stream, channelIsVerified: true },
      }),
    );
    expect(
      verified.some((node) => node.props.testID === "verified-badge-kick"),
    ).toBe(true);
    expect(verified.some((node) => node.props.children === "18+")).toBe(false);
  });
});
