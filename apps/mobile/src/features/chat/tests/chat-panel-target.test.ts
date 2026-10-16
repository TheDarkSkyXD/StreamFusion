// @vitest-environment jsdom

import { act, createElement, useImperativeHandle, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "../components/chat-panel";
import type {
  ChatCommands,
  ChatCommandResult,
  ChatEmote,
} from "../capabilities/chat-interactions";
import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatModeration,
} from "../capabilities/watch-chat";
import { createChatInteractions } from "../domain/chat-interactions";
import { defaultChatDisplaySettingsView } from "@mobile/features/settings/domain/chat-display-preferences";
import { selectUserChatMessages } from "../domain/select-user-chat-messages";
import type { ChatPresentation } from "../capabilities/chat-presentation";

vi.mock("lucide-react-native", () => ({
  AtSign: () => null,
  ArrowDown: () => createElement("svg", { "data-testid": "resume-arrow" }),
  ArrowRight: () => null,
  Ban: () => null,
  Copy: () => null,
  CornerUpLeft: () => null,
  ExternalLink: () => null,
  Flag: () => null,
  Shield: () => null,
  Smile: () => null,
  X: () => null,
}));

const scrollToOffset = vi.fn();
const scrollToHistory = vi.fn();
type LayoutEvent = {
  readonly nativeEvent: {
    readonly layout: { readonly y: number; readonly height: number };
  };
};
let selectedHistoryLayout: ((event: LayoutEvent) => void) | undefined;
let historyScrollEvents: {
  readonly onLayout?: (event: LayoutEvent) => void;
  readonly onContentSizeChange?: (width: number, height: number) => void;
} = {};
let nativeListEvents: {
  readonly maintainVisibleContentPosition?: {
    readonly minIndexForVisible: number;
  };
  readonly onScrollBeginDrag?: () => void;
  readonly onScrollEndDrag?: () => void;
  readonly onMomentumScrollBegin?: () => void;
  readonly onMomentumScrollEnd?: (event: {
    nativeEvent: { contentOffset: { y: number } };
  }) => void;
  readonly onScroll?: (event: {
    nativeEvent: { contentOffset: { y: number } };
  }) => void;
} = {};

let sheetGesture: {
  onMoveShouldSetPanResponder?: (
    event: unknown,
    gesture: { dx: number; dy: number; vy: number },
  ) => boolean;
  onPanResponderRelease?: (
    event: unknown,
    gesture: { dx: number; dy: number; vy: number },
  ) => void;
} = {};

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  type HostProps = {
    readonly visible?: boolean;
    readonly children?: ReactNode;
    readonly testID?: string;
    readonly accessibilityLabel?: string;
    readonly disabled?: boolean;
    readonly onPress?: () => void;
    readonly onRequestClose?: () => void;
    readonly source?: { readonly uri?: string };
    readonly style?: unknown;
    readonly onLayout?: (event: LayoutEvent) => void;
  };
  const host = (tag: string) => (props: HostProps) =>
    createElement(
      tag,
      {
        "data-testid": props.testID,
        "aria-label": props.accessibilityLabel,
        disabled: props.disabled,
        onClick: props.onPress,
        "data-source-uri": props.source?.uri,
        "data-style": JSON.stringify(props.style),
      },
      props.children,
    );
  return {
    Animated: {
      View: host("div"),
      Value: class {
        setValue() {}
        stopAnimation() {}
      },
      timing: () => ({
        start: (done?: (result: { finished: boolean }) => void) =>
          done?.({ finished: true }),
      }),
      spring: () => ({ start: () => undefined }),
    },
    PanResponder: {
      create: (handlers: typeof sheetGesture) => {
        sheetGesture = handlers;
        return { panHandlers: {} };
      },
    },
    requireNativeComponent: () => host("img"),
    ActivityIndicator: host("span"),
    Platform: { OS: "android" },
    Modal: (props: HostProps) =>
      props.visible
        ? createElement(
            "div",
            {
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key === "Escape") props.onRequestClose?.();
              },
            },
            props.children,
          )
        : null,
    KeyboardAvoidingView: host("div"),
    View: (props: HostProps) => {
      if (props.testID?.startsWith("chat-user-message-") && props.onLayout)
        selectedHistoryLayout = props.onLayout;
      return host("div")(props);
    },
    Text: host("span"),
    Pressable: (props: HostProps) =>
      host(props.onPress ? "button" : "div")(props),
    ScrollView: (
      props: HostProps & {
        readonly ref?: React.Ref<unknown>;
        readonly onContentSizeChange?: (width: number, height: number) => void;
      },
    ) => {
      if (props.testID === "chat-user-history-scroll")
        historyScrollEvents = props;
      useImperativeHandle(props.ref, () => ({ scrollTo: scrollToHistory }));
      return host("div")(props);
    },
    FlatList: (
      props: HostProps & {
        readonly onScrollBeginDrag?: () => void;
        readonly onScrollEndDrag?: () => void;
        readonly onMomentumScrollBegin?: () => void;
        readonly onMomentumScrollEnd?: (event: {
          nativeEvent: { contentOffset: { y: number } };
        }) => void;
        readonly ref?: React.Ref<unknown>;
        readonly onScroll?: (event: {
          nativeEvent: { contentOffset: { y: number } };
        }) => void;
        readonly maintainVisibleContentPosition?: {
          readonly minIndexForVisible: number;
        };
        readonly data: readonly WatchChatMessage[];
        readonly renderItem: (entry: { item: WatchChatMessage }) => ReactNode;
      },
    ) => {
      nativeListEvents = props;
      useImperativeHandle(props.ref, () => ({ scrollToOffset }));
      return createElement(
        "div",
        {
          "data-testid": props.testID,
          onMouseDown: props.onScrollBeginDrag,
          onScroll: (event: { currentTarget: HTMLDivElement }) =>
            props.onScroll?.({
              nativeEvent: {
                contentOffset: { y: event.currentTarget.scrollTop },
              },
            }),
        },
        props.data.map((item) =>
          createElement("div", { key: item.id }, props.renderItem({ item })),
        ),
      );
    },
    Image: host("img"),
    TextInput: (
      props: HostProps & {
        readonly value: string;
        readonly editable?: boolean;
        readonly onChangeText: (text: string) => void;
      },
    ) =>
      createElement("textarea", {
        "data-testid": props.testID,
        "aria-label": props.accessibilityLabel,
        value: props.value,
        disabled: props.editable === false,
        onInput: (event: { currentTarget: HTMLTextAreaElement }) =>
          props.onChangeText(event.currentTarget.value),
        onChange: () => undefined,
      }),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));

const channelA: WatchChatConnectInput = {
  channelId: "channel-a",
  channelName: "alpha",
  platform: "twitch",
};
const channelB: WatchChatConnectInput = {
  channelId: "channel-b",
  channelName: "beta",
  platform: "twitch",
};
const messageA: WatchChatMessage = {
  id: "alpha-message",
  displayName: "Alpha viewer",
  username: "alpha-viewer",
  text: "Alpha message",
  badges: [],
};

function renderPanel(
  commands: ChatCommands,
  emotes: readonly ChatEmote[] = [],
  quickEmotes = true,
  presentation?: ChatPresentation,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const interactions = createChatInteractions(
    commands,
    {
      read: async () => ({ emotes, failures: [] }),
    },
    {
      load: async () => ({
        ...defaultChatDisplaySettingsView(),
        preferences: {
          ...defaultChatDisplaySettingsView().preferences,
          quickEmotes,
        },
      }),
      peek: () => ({
        ...defaultChatDisplaySettingsView(),
        preferences: {
          ...defaultChatDisplaySettingsView().preferences,
          quickEmotes,
        },
      }),
      subscribe: () => () => undefined,
    },
  );
  const send = vi.spyOn(interactions, "send");
  const render = (
    target: WatchChatConnectInput,
    messages: readonly WatchChatMessage[] = [messageA],
    messageMetadataRevision = 0,
    mode: {
      readonly recorded?: boolean;
      readonly readOnly?: boolean;
      readonly moderationRevision?: number;
      readonly moderationEvents?: readonly WatchChatModeration[];
    } = {},
  ) => {
    const { moderationRevision, moderationEvents, ...panelMode } = mode;
    return act(async () => {
      root.render(
        createElement(ChatPanel, {
          chat: {
            kind: "live",
            detail: "Chat connected.",
            messages,
            messageMetadataRevision,
            ...(moderationRevision === undefined ? {} : { moderationRevision }),
            ...(moderationEvents === undefined ? {} : { moderationEvents }),
          },
          platform: target.platform,
          target,
          interactions,
          ...(presentation ? { presentation } : {}),
          ...panelMode,
        }),
      );
    });
  };
  const button = (selector: string) => {
    const element = container.querySelector(selector);
    if (!(element instanceof HTMLButtonElement))
      throw new Error(`Missing button ${selector}`);
    return element;
  };
  const input = (id: string) => {
    const element = container.querySelector(`[data-testid="${id}"]`);
    if (!(element instanceof HTMLTextAreaElement))
      throw new Error(`Missing input ${id}`);
    return element;
  };
  return {
    interactions,
    container,
    render,
    send,
    draft: () => input("chat-draft").value,
    sendDisabled: () => button('[data-testid="chat-send"]').disabled,
    buttonDisabled: (selector: string) => button(selector).disabled,
    press: (selector: string) => act(async () => button(selector).click()),
    type: (id: string, text: string) =>
      act(async () => {
        const element = input(id);
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    unmount: () => act(async () => root.unmount()),
  };
}

function chatCommands(send: ChatCommands["send"]): ChatCommands {
  return {
    access: async () => ({ allowed: true, detail: "Ready to chat." }),
    subscribe: () => () => undefined,
    send,
    userAction: async () => ({ kind: "completed" }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  scrollToOffset.mockClear();
  nativeListEvents = {};
  selectedHistoryLayout = undefined;
  historyScrollEvents = {};
  scrollToHistory.mockClear();
});

describe("chat panel target identity", () => {
  it("sends a Kick quick emote immediately while preserving the draft and reply", async () => {
    const delivery = vi.fn<ChatCommands["send"]>(async () => ({
      kind: "sent",
      messageId: "sent",
    }));
    const panel = renderPanel(chatCommands(delivery), [
      {
        provider: "kick",
        id: "42",
        name: "Smile",
        insertion: "[emote:42:Smile]",
        imageUrl: "https://files.kick.com/emotes/42/fullsize",
        isGlobal: true,
      },
    ]);
    try {
      await panel.render({ ...channelA, platform: "kick" });
      await panel.type("chat-draft", "Keep my draft");
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-reply"]');
      await panel.press('[aria-label="Send Smile"]');
      expect(delivery).toHaveBeenCalledExactlyOnceWith(
        { ...channelA, platform: "kick" },
        "[emote:42:Smile]",
        null,
        expect.any(AbortSignal),
      );
      expect(panel.draft()).toBe("Keep my draft");
      expect(panel.container.textContent).toContain(
        "Replying to Alpha viewer.",
      );
    } finally {
      await panel.unmount();
    }
  });

  it("disables quick sends while pending or blocked and hides the row when opted out or read-only", async () => {
    let finish: (result: ChatCommandResult) => void = () => undefined;
    const pending = new Promise<ChatCommandResult>((resolve) => {
      finish = resolve;
    });
    const delivery = vi.fn<ChatCommands["send"]>(() => pending);
    const emotes: ChatEmote[] = [
      {
        provider: "twitch",
        id: "25",
        name: "Kappa",
        insertion: "Kappa",
        imageUrl: "https://example.test/kappa",
        isGlobal: true,
      },
    ];
    const panel = renderPanel(chatCommands(delivery), emotes);
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Send Kappa"]');
      expect(panel.buttonDisabled('[aria-label="Send Kappa"]')).toBe(true);
      await panel.press('[aria-label="Send Kappa"]');
      expect(delivery).toHaveBeenCalledTimes(1);
      await act(async () => finish({ kind: "sent", messageId: "sent" }));
    } finally {
      await panel.unmount();
    }
    const hidden = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      emotes,
      false,
    );
    try {
      await hidden.render(channelA);
      expect(
        hidden.container.querySelector('[aria-label="Send Kappa"]'),
      ).toBeNull();
    } finally {
      await hidden.unmount();
    }
    const readOnly = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      emotes,
    );
    try {
      await readOnly.render(channelA, [messageA], 0, { readOnly: true });
      expect(
        readOnly.container.querySelector('[aria-label="Send Kappa"]'),
      ).toBeNull();
      await readOnly.render(channelA, [messageA], 0, { recorded: true });
      expect(
        readOnly.container.querySelector('[aria-label="Send Kappa"]'),
      ).toBeNull();
    } finally {
      await readOnly.unmount();
    }
    const blocked = renderPanel(
      {
        ...chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
        access: async () => ({ allowed: false, detail: "Sign in" }),
      },
      emotes,
    );
    try {
      await blocked.render(channelA);
      expect(blocked.buttonDisabled('[aria-label="Send Kappa"]')).toBe(true);
    } finally {
      await blocked.unmount();
    }
  });

  it("keeps the composer on a failed quick send and ignores a late result after changing channels", async () => {
    let finish: (result: ChatCommandResult) => void = () => undefined;
    const delivery = vi
      .fn<ChatCommands["send"]>()
      .mockResolvedValueOnce({ kind: "failed", detail: "Slow mode." })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const panel = renderPanel(chatCommands(delivery), [
      {
        provider: "twitch",
        id: "25",
        name: "Kappa",
        insertion: "Kappa",
        imageUrl: "https://example.test/kappa",
        isGlobal: true,
      },
    ]);
    try {
      await panel.render(channelA);
      await panel.type("chat-draft", "Keep this");
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-reply"]');
      await panel.press('[aria-label="Send Kappa"]');
      expect(panel.draft()).toBe("Keep this");
      expect(panel.container.textContent).toContain(
        "Replying to Alpha viewer.",
      );
      expect(panel.container.textContent).toContain("Slow mode.");
      await panel.press('[aria-label="Send Kappa"]');
      await panel.render(channelB);
      await act(async () => finish({ kind: "sent", messageId: "late" }));
      expect(panel.interactions.snapshot().recentEmotes).toEqual([]);
      expect(
        panel.container.querySelector('[data-testid="chat-send-notice"]'),
      ).toBeNull();
      expect(panel.draft()).toBe("");
    } finally {
      await panel.unmount();
    }
  });

  it("keeps full-picker selection as draft insertion and moves it into recent quick choices", async () => {
    const delivery = vi.fn<ChatCommands["send"]>(async () => ({
      kind: "sent",
      messageId: "sent",
    }));
    const panel = renderPanel(chatCommands(delivery), [
      {
        provider: "twitch",
        id: "25",
        name: "Kappa",
        insertion: "Kappa",
        imageUrl: "https://example.test/kappa",
        isGlobal: true,
      },
    ]);
    try {
      await panel.render(channelA);
      await panel.press('[data-testid="chat-emotes"]');
      await panel.press('[aria-label="Kappa (twitch)"]');
      expect(panel.draft()).toBe("Kappa ");
      expect(delivery).not.toHaveBeenCalled();
      expect(panel.interactions.snapshot().recentEmotes).toEqual([
        { provider: "twitch", id: "25" },
      ]);
    } finally {
      await panel.unmount();
    }
  });
  it("drops the previous channel composer and actions before sending to the next channel", async () => {
    const delivery = vi.fn<ChatCommands["send"]>(async () => ({
      kind: "sent",
      messageId: "beta-sent",
    }));
    const panel = renderPanel(chatCommands(delivery));
    try {
      await panel.render(channelA);
      await panel.type("chat-draft", "Alpha draft");
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-reply"]');
      await panel.press('[data-testid="chat-emotes"]');
      await panel.type("chat-emote-search", "Alpha emote");
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.render({ ...channelA });
      expect(panel.draft()).toBe("Alpha draft");
      expect(panel.container.textContent).toContain(
        "Replying to Alpha viewer.",
      );
      expect(panel.sendDisabled()).toBe(false);
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).not.toBeNull();
      expect(
        panel.container.querySelector('[data-testid="chat-emote-search"]'),
      ).toHaveProperty("value", "Alpha emote");

      await panel.render(channelB);
      expect(panel.draft()).toBe("");
      expect(panel.container.textContent).not.toContain(
        "Replying to Alpha viewer.",
      );
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
      expect(
        panel.container.querySelector('[data-testid="chat-emote-picker"]'),
      ).toBeNull();
      expect(panel.sendDisabled()).toBe(true);
      await panel.press('[data-testid="chat-send"]');
      expect(delivery).not.toHaveBeenCalled();

      await panel.press('[data-testid="chat-emotes"]');
      expect(
        panel.container.querySelector('[data-testid="chat-emote-search"]'),
      ).toHaveProperty("value", "");
      await panel.type("chat-draft", "Beta message");
      await panel.press('[data-testid="chat-send"]');
      expect(panel.send).toHaveBeenCalledExactlyOnceWith(
        "Beta message",
        undefined,
      );
      expect(delivery).toHaveBeenCalledExactlyOnceWith(
        channelB,
        "Beta message",
        null,
        expect.any(AbortSignal),
      );
      expect(panel.draft()).toBe("");
    } finally {
      await panel.unmount();
    }
  });

  it("keeps a new channel draft when the old channel send completes late", async () => {
    let completeOldSend: (result: ChatCommandResult) => void = () => {
      throw new Error("Old send has not started.");
    };
    const oldSend = new Promise<ChatCommandResult>((resolve) => {
      completeOldSend = resolve;
    });
    const delivery = vi
      .fn<ChatCommands["send"]>()
      .mockReturnValueOnce(oldSend)
      .mockResolvedValueOnce({ kind: "sent", messageId: "beta-sent" });
    const panel = renderPanel(chatCommands(delivery));
    try {
      await panel.render(channelA);
      await panel.type("chat-draft", "Pending draft");
      await panel.press('[data-testid="chat-send"]');
      expect(delivery).toHaveBeenCalledWith(
        channelA,
        "Pending draft",
        null,
        expect.any(AbortSignal),
      );
      await panel.render(channelB);
      await panel.type("chat-draft", "Pending draft");
      await act(async () =>
        completeOldSend({ kind: "sent", messageId: "alpha-sent" }),
      );
      expect(panel.draft()).toBe("Pending draft");
      expect(panel.sendDisabled()).toBe(false);
      expect(
        panel.container.querySelector('[data-testid="chat-send-notice"]'),
      ).toBeNull();
      await panel.press('[data-testid="chat-send"]');
      expect(delivery).toHaveBeenLastCalledWith(
        channelB,
        "Pending draft",
        null,
        expect.any(AbortSignal),
      );
      expect(panel.draft()).toBe("");
    } finally {
      await panel.unmount();
    }
  });
});

describe("chat reading position", () => {
  it("anchors visible rows only while the reader holds history, then releases the anchor on Resume", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      expect(nativeListEvents.maintainVisibleContentPosition).toBeUndefined();
      await act(async () => nativeListEvents.onScrollBeginDrag?.());
      expect(panel.buttonDisabled('[data-testid="chat-resume"]')).toBe(false);
      expect(
        panel.container
          .querySelector('[data-testid="chat-resume"]')
          ?.getAttribute("aria-label"),
      ).toBe("Resume live chat");
      expect(panel.container.textContent).toContain(
        "Chat paused due to scroll",
      );
      expect(
        panel.container
          .querySelector('[data-testid="chat-resume"] span')
          ?.getAttribute("data-style"),
      ).toContain("#ffffff");
      expect(
        panel.container.querySelector('[data-testid="resume-arrow"]'),
      ).not.toBeNull();
      expect(nativeListEvents.maintainVisibleContentPosition).toEqual({
        minIndexForVisible: 0,
      });
      await panel.render(channelA, [
        { ...messageA, id: "new", text: "New arrival" },
        messageA,
      ]);
      expect(nativeListEvents.maintainVisibleContentPosition).toEqual({
        minIndexForVisible: 0,
      });
      await panel.press('[data-testid="chat-resume"]');
      expect(nativeListEvents.maintainVisibleContentPosition).toBeUndefined();
    } finally {
      await panel.unmount();
    }
  });

  it("pauses a short fling whose first away-from-bottom offset arrives after drag end", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      await act(async () => {
        nativeListEvents.onScrollBeginDrag?.();
        nativeListEvents.onScrollEndDrag?.();
        nativeListEvents.onMomentumScrollBegin?.();
        nativeListEvents.onScroll?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
        nativeListEvents.onMomentumScrollEnd?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
      });
      expect(
        panel.container.querySelector('[data-testid="chat-resume"]'),
      ).not.toBeNull();
      await panel.render(channelA, [
        { ...messageA, id: "new", text: "New arrival" },
      ]);
      expect(panel.container.textContent).toContain("Alpha message");
      expect(panel.container.textContent).not.toContain("New arrival");
    } finally {
      await panel.unmount();
    }
  });

  it("keeps ownership when momentum starts after the first frame following drag end", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA);
      await act(async () => {
        nativeListEvents.onScrollBeginDrag?.();
        nativeListEvents.onScrollEndDrag?.();
        await new Promise((resolve) => setTimeout(resolve, 18));
        nativeListEvents.onMomentumScrollBegin?.();
        nativeListEvents.onScroll?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
        nativeListEvents.onMomentumScrollEnd?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
      });
      expect(
        panel.container.querySelector('[data-testid="chat-resume"]'),
      ).not.toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("keeps history paused when a fling reports its first offset after coast cleanup", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA);
      await act(async () => {
        nativeListEvents.onScrollBeginDrag?.();
        nativeListEvents.onScrollEndDrag?.();
        await new Promise((resolve) => setTimeout(resolve, 55));
        nativeListEvents.onMomentumScrollBegin?.();
        nativeListEvents.onScroll?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
        nativeListEvents.onMomentumScrollEnd?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
      });
      expect(
        panel.container.querySelector('[data-testid="chat-resume"]'),
      ).not.toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("keeps the first pending follow frame through a burst of new arrivals", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA);
      const firstFrame = nextFrame;
      await panel.render(channelA, [{ ...messageA, id: "next-1" }]);
      await panel.render(channelA, [{ ...messageA, id: "next-2" }]);
      expect(frames.has(firstFrame)).toBe(true);
      await act(async () => frames.get(firstFrame)?.(0));
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 0,
        animated: false,
      });
    } finally {
      await panel.unmount();
    }
  });

  it("follows committed arrivals and equal-height rollover while reading at the bottom", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      scrollToOffset.mockClear();
      await panel.render(channelA, [
        { ...messageA, id: "next", text: "Next message" },
      ]);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 0,
        animated: false,
      });
    } finally {
      await panel.unmount();
    }
  });

  it("keeps a reader pause through programmatic zero-offset events and sheet dismissal", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      await act(async () => {
        nativeListEvents.onScrollBeginDrag?.();
        nativeListEvents.onScroll?.({
          nativeEvent: { contentOffset: { y: 160 } },
        });
        nativeListEvents.onScrollEndDrag?.();
      });
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      const sheet = panel.container.querySelector(
        '[data-testid="chat-user-actions"]',
      );
      if (!sheet) throw new Error("Missing user sheet");
      await act(async () =>
        sheet.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await act(async () =>
        nativeListEvents.onScroll?.({
          nativeEvent: { contentOffset: { y: 0 } },
        }),
      );
      expect(
        panel.container.querySelector('[data-testid="chat-resume"]'),
      ).not.toBeNull();
      await panel.render(channelA, [
        { ...messageA, id: "new", text: "New arrival" },
      ]);
      expect(panel.container.textContent).not.toContain("New arrival");
    } finally {
      await panel.unmount();
    }
  });

  it.each(["paused", "picker"])(
    "updates late badges in %s rows while preserving older rows and reading position",
    async (mode) => {
      const panel = renderPanel(
        chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      );
      const older = { ...messageA, id: "aged-out", text: "Older reading row" };
      const subscriber = {
        ...messageA,
        badges: [
          {
            setId: "subscriber",
            version: "12",
            imageUrl: "",
            title: "subscriber",
          },
        ],
      };
      const hydrated = {
        ...subscriber,
        badges: [
          {
            setId: "subscriber",
            version: "12",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/channel/3",
            title: "1-Year Subscriber",
          },
        ],
      };
      try {
        await panel.render(channelA, [older, subscriber]);
        if (mode === "paused") {
          const scroller = panel.container.querySelector(
            '[data-testid="watch-chat-scroll"]',
          );
          if (!(scroller instanceof HTMLDivElement))
            throw new Error("Missing chat list");
          await act(async () => {
            scroller.dispatchEvent(
              new MouseEvent("mousedown", { bubbles: true }),
            );
            scroller.scrollTop = 160;
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          });
        } else {
          await panel.press('[data-testid="chat-emotes"]');
        }
        await panel.press('[aria-label="Actions for Alpha viewer"]');
        const newest = { ...messageA, id: "newest", text: "New arrival" };
        await panel.render(channelA, [hydrated, newest], 1);
        expect(
          panel.container.querySelector(
            '[data-testid="watch-chat-badge-alpha-message-subscriber"]',
          ),
        ).toHaveProperty("ariaLabel", "1-Year Subscriber");
        expect(panel.container.textContent).toContain("Older reading row");
        expect(panel.container.textContent).not.toContain("New arrival");
        expect(
          panel.container.querySelector('[data-testid="chat-user-actions"]'),
        ).not.toBeNull();
        expect(
          panel.container.querySelector(
            mode === "paused"
              ? '[data-testid="chat-resume"]'
              : '[data-testid="chat-emote-picker"]',
          ),
        ).not.toBeNull();
      } finally {
        await panel.unmount();
      }
    },
  );

  it("reconciles paused rows and closes selected actions when a room is cleared", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (
      messages: readonly WatchChatMessage[],
      moderationRevision: number,
    ) =>
      act(async () =>
        root.render(
          createElement(ChatPanel, {
            platform: "twitch",
            target: channelA,
            chat: {
              kind: "live",
              detail: "Chat live.",
              messages,
              moderationRevision,
            },
          }),
        ),
      );
    try {
      await render([messageA], 0);
      const scroller = container.querySelector(
        '[data-testid="watch-chat-scroll"]',
      );
      if (!(scroller instanceof HTMLDivElement))
        throw new Error("Missing chat list");
      await act(async () => {
        scroller.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        scroller.scrollTop = 160;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const actions = container.querySelector(
        '[aria-label="Actions for Alpha viewer"]',
      );
      if (!(actions instanceof HTMLButtonElement))
        throw new Error("Missing user actions");
      await act(async () => actions.click());
      expect(
        container.querySelector('[data-testid="chat-user-actions"]'),
      ).not.toBeNull();
      await render([], 1);
      expect(container.textContent).not.toContain("Alpha message");
      expect(
        container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("clears paused recorded comments on seek and on media change", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (mediaId: string, connecting = false) =>
      act(async () =>
        root.render(
          createElement(ChatPanel, {
            platform: "twitch",
            target: { ...channelA, media: { id: mediaId, kind: "video" } },
            recorded: true,
            chat: connecting
              ? { kind: "connecting", detail: "Loading recorded comments." }
              : { kind: "live", detail: "Comments", messages: [messageA] },
          }),
        ),
      );
    const pause = async () => {
      const scroller = container.querySelector(
        '[data-testid="watch-chat-scroll"]',
      );
      if (!(scroller instanceof HTMLDivElement))
        throw new Error("Missing comments");
      await act(async () => {
        scroller.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        scroller.scrollTop = 160;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
    };
    try {
      await render("video-a");
      await pause();
      await render("video-a", true);
      expect(container.textContent).not.toContain("Alpha message");
      expect(container.querySelector('[data-testid="chat-resume"]')).toBeNull();
      await render("video-a");
      await pause();
      await render("video-b");
      expect(container.querySelector('[data-testid="chat-resume"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("holds older messages during arrivals, resumes, and clears the pause on channel change", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (
      target: WatchChatConnectInput,
      messages: readonly WatchChatMessage[],
    ) =>
      act(async () =>
        root.render(
          createElement(ChatPanel, {
            platform: target.platform,
            target,
            chat: { kind: "live", detail: "Chat live.", messages },
          }),
        ),
      );
    try {
      await render(channelA, [messageA]);
      const scroller = container.querySelector(
        `[data-testid="watch-chat-scroll"]`,
      );
      if (!(scroller instanceof HTMLDivElement))
        throw new Error("Missing chat list.");
      await act(async () => {
        scroller.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        scroller.scrollTop = 160;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const next = { ...messageA, id: "latest", text: "Newest message" };
      await render(channelA, [next]);
      expect(container.textContent).toContain("Alpha message");
      expect(container.textContent).not.toContain("Newest message");
      const resume = container.querySelector(`[data-testid="chat-resume"]`);
      if (!(resume instanceof HTMLButtonElement))
        throw new Error("Missing resume action.");
      await act(async () => resume.click());
      expect(container.textContent).toContain("Newest message");
      expect(container.querySelector(`[data-testid="chat-resume"]`)).toBeNull();
      await render(channelB, [messageA]);
      expect(container.querySelector(`[data-testid="chat-resume"]`)).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe("chat user sheet", () => {
  it("shows both copy destinations and disables chat insertion in read-only chat", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
      },
    );
    try {
      await panel.render(channelA, [messageA], 0, { readOnly: true });
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        panel.container.querySelector('[aria-label="Copy to clipboard"]'),
      ).not.toBeNull();
      const copyToChat = panel.container.querySelector<HTMLButtonElement>(
        '[data-testid="chat-copy-to-chat"]',
      );
      expect(copyToChat).not.toBeNull();
      expect(copyToChat?.disabled).toBe(true);
      const reply = panel.container.querySelector<HTMLButtonElement>(
        '[data-testid="chat-reply"]',
      );
      expect(reply).not.toBeNull();
      expect(reply?.disabled).toBe(true);
    } finally {
      await panel.unmount();
    }
  });

  it("uses the selected user's banner behind the profile header", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
        readChannel: async () => ({
          id: "user-a",
          username: "alpha-viewer",
          displayName: "Alpha viewer",
          avatarUrl: "",
          bannerUrl: "https://example.test/banner.png",
        }),
      },
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        panel.container
          .querySelector('[data-testid="chat-user-banner"]')
          ?.getAttribute("data-source-uri"),
      ).toBe("https://example.test/banner.png");
    } finally {
      await panel.unmount();
    }
  });

  it("shows copy feedback above the profile and clears it five seconds after the latest copy", async () => {
    vi.useFakeTimers();
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      { copyText: async () => undefined },
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-copy-message"]');
      const notice = panel.container.querySelector(
        '[data-testid="chat-copy-notice"]',
      );
      const avatar = panel.container.querySelector(
        '[data-testid="chat-user-avatar"]',
      );
      expect(notice?.textContent).toBe("Message copied.");
      expect(avatar && notice?.compareDocumentPosition(avatar)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      await panel.press('[data-testid="chat-copy-message"]');
      await act(async () => {
        vi.advanceTimersByTime(4999);
      });
      expect(
        panel.container.querySelector('[data-testid="chat-copy-notice"]'),
      ).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(
        panel.container.querySelector('[data-testid="chat-copy-notice"]'),
      ).toBeNull();
    } finally {
      await panel.unmount();
      vi.useRealTimers();
    }
  });

  it("opens overflowing history with the selected row visible once", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    const messages = Array.from({ length: 12 }, (_, index) => ({
      ...messageA,
      id: `message-${index}`,
      text: `Message ${index}`,
    }));
    try {
      await panel.render(channelA, messages);
      await panel.press(
        '[data-testid="watch-chat-row-message-11"] [aria-label="Actions for Alpha viewer"]',
      );
      await act(async () => {
        historyScrollEvents.onLayout?.({
          nativeEvent: { layout: { y: 0, height: 200 } },
        });
        selectedHistoryLayout?.({
          nativeEvent: { layout: { y: 300, height: 30 } },
        });
        historyScrollEvents.onContentSizeChange?.(300, 400);
      });
      expect(scrollToHistory).toHaveBeenCalledExactlyOnceWith({
        y: 130,
        animated: false,
      });
      await panel.press(
        '[data-testid="chat-user-message-message-10"] [data-testid="watch-chat-message-message-10"]',
      );
      await act(async () => {
        selectedHistoryLayout?.({
          nativeEvent: { layout: { y: 270, height: 30 } },
        });
        historyScrollEvents.onContentSizeChange?.(300, 410);
      });
      expect(scrollToHistory).toHaveBeenCalledTimes(1);
    } finally {
      await panel.unmount();
    }
  });

  it("starts a selected row taller than the history viewport at its username", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    const messages = Array.from({ length: 12 }, (_, index) => ({
      ...messageA,
      id: `message-${index}`,
      text: `Message ${index}`,
    }));
    try {
      await panel.render(channelA, messages);
      await panel.press(
        '[data-testid="watch-chat-row-message-11"] [aria-label="Actions for Alpha viewer"]',
      );
      await act(async () => {
        historyScrollEvents.onLayout?.({
          nativeEvent: { layout: { y: 0, height: 200 } },
        });
        selectedHistoryLayout?.({
          nativeEvent: { layout: { y: 300, height: 250 } },
        });
        historyScrollEvents.onContentSizeChange?.(300, 700);
      });
      expect(scrollToHistory).toHaveBeenCalledExactlyOnceWith({
        y: 300,
        animated: false,
      });
    } finally {
      await panel.unmount();
    }
  });

  it("shows one profile heading without Close and dismisses from the backdrop", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      const sheet = panel.container.querySelector(
        '[aria-label="Alpha viewer"]',
      );
      if (!sheet) throw new Error("Missing user sheet.");
      expect(
        sheet.querySelectorAll('[data-testid="chat-user-avatar"]'),
      ).toHaveLength(1);
      const closeButtons = [...sheet.querySelectorAll("button")].filter(
        (element) => element.textContent === "Close",
      );
      expect(closeButtons).toHaveLength(0);
      await panel.press('[aria-label="Dismiss Alpha viewer"]');
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("dismisses on a downward header drag but keeps the sheet for small or sideways gestures", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        sheetGesture.onMoveShouldSetPanResponder?.(undefined, {
          dx: 100,
          dy: 10,
          vy: 0,
        }),
      ).toBe(false);
      expect(
        sheetGesture.onMoveShouldSetPanResponder?.(undefined, {
          dx: 0,
          dy: -100,
          vy: 0,
        }),
      ).toBe(false);
      expect(
        sheetGesture.onMoveShouldSetPanResponder?.(undefined, {
          dx: 0,
          dy: 30,
          vy: 0,
        }),
      ).toBe(true);
      await act(async () => {
        sheetGesture.onPanResponderRelease?.(undefined, {
          dx: 0,
          dy: 30,
          vy: 0,
        });
      });
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).not.toBeNull();
      await act(async () => {
        sheetGesture.onPanResponderRelease?.(undefined, {
          dx: 0,
          dy: 140,
          vy: 0,
        });
      });
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("renders badges, sender names, and emotes in history, then copies the selected row", async () => {
    const copyText = vi.fn(async () => undefined);
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [
        {
          provider: "twitch",
          id: "25",
          name: "Kappa",
          insertion: "Kappa",
          imageUrl: "https://example.test/kappa",
          isGlobal: true,
        },
      ],
      true,
      { copyText, readChannel: async () => null, viewChannel: () => undefined },
    );
    const other = {
      ...messageA,
      id: "second",
      text: "Kappa",
      badges: [
        {
          setId: "subscriber",
          version: "1",
          imageUrl: "https://example.test/badge",
          title: "Subscriber",
        },
      ],
    };
    try {
      await panel.render(channelA, [messageA, other]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      const history = panel.container.querySelector(
        '[data-testid="chat-user-message-second"]',
      );
      expect(history?.textContent).toContain("Alpha viewer");
      expect(
        history?.querySelector(
          '[data-testid="watch-chat-badge-second-subscriber"]',
        ),
      ).not.toBeNull();
      expect(history?.querySelector('[aria-label="Kappa"]')).not.toBeNull();
      await panel.press(
        '[data-testid="chat-user-message-second"] [data-testid="watch-chat-message-second"]',
      );
      await panel.press('[data-testid="chat-copy-message"]');
      expect(copyText).toHaveBeenCalledWith("Kappa");
    } finally {
      await panel.unmount();
    }
  });

  it("keeps an evicted selection through unrelated moderation but closes it for its own deletion", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.render(
        channelA,
        [{ ...messageA, id: "new", text: "New arrival" }],
        0,
        {
          moderationRevision: 1,
          moderationEvents: [
            {
              revision: 1,
              event: { kind: "delete", messageId: "someone-else", at: 1 },
            },
          ],
        },
      );
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).not.toBeNull();
      expect(panel.container.textContent).toContain("Alpha message");
      await panel.render(
        channelA,
        [{ ...messageA, id: "new", text: "New arrival" }],
        0,
        {
          moderationRevision: 2,
          moderationEvents: [
            {
              revision: 1,
              event: { kind: "delete", messageId: "someone-else", at: 1 },
            },
            {
              revision: 2,
              event: { kind: "delete", messageId: messageA.id, at: 2 },
            },
          ],
        },
      );
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("applies batched user moderation to an evicted selected message", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
    );
    try {
      await panel.render(channelA, [messageA]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.render(
        channelA,
        [{ ...messageA, id: "new", text: "New arrival" }],
        0,
        {
          moderationRevision: 2,
          moderationEvents: [
            {
              revision: 1,
              event: { kind: "delete", messageId: "other", at: 1 },
            },
            {
              revision: 2,
              event: {
                kind: "clear-user",
                username: "alpha-viewer",
                at: 2,
              },
            },
          ],
        },
      );
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("uses a matching Kick login when chat and discovery IDs differ", async () => {
    const viewChannel = vi.fn();
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
        readChannel: async () => ({
          id: "channel-42",
          username: "alpha-viewer",
          displayName: "Alpha viewer",
          avatarUrl: "https://example.test/avatar.png",
          isLive: true,
          isPartner: true,
          isVerified: true,
        }),
        viewChannel,
      },
    );
    try {
      await panel.render({ ...channelA, platform: "kick" }, [
        {
          ...messageA,
          userId: "chat-99",
          badges: [
            {
              setId: "moderator",
              version: "1",
              imageUrl: "https://example.test/badge.png",
              title: "Moderator",
            },
          ],
        },
      ]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        panel.container.querySelector('[data-testid="chat-view-channel"]'),
      ).not.toBeNull();
      expect(
        panel.container.querySelector('[data-testid="chat-user-avatar"]'),
      ).not.toBeNull();
      expect(
        panel.container.querySelector(
          '[data-source-uri="https://example.test/avatar.png"]',
        ),
      ).not.toBeNull();
      expect(
        panel.container
          .querySelector('[data-testid="chat-user-avatar"]')
          ?.getAttribute("data-style"),
      ).toContain("#53fc18");
      expect(
        panel.container.querySelector(
          '[data-testid="chat-user-badge-moderator"]',
        ),
      ).not.toBeNull();
      expect(
        panel.container.querySelector('[data-testid="chat-user-partner"]'),
      ).not.toBeNull();
      expect(panel.container.textContent).not.toContain("@alpha-viewer");
      await panel.press('[data-testid="chat-view-channel"]');
      expect(viewChannel).toHaveBeenCalledWith({
        platform: "kick",
        id: "channel-42",
        username: "alpha-viewer",
      });
    } finally {
      await panel.unmount();
    }
  });

  it("shows a partner mark when the official badge has no image yet", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
        readChannel: async () => ({
          id: "channel-42",
          username: "alpha-viewer",
          displayName: "Alpha viewer",
          avatarUrl: "",
          isLive: false,
          isPartner: true,
          isVerified: true,
        }),
        viewChannel: () => undefined,
      },
    );
    try {
      await panel.render({ ...channelA, platform: "kick" }, [
        {
          ...messageA,
          userId: "chat-99",
          badges: [
            { setId: "partner", version: "1", imageUrl: "", title: "Partner" },
          ],
        },
      ]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        panel.container.querySelector('[data-testid="chat-user-partner"]'),
      ).not.toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it("rejects a Kick lookup whose login differs from the selected sender", async () => {
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
        readChannel: async () => ({
          id: "chat-99",
          username: "someone-else",
          displayName: "Someone else",
          avatarUrl: "https://example.test/other.png",
          isLive: true,
          isPartner: true,
          isVerified: true,
        }),
        viewChannel: () => undefined,
      },
    );
    try {
      await panel.render({ ...channelA, platform: "kick" }, [
        { ...messageA, userId: "chat-99" },
      ]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(
        panel.container.querySelector('[data-testid="chat-view-channel"]'),
      ).toBeNull();
      expect(
        panel.container.querySelector(
          '[data-source-uri="https://example.test/other.png"]',
        ),
      ).toBeNull();
      expect(panel.container.textContent).toContain(
        "Channel details unavailable",
      );
    } finally {
      await panel.unmount();
    }
  });
  it("groups recent messages by stable identity and retains an evicted selection", () => {
    const selected = { ...messageA, userId: "user-a", id: "selected" };
    const same = {
      ...messageA,
      userId: "user-a",
      id: "same",
      username: "renamed",
    };
    const other = { ...messageA, userId: "user-b", id: "other" };
    expect(selectUserChatMessages(selected, [same, other])).toEqual([
      selected,
      same,
    ]);
  });

  it("copies the selected visible message and inserts it into the draft without sending", async () => {
    const delivery = vi.fn<ChatCommands["send"]>(async () => ({
      kind: "sent",
      messageId: "sent",
    }));
    const copyText = vi.fn(async () => undefined);
    const panel = renderPanel(chatCommands(delivery), [], true, {
      copyText,
      readChannel: async () => null,
      viewChannel: () => undefined,
    });
    try {
      await panel.render(channelA);
      await panel.type("chat-draft", "Existing");
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-copy-message"]');
      expect(copyText).toHaveBeenCalledWith("Alpha message");
      await panel.press('[data-testid="chat-copy-to-chat"]');
      expect(panel.draft()).toBe("Existing Alpha message");
      expect(delivery).not.toHaveBeenCalled();
    } finally {
      await panel.unmount();
    }
  });

  it("keeps local history and clipboard when profile lookup fails", async () => {
    const copyText = vi.fn(async () => undefined);
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText,
        readChannel: async () => {
          throw new Error("Offline");
        },
        viewChannel: () => undefined,
      },
    );
    try {
      await panel.render(channelA, [
        messageA,
        { ...messageA, id: "second", text: "Second message" },
      ]);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      expect(panel.container.textContent).toContain("Second message");
      expect(panel.container.textContent).toContain(
        "Channel details unavailable",
      );
      await panel.press(
        '[data-testid="chat-user-message-alpha-message"] [data-testid="watch-chat-message-alpha-message"]',
      );
      await panel.press('[data-testid="chat-copy-message"]');
      expect(copyText).toHaveBeenCalledWith("Alpha message");
    } finally {
      await panel.unmount();
    }
  });

  it("navigates only with the verified channel returned by discovery", async () => {
    const viewChannel = vi.fn();
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText: async () => undefined,
        readChannel: async () => ({
          id: "verified-id",
          username: "alpha-viewer",
          displayName: "Verified",
          avatarUrl: "https://example.test/avatar",
        }),
        viewChannel,
      },
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.press('[data-testid="chat-view-channel"]');
      expect(viewChannel).toHaveBeenCalledWith({
        platform: "twitch",
        id: "verified-id",
        username: "alpha-viewer",
      });
    } finally {
      await panel.unmount();
    }
  });

  it("closes a selected message after deletion so clipboard cannot expose its old text", async () => {
    const copyText = vi.fn(async () => undefined);
    const panel = renderPanel(
      chatCommands(async () => ({ kind: "sent", messageId: "sent" })),
      [],
      true,
      {
        copyText,
        readChannel: async () => null,
        viewChannel: () => undefined,
      },
    );
    try {
      await panel.render(channelA);
      await panel.press('[aria-label="Actions for Alpha viewer"]');
      await panel.render(channelA, [{ ...messageA, deletedAt: 123 }], 0, {
        moderationRevision: 1,
      });
      expect(
        panel.container.querySelector('[data-testid="chat-user-actions"]'),
      ).toBeNull();
      expect(
        panel.container.querySelector('[data-testid="chat-copy-message"]'),
      ).toBeNull();
      expect(copyText).not.toHaveBeenCalled();
    } finally {
      await panel.unmount();
    }
  });
});
