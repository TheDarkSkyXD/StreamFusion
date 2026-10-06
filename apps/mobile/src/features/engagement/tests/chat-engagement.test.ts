// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type { ModerationChannel } from "@mobile/features/moderation/capabilities/moderation";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
import type { PredictionSettingsSession } from "@mobile/features/settings/capabilities/prediction-settings";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  composeChatDisplaySettingsView,
} from "@mobile/features/settings/domain/chat-display-preferences";
import { composePredictionSettingsView } from "@mobile/features/settings/domain/prediction-preferences";
import type { EngagementGateway } from "../capabilities/engagement";
import { ChatEngagementInline } from "../components/chat-engagement-inline";
import { createEngagementController } from "../domain/engagement-controller";

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children }: { children: unknown }) =>
    createElement("span", null, children),
  View: ({ children, testID }: { children: unknown; testID?: string }) =>
    createElement("div", { "data-testid": testID }, children),
}));
vi.mock("@mobile/design/button", () => ({
  MobileButton: ({
    children,
    onPress,
    testID,
  }: {
    children: unknown;
    onPress: () => void;
    testID: string;
  }) =>
    createElement(
      "button",
      { onClick: onPress, "data-testid": testID },
      children,
    ),
}));
vi.mock("@mobile/design/feedback", () => ({
  MobileProgress: ({ label, value }: { label: string; value: number }) =>
    createElement(
      "span",
      { "data-label": label },
      `${Math.round(value * 100)}%`,
    ),
}));

const channel: ModerationChannel = {
  platform: "twitch",
  id: "10",
  login: "owner",
  name: "Owner",
};

function settings() {
  let display = composeChatDisplaySettingsView(
    DEFAULT_CHAT_DISPLAY_PREFERENCES,
  );
  let prediction = composePredictionSettingsView({ style: "native" });
  const displayListeners = new Set<() => void>();
  const predictionListeners = new Set<() => void>();
  const displaySession: ChatDisplaySettingsSession = {
    peek: () => display,
    load: async () => display,
    snapshot: async () => display.preferences,
    subscribe(listener) {
      displayListeners.add(listener);
      return () => displayListeners.delete(listener);
    },
    async apply(patch) {
      display = composeChatDisplaySettingsView({
        ...display.preferences,
        ...patch,
      });
      displayListeners.forEach((listener) => listener());
      return display;
    },
  };
  const predictionSession: PredictionSettingsSession = {
    peek: () => prediction,
    load: async () => prediction,
    snapshot: async () => prediction.preferences,
    subscribe(listener) {
      predictionListeners.add(listener);
      return () => predictionListeners.delete(listener);
    },
    async apply(patch) {
      prediction = composePredictionSettingsView({
        ...prediction.preferences,
        ...patch,
      });
      predictionListeners.forEach((listener) => listener());
      return prediction;
    },
  };
  return { displaySession, predictionSession };
}

function runtime(userId: string) {
  const access: AuthenticatedPlatformAccess = {
    read: vi.fn(async () => ({
      kind: "ready" as const,
      platform: "twitch" as const,
      accessToken: "token",
      clientId: "client",
      userId,
      username: "owner",
      generation: 1,
      scopes: ["channel:read:polls", "channel:read:predictions"],
    })),
    subscribe: () => () => undefined,
  };
  const gateway: EngagementGateway = {
    polls: vi.fn(async () => ({
      kind: "success" as const,
      value: [
        {
          id: "poll",
          title: "Next game?",
          status: "ACTIVE" as const,
          choices: [
            { id: "a", title: "Chess", votes: 3 },
            { id: "b", title: "Go", votes: 1 },
          ],
        },
        {
          id: "old",
          title: "Old poll",
          status: "COMPLETED" as const,
          choices: [],
        },
      ],
    })),
    predictions: vi.fn(async () => ({
      kind: "success" as const,
      value: [
        {
          id: "prediction",
          title: "Win?",
          status: "ACTIVE" as const,
          winningOutcomeId: null,
          outcomes: [
            { id: "yes", title: "Yes", votes: 2 },
            { id: "no", title: "No", votes: 2 },
          ],
        },
      ],
    })),
    execute: vi.fn(async () => ({
      kind: "failure" as const,
      reason: "unsupported" as const,
      detail: "Unavailable",
    })),
  };
  return {
    controller: createEngagementController({ access, gateway }),
    gateway,
  };
}

async function mount(userId: string, selectedChannel = channel) {
  const { controller, gateway } = runtime(userId);
  const { displaySession, predictionSession } = settings();
  const onOpenProvider = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ChatEngagementInline, {
        channel: selectedChannel,
        controller,
        displaySession,
        predictionSession,
        onOpenProvider,
      }),
    ),
  );
  return {
    container,
    root,
    controller,
    gateway,
    displaySession,
    predictionSession,
    onOpenProvider,
  };
}

describe("inline chat engagement", () => {
  it("shows active broadcaster records, provider voting, and both prediction styles", async () => {
    const view = await mount("10");
    expect(view.container.textContent).toContain("Next game?");
    expect(view.container.textContent).toContain("75%");
    expect(view.container.textContent).toContain("TWITCH PREDICTION");
    expect(view.container.textContent).not.toContain("Old poll");
    await act(async () => view.predictionSession.apply({ style: "unified" }));
    expect(view.container.textContent).toContain("PREDICTION");
    expect(view.container.textContent).not.toContain("TWITCH PREDICTION");
    await act(async () => view.displaySession.apply({ showPolls: false }));
    expect(view.container.textContent).not.toContain("Next game?");
    const predictionButton = view.container.querySelector(
      '[data-testid="chat-prediction-open-prediction"]',
    ) as HTMLButtonElement;
    await act(async () => predictionButton.click());
    expect(view.onOpenProvider).toHaveBeenCalledWith(channel);
    await act(async () => view.root.unmount());
    view.controller.dispose();
  });

  it("keeps guest chat clear without reading broadcaster records", async () => {
    const view = await mount("20");
    expect(view.container.textContent).toBe("");
    expect(view.gateway.polls).not.toHaveBeenCalled();
    expect(view.gateway.predictions).not.toHaveBeenCalled();
    await act(async () => view.root.unmount());
    view.controller.dispose();
  });
  it("keeps Kick chat clear without requesting unsupported engagement data", async () => {
    const view = await mount("10", { ...channel, platform: "kick" });
    expect(view.container.textContent).toBe("");
    expect(view.gateway.polls).not.toHaveBeenCalled();
    expect(view.gateway.predictions).not.toHaveBeenCalled();
    await act(async () => view.root.unmount());
    view.controller.dispose();
  });
});
