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
    View: host("div"),
    Text: host("span"),
    Pressable: (props: HostProps) =>
      host(props.onPress ? "button" : "div")(props),
    ScrollView: host("div"),
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
  const render = (target: WatchChatConnectInput) =>
    act(async () => {
      root.render(
        createElement(ChatPanel, {
          chat: {
            kind: "live",
            detail: "Chat connected.",
            messages: [messageA],
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
