// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { AppLinkIntent, AppLinkSource } from "../capabilities/app-links";
import type { ShellRestorationRepository } from "@mobile/features/storage/capabilities/persistence";
import {
  createInitialShellNavigationState,
  serializeShellNavigationState,
  shellNavigationReducer,
} from "../domain/shell-navigation";
import { useShellLifecycleController } from "../components/shell-lifecycle-controller";

const savedTarget = {
  kind: "channel" as const,
  platform: "twitch" as const,
  channelId: "71092938",
  channelLogin: "xqc",
};

function savedSnapshot(activeDestination: "watch" | "more") {
  const watching = shellNavigationReducer(createInitialShellNavigationState(), {
    type: "navigate",
    location: { route: "watch/session-preview", target: savedTarget },
  });
  return serializeShellNavigationState(
    activeDestination === "more"
      ? shellNavigationReducer(watching, {
          type: "navigate",
          location: { route: "more/downloads" },
        })
      : watching,
  );
}

async function mountStartup(options: {
  readonly activeDestination?: "watch" | "more";
  readonly initialIntent?: AppLinkIntent | null;
  readonly restoreSession?: boolean;
  readonly resumePlayback?: boolean;
}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const restoration: ShellRestorationRepository = {
    clear: vi.fn(async () => undefined),
    read: vi.fn(async () =>
      savedSnapshot(options.activeDestination ?? "watch"),
    ),
    write: vi.fn(async () => undefined),
  };
  const appLinks: AppLinkSource = {
    initialIntent: vi.fn(async () => options.initialIntent ?? null),
    subscribe: () => () => undefined,
  };
  let latest: ReturnType<typeof useShellLifecycleController>;
  function Probe() {
    latest = useShellLifecycleController({
      appLinks,
      restoration,
      restoreSession: options.restoreSession ?? true,
      resumePlayback: options.resumePlayback ?? false,
      settingsReady: true,
    });
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  return {
    current: () => latest,
    read: restoration.read,
    unmount: async () => act(async () => root.unmount()),
  };
}

describe("saved Watch startup", () => {
  it("offers one saved target to resume while keeping the restored Downloads destination", async () => {
    const app = await mountStartup({
      activeDestination: "more",
      resumePlayback: true,
    });
    try {
      expect(app.current().state.activeDestination).toBe("more");
      expect(app.current().startupWatch).toEqual({
        target: savedTarget,
        resume: true,
      });
      await act(async () =>
        app.current().dispatch({ type: "select", destination: "following" }),
      );
      expect(app.current().startupWatch).toBeNull();
    } finally {
      await app.unmount();
    }
  });

  it("keeps restored Watch ready for a manual start when Resume is off", async () => {
    const app = await mountStartup({ resumePlayback: false });
    try {
      expect(app.current().state.activeDestination).toBe("watch");
      expect(app.current().startupWatch).toEqual({
        target: savedTarget,
        resume: false,
      });
      await act(async () =>
        app.current().dispatch({ type: "select", destination: "more" }),
      );
      await act(async () => app.current().dispatch({ type: "back" }));
      expect(app.current().startupWatch).toEqual({
        target: savedTarget,
        resume: false,
      });
      await act(async () =>
        app.current().dispatch({ type: "select", destination: "watch" }),
      );
      expect(app.current().startupWatch).toBeNull();
    } finally {
      await app.unmount();
    }
  });

  it("lets an incoming Watch link take priority over a saved target", async () => {
    const app = await mountStartup({
      resumePlayback: true,
      initialIntent: {
        kind: "watch-channel",
        platform: "kick",
        channelId: "new-channel",
        channelLogin: "newstream",
      },
    });
    try {
      expect(app.current().startupWatch).toBeNull();
      expect(app.current().state.histories.watch.trail.at(-1)).toMatchObject({
        target: { platform: "kick", channelId: "new-channel" },
      });
    } finally {
      await app.unmount();
    }
  });

  it("does not read a saved target if Restore session is off", async () => {
    const app = await mountStartup({
      restoreSession: false,
      resumePlayback: true,
    });
    try {
      expect(app.read).not.toHaveBeenCalled();
      expect(app.current().startupWatch).toBeNull();
    } finally {
      await app.unmount();
    }
  });
});
