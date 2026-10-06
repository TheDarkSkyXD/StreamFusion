// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "../components/chat-panel";
import type {
  ChatCommands,
  ChatCommandResult,
} from "../capabilities/chat-interactions";
import type {
  WatchChatConnectInput,
  WatchChatMessage,
} from "../capabilities/watch-chat";
import { createChatInteractions } from "../domain/chat-interactions";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  type HostProps = {
    readonly visible?: boolean;
    readonly children?: ReactNode;
    readonly testID?: string;
    readonly accessibilityLabel?: string;
    readonly disabled?: boolean;
    readonly onPress?: () => void;
  };
  const host = (tag: string) => (props: HostProps) =>
    createElement(
      tag,
      {
        "data-testid": props.testID,
        "aria-label": props.accessibilityLabel,
        disabled: props.disabled,
        onClick: props.onPress,
      },
      props.children,
    );
  return {
    Platform: { OS: "android" },
    Modal: (props: HostProps) => (props.visible ? host("div")(props) : null),
    KeyboardAvoidingView: host("div"),
    View: host("div"),
    Text: host("span"),
    Pressable: (props: HostProps) =>
      host(props.onPress ? "button" : "div")(props),
    ScrollView: host("div"),
    FlatList: (
      props: HostProps & {
        readonly onScrollBeginDrag?: () => void;
        readonly onScroll?: (event: {
          nativeEvent: { contentOffset: { y: number } };
        }) => void;
        readonly data: readonly WatchChatMessage[];
        readonly renderItem: (entry: { item: WatchChatMessage }) => ReactNode;
      },
    ) =>
      createElement(
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
      ),
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

function renderPanel(commands: ChatCommands) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const interactions = createChatInteractions(commands, {
    read: async () => ({ emotes: [], failures: [] }),
  });
  const send = vi.spyOn(interactions, "send");
  const render = (
    target: WatchChatConnectInput,
    messages: readonly WatchChatMessage[] = [messageA],
    messageMetadataRevision = 0,
  ) =>
    act(async () => {
      root.render(
        createElement(ChatPanel, {
          chat: {
            kind: "live",
            detail: "Chat connected.",
            messages,
            messageMetadataRevision,
          },
          platform: target.platform,
          target,
          interactions,
        }),
      );
    });
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
    container,
    render,
    send,
    draft: () => input("chat-draft").value,
    sendDisabled: () => button('[data-testid="chat-send"]').disabled,
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

afterEach(() => vi.unstubAllGlobals());

describe("chat panel target identity", () => {
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
