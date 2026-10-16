// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type {
  MultistreamSession,
  MultistreamSnapshot,
  MultistreamTile,
} from "../capabilities/multistream";
import { MultistreamWorkspace } from "../components/multistream-workspace";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host =
    (tag: string) =>
    (props: { readonly children?: ReactNode; readonly testID?: string }) =>
      createElement(tag, { "data-testid": props.testID }, props.children);
  return {
    ScrollView: host("div"),
    Text: host("span"),
    View: host("div"),
    StyleSheet: { create: (styles: unknown) => styles },
    useWindowDimensions: () => ({ width: 390 }),
  };
});

vi.mock("lucide-react-native", () => ({
  Ellipsis: () => null,
  Plus: () => null,
  Volume2: () => null,
  VolumeX: () => null,
}));

vi.mock("@mobile/design/button", async () => {
  const { createElement } = await import("react");
  return {
    MobileButton: (props: {
      readonly accessibilityLabel: string;
      readonly children: ReactNode;
      readonly disabled?: boolean;
      readonly onPress: () => void;
      readonly testID: string;
    }) =>
      createElement(
        "button",
        {
          "aria-label": props.accessibilityLabel,
          "data-testid": props.testID,
          disabled: props.disabled,
          onClick: props.onPress,
        },
        props.children,
      ),
  };
});

vi.mock("@mobile/design/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    MobileIconButton: (props: {
      readonly label: string;
      readonly disabled?: boolean;
      readonly onPress: () => void;
    }) =>
      createElement("button", {
        "aria-label": props.label,
        disabled: props.disabled,
        onClick: props.onPress,
      }),
  };
});

vi.mock("@mobile/design/bottom-sheet", async () => {
  const { createElement } = await import("react");
  return {
    MobileBottomSheet: (props: {
      readonly children: ReactNode;
      readonly footer?: ReactNode;
      readonly title: string;
      readonly visible: boolean;
    }) =>
      props.visible
        ? createElement(
            "section",
            { "aria-label": props.title },
            props.children,
            props.footer,
          )
        : null,
  };
});

vi.mock("@mobile/design/text-input", async () => {
  const { createElement } = await import("react");
  return {
    MobileTextField: (props: {
      readonly onChange: (value: string) => void;
      readonly testID: string;
      readonly value: string;
    }) =>
      createElement("input", {
        "data-testid": props.testID,
        value: props.value,
        onInput: (event: { currentTarget: HTMLInputElement }) =>
          props.onChange(event.currentTarget.value),
        onChange: () => undefined,
      }),
  };
});

vi.mock("@mobile/design/choice-group", () => ({
  MobileChoiceGroup: () => null,
}));
vi.mock("@mobile/design/dialog", () => ({ MobileDialog: () => null }));
vi.mock("@mobile/design/list-row", () => ({ MobileListRow: () => null }));
vi.mock("@mobile/design/platform-badge", () => ({
  MobilePlatformBadge: () => null,
}));
vi.mock("@mobile/design/status-panel", async () => {
  const { createElement } = await import("react");
  return {
    MobileStatusPanel: (props: { readonly children: ReactNode }) =>
      createElement("div", null, props.children),
  };
});
vi.mock("@mobile/features/chat/components/chat-panel", () => ({
  ChatPanel: () => null,
}));

const tile: MultistreamTile = {
  id: "player-1",
  target: {
    platform: "twitch",
    channelId: "channel-1",
    channelName: "SondergaardLol",
  },
  state: "playing",
  detail: null,
};

function makeSession(initialTiles: readonly MultistreamTile[]) {
  let snapshot: MultistreamSnapshot = {
    tiles: initialTiles,
    audioOwner: null,
    busy: false,
    limit: 4,
    status: null,
    resourcePressure: { kind: "clear" },
  };
  const listeners = new Set<() => void>();
  const session: MultistreamSession = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async add() {
      snapshot =
        initialTiles.length > 0
          ? { ...snapshot, status: "That channel is already in the workspace." }
          : {
              ...snapshot,
              tiles: [tile],
              status: "Stream added muted. Choose Listen for its audio.",
            };
      for (const listener of listeners) listener();
    },
    clearAddFeedback() {
      snapshot = { ...snapshot, status: null };
    },
    focus: async () => undefined,
    mute: async () => undefined,
    remove: async () => undefined,
    move: () => undefined,
    pause: async () => undefined,
    recheckResources: async () => undefined,
    reduceToOne: async () => undefined,
    close: async () => undefined,
    dispose: async () => undefined,
  };
  return session;
}

async function renderWorkspace(session: MultistreamSession) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(MultistreamWorkspace, {
        session,
        PlayerSurface: () => null,
      }),
    ),
  );
  const button = (selector: string) => {
    const element = container.querySelector(selector);
    if (!(element instanceof HTMLButtonElement))
      throw new Error(`Missing button ${selector}`);
    return element;
  };
  const input = () => {
    const element = container.querySelector(
      '[data-testid="multistream-login"]',
    );
    if (!(element instanceof HTMLInputElement))
      throw new Error("Missing channel input");
    return element;
  };
  return {
    container,
    input,
    press: (selector: string) => act(async () => button(selector).click()),
    type: (value: string) =>
      act(async () => {
        const field = input();
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    unmount: () => act(async () => root.unmount()),
  };
}

describe("MultiView add sheet", () => {
  it("closes and clears the prefixed username after a new stream is added", async () => {
    const view = await renderWorkspace(makeSession([]));
    try {
      await view.press('[data-testid="multistream-add-first"]');
      await view.type("@SondergaardLol");
      await view.press('[data-testid="multistream-add"]');
      expect(
        view.container.querySelector('section[aria-label="Add stream"]'),
      ).toBeNull();
      expect(
        view.container.querySelector(
          '[data-testid="multistream-tile-player-1"]',
        ),
      ).not.toBeNull();
      await view.press('button[aria-label="Add stream"]');
      expect(view.input().value).toBe("");
    } finally {
      await view.unmount();
    }
  });

  it("keeps the sheet and username when the channel is already present", async () => {
    const view = await renderWorkspace(makeSession([tile]));
    try {
      await view.press('button[aria-label="Add stream"]');
      await view.type("SondergaardLol");
      await view.press('[data-testid="multistream-add"]');
      expect(view.input().value).toBe("SondergaardLol");
      expect(
        view.container.querySelector('section[aria-label="Add stream"]')
          ?.textContent,
      ).toContain("That channel is already in the workspace.");
    } finally {
      await view.unmount();
    }
  });
});
