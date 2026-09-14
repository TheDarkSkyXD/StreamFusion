import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { HistoryView } from "../components/history-view";
import type { WatchHistoryItem } from "../capabilities/watch-history";
import { composeWatchHistoryView } from "../domain/watch-history-view";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  onPress?: () => void;
  source?: { readonly uri?: string };
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
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

const video: WatchHistoryItem = {
  avatarUrl: "https://example.test/avatar.png",
  channelDisplayName: "xQc",
  channelId: "71092938",
  channelLogin: "xqc",
  contentId: "vod-1",
  durationSeconds: 120,
  id: "twitch-video-vod-1",
  kind: "video",
  platform: "twitch",
  positionSeconds: 40,
  thumbnailUrl: "https://example.test/vod.png",
  title: "Yesterday",
  updatedAt: Date.parse("2026-09-14T12:00:00.000Z"),
};

// Guards: History rows keep 16:9 thumbs, avatars, progress, and resume without autoplay
// Guards: empty, offline, and unavailable History stay distinct
describe("History screen", () => {
  it("renders typed rows, progress, resume, and confirmation without autoplay", () => {
    const opened: string[] = [];
    const nodes = descendants(
      HistoryView({
        model: composeWatchHistoryView({ items: [video], query: "" }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: (item) => opened.push(item.id),
        onRemove: () => undefined,
        onReplay: (item) => opened.push(`replay:${item.id}`),
        onResume: (item) => opened.push(`resume:${item.id}`),
        onRetry: () => undefined,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "screen-history")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "history-progress-twitch-video-vod-1"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.accessibilityLabel === "Resume Yesterday"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.accessibilityLabel === "Replay Yesterday"),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "history-thumbnail-twitch-video-vod-1" &&
          node.props.source?.uri === "https://example.test/vod.png",
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "history-avatar-twitch-video-vod-1" &&
          node.props.source?.uri === "https://example.test/avatar.png",
      ),
    ).toBe(true);
    expect(opened).toEqual([]);
  });

  it("keeps empty, offline, and unavailable History distinct", () => {
    const empty = descendants(
      HistoryView({
        model: composeWatchHistoryView({ items: [], query: "" }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(empty.some((node) => node.props.testID === "history-empty")).toBe(
      true,
    );
    const offline = descendants(
      HistoryView({
        model: composeWatchHistoryView({
          items: [video],
          offline: true,
          query: "",
        }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(offline.some((node) => node.props.testID === "history-offline")).toBe(
      true,
    );
    const failed = descendants(
      HistoryView({
        model: composeWatchHistoryView({
          items: [],
          query: "",
          unavailable: true,
        }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(
      failed.some((node) => node.props.testID === "history-unavailable"),
    ).toBe(true);
    expect(failed.some((node) => node.props.testID === "history-retry")).toBe(
      true,
    );
  });

  it("asks before clearing or removing History", () => {
    const clear = descendants(
      HistoryView({
        model: composeWatchHistoryView({
          confirmation: { kind: "clear" },
          items: [video],
          query: "",
        }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(clear.some((node) => node.props.testID === "history-confirmation")).toBe(
      true,
    );
    expect(clear.some((node) => node.props.testID === "history-clear")).toBe(true);
    const remove = descendants(
      HistoryView({
        model: composeWatchHistoryView({
          confirmation: {
            id: video.id,
            kind: "remove",
            title: video.title,
          },
          items: [video],
          query: "",
        }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(
      remove.some((node) =>
        String(node.props.children).includes("Remove Yesterday from History?"),
      ),
    ).toBe(true);
    expect(
      remove.some((node) => node.props.testID === "history-remove-twitch-video-vod-1"),
    ).toBe(true);
  });
});
