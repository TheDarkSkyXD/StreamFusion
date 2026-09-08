// @vitest-environment jsdom
import React, { act } from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { TwitchAccountSessionController } from "../domain/twitch-account-session-controller";
import { useTwitchAccountController } from "../components/use-twitch-account-controller";

let appStateListener: ((state: string) => void) | undefined;
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: vi.fn() };
    },
  },
}));

function controller(): TwitchAccountSessionController {
  return {
    cancel: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    copyCode: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => ({ kind: "restoring" })),
    manage: vi.fn(),
    openVerification: vi.fn(async () => undefined),
    reconcile: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    setForeground: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  };
}

function renderControllerHook(options: {
  readonly controller: TwitchAccountSessionController;
  readonly enabled?: boolean;
}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    useTwitchAccountController(options);
    return null;
  }
  act(() => root.render(React.createElement(Harness)));
  return {
    unmount: () => act(() => root.unmount()),
  };
}

it("uses the Mobile React instance for the DOM hook renderer", async () => {
  const importedAgain = await import("react");
  expect(React.version).toBe("19.2.3");
  expect(ReactDOM.version).toBe("19.2.3");
  expect(importedAgain.default).toBe(React);
});

it("keeps an explicitly disabled fixture session inactive", () => {
  const session = controller();
  const rendered = renderControllerHook({ controller: session, enabled: false });
  try {
    expect(session.subscribe).not.toHaveBeenCalled();
    expect(session.setForeground).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
  }
});

it("is a thin AppState and subscription adapter", () => {
  const session = controller();
  const rendered = renderControllerHook({ controller: session });
  expect(session.subscribe).toHaveBeenCalledOnce();
  expect(session.setForeground).toHaveBeenCalledWith(true);
  act(() => appStateListener?.("background"));
  expect(session.setForeground).toHaveBeenLastCalledWith(false);
  rendered.unmount();
  expect(session.setForeground).toHaveBeenLastCalledWith(false);
});
