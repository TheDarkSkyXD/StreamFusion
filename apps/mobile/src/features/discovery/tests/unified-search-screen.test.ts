import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PROOF_SOURCE } from "../components/search-proof-controls";
import { UnifiedSearchView } from "../components/unified-search-screen";
import {
  fixtureSearchIntent,
  fixtureSearchOutcome,
} from "../domain/search-fixture";
import { emptySearchHistory } from "../domain/search-history";
import { composeUnifiedSearch } from "../domain/unified-search";

vi.mock("react-native", () => ({
  Image: "Image",
  KeyboardAvoidingView: "KeyboardAvoidingView",
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
  twitch = fixtureSearchOutcome("twitch", "ready"),
  kick = fixtureSearchOutcome("kick", "ready"),
  extras: {
    readonly confirmClear?: boolean;
    readonly history?: readonly string[];
    readonly loading?: boolean;
    readonly resultType?: "all" | "videos";
  } = {},
) {
  const retried: string[] = [];
  const repeated: string[] = [];
  const root = UnifiedSearchView({
    draft: "arcade",
    liveOnly: false,
    onCancelClear: () => undefined,
    onChangeDraft: () => undefined,
    onClearDraft: () => undefined,
    onConfirmClear: () => undefined,
    onOpenAccounts: () => undefined,
    onRemoveHistory: () => undefined,
    onRepeatHistory: (query) => {
      repeated.push(query);
    },
    onRequestClear: () => undefined,
    onRetry: (platform) => {
      retried.push(platform);
    },
    onSelectPlatform: () => undefined,
    onSelectTab: () => undefined,
    onSubmit: () => undefined,
    onToggleLiveOnly: () => undefined,
    platform: "all",
    tab: extras.resultType ?? "all",
    view: composeUnifiedSearch({
      history: {
        ...emptySearchHistory(),
        channels: extras.history ?? ["arcade"],
      },
      historyConfirmClear: extras.confirmClear === true,
      intent: {
        ...fixtureSearchIntent("arcade"),
        resultType: extras.resultType ?? "all",
      },
      kick,
      loading: extras.loading === true,
      twitch,
    }),
  });
  return { nodes: descendants(root), repeated, retried };
}

describe("Unified search screen", () => {
  it("renders All-tab videos, clips, and the D06 proof token", () => {
    const root = UnifiedSearchView({
      draft: "arcade",
      liveOnly: false,
      onCancelClear: () => undefined,
      onChangeDraft: () => undefined,
      onClearDraft: () => undefined,
      onConfirmClear: () => undefined,
      onOpenAccounts: () => undefined,
      onRemoveHistory: () => undefined,
      onRepeatHistory: () => undefined,
      onRequestClear: () => undefined,
      onRetry: () => undefined,
      onSelectPlatform: () => undefined,
      onSelectProofMode: () => undefined,
      onSelectTab: () => undefined,
      onSubmit: () => undefined,
      onToggleLiveOnly: () => undefined,
      platform: "all",
      proofMode: "ready",
      tab: "all",
      view: composeUnifiedSearch({
        history: emptySearchHistory(),
        intent: fixtureSearchIntent("arcade"),
        kick: fixtureSearchOutcome("kick", "ready"),
        loading: false,
        twitch: fixtureSearchOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    expect(
      nodes.some((node) => node.props.testID === "search-video-twitch-twitch-video"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "search-clip-kick-kick-clip"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.children === SEARCH_PROOF_SOURCE),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "search-proof-source"),
    ).toBe(true);
  });

  it("repeats local history and confirms clear", () => {
    const { nodes, repeated } = render(undefined, undefined, {
      history: ["arcade"],
    });
    const repeat = nodes.find(
      (node) => node.props.testID === "repeat-search-arcade",
    );
    repeat?.props.onPress?.();
    expect(repeated).toEqual(["arcade"]);

    const confirm = render(undefined, undefined, { confirmClear: true });
    expect(
      confirm.nodes.some((node) => node.props.testID === "search-clear-confirm"),
    ).toBe(true);
  });

  it("retries only the failed platform and keeps signed-out search copy", () => {
    const { nodes, retried } = render(
      fixtureSearchOutcome("twitch", "twitch-fail"),
      fixtureSearchOutcome("kick", "ready"),
    );
    expect(nodes.some((node) => node.props.testID === "search-retry-twitch")).toBe(
      true,
    );
    const retry = nodes.find((node) => node.props.testID === "search-retry-twitch");
    retry?.props.onPress?.();
    expect(retried).toEqual(["twitch"]);
    const idle = UnifiedSearchView({
      draft: "",
      liveOnly: false,
      onCancelClear: () => undefined,
      onChangeDraft: () => undefined,
      onClearDraft: () => undefined,
      onConfirmClear: () => undefined,
      onOpenAccounts: () => undefined,
      onRemoveHistory: () => undefined,
      onRepeatHistory: () => undefined,
      onRequestClear: () => undefined,
      onRetry: () => undefined,
      onSelectPlatform: () => undefined,
      onSelectTab: () => undefined,
      onSubmit: () => undefined,
      onToggleLiveOnly: () => undefined,
      platform: "all",
      tab: "all",
      view: composeUnifiedSearch({
        history: emptySearchHistory(),
        intent: null,
        loading: false,
      }),
    });
    const phase = descendants(idle).find(
      (node) => node.props.testID === "search-phase",
    );
    expect(phase?.props.children).toMatch(/without signing in/);
  });

  it("shows cached age and guest-unavailable copy without requiring login", () => {
    const stale = render(
      fixtureSearchOutcome("twitch", "stale-cache"),
      fixtureSearchOutcome("kick", "stale-cache"),
    );
    expect(
      stale.nodes.some((node) => node.props.testID === "search-cache-age-twitch"),
    ).toBe(true);
    expect(stale.nodes.some((node) => node.props.testID === "search-login-twitch")).toBe(
      false,
    );
  });
});
