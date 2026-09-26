import { act, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES, type LiveNotificationPayload } from "@shared/auth-types";
import { installElectronAPIMock } from "../../../../../tests/test-utils";

vi.mock("@/routes/start-root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  const { default: DesktopRuntime } = await import("@/renderer/desktop-runtime");
  return { Route: createRootRoute({ component: DesktopRuntime }) };
});
vi.mock("@/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n")>()),
  activateDisplayLanguage: vi.fn(),
}));
vi.mock("@/features/auth/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/dev/DeveloperConsole", () => ({ DeveloperConsole: () => null }));
vi.mock("@/features/media-library/components/download-duplicate-confirmation-dialog", () => ({
  DownloadDuplicateConfirmationDialog: () => null,
}));
vi.mock("@/features/shell/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/shell/components/ToastRoot", () => ({ ToastRoot: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/shell/components/hooks/use-app-shutdown", () => ({
  useAppShutdown: () => undefined,
}));
vi.mock("@/features/discovery/routes", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/discovery/routes")>();
  const Page = () => <div>route content</div>;
  return {
    ...original,
    CategoriesPage: Page,
    CategoryDetailPage: Page,
    FollowingPage: Page,
    HomePage: Page,
    SearchPage: Page,
  };
});
vi.mock("@/features/media-library/routes", () => {
  const Page = () => <div>route content</div>;
  return { DownloadsPage: Page, HistoryPage: Page };
});
vi.mock("@/features/moderation/routes", () => {
  const Page = () => <div>route content</div>;
  return {
    ModChannelKickPage: Page,
    ModChannelTwitchPage: Page,
    ModPage: Page,
  };
});
vi.mock("@/features/multistream/routes", () => {
  const Page = () => <div>route content</div>;
  return { MultiStreamPage: Page };
});
vi.mock("@/features/playback/routes", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/playback/routes")>();
  const Page = () => <div>route content</div>;
  return {
    ...original,
    StreamPage: Page,
    VideoPage: Page,
  };
});
vi.mock("@/features/settings/routes", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/settings/routes")>();
  const Page = () => <div>route content</div>;
  return { ...original, SettingsPage: Page };
});
vi.mock("@/providers/query-provider", () => ({
  QueryProvider: ({ children }: { children: ReactNode }) => children,
}));

import App from "@/App";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { activateDisplayLanguage } from "@/i18n";
import { router } from "@/routes/router";
import { getRouter } from "@/routes/start-router";

let openNotification: ((notification: LiveNotificationPayload) => void) | undefined;
const liveSubscriptions = new Set<(notification: LiveNotificationPayload) => void>();
const openSubscriptions = new Set<(notification: LiveNotificationPayload) => void>();
const initialAuthState = useAuthStore.getState();
let finishLanguageActivation: () => void;

beforeEach(() => {
  openNotification = undefined;
  liveSubscriptions.clear();
  openSubscriptions.clear();
  vi.mocked(activateDisplayLanguage).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishLanguageActivation = resolve;
      })
  );
  useAuthStore.setState({
    initialized: true,
    preferences: { ...DEFAULT_USER_PREFERENCES, language: "es" },
  });
  router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const api = installElectronAPIMock();
  api.notifications.onLiveNotification = vi.fn((callback) => {
    liveSubscriptions.add(callback);
    return () => {
      liveSubscriptions.delete(callback);
    };
  });
  api.notifications.onOpenLiveNotification = vi.fn((callback) => {
    openNotification = callback;
    openSubscriptions.add(callback);
    return () => {
      openSubscriptions.delete(callback);
    };
  });
});

afterEach(() => {
  useAuthStore.setState(initialAuthState);
  Reflect.deleteProperty(window, "electronAPI");
  window.location.hash = "#/";
  vi.restoreAllMocks();
});

// Guards: both renderer roots route notification clicks while language loading hides their pages.
// Guards: Start notifications use the mounted router rather than the inactive legacy router.
// Guards: unmounting either renderer removes both notification listeners.
describe.each(["legacy", "start"] as const)("%s App live-notification routing", (renderer) => {
  it("opens the requested Stream before and after language activation and releases listeners", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const candidateRouter = getRouter();
    candidateRouter.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });
    const activeRouter = renderer === "legacy" ? router : candidateRouter;
    const inactiveLegacyPath = router.state.location.pathname;
    const view = render(
      renderer === "legacy" ? <App /> : <RouterProvider router={candidateRouter} />
    );

    try {
      await waitFor(() => expect(openNotification).toBeTypeOf("function"));
      expect(view.queryByText("route content")).not.toBeInTheDocument();
      expect(liveSubscriptions.size).toBe(1);
      expect(openSubscriptions.size).toBe(1);
      await act(async () => {
        openNotification?.({
          id: "kick:200:1000",
          platform: "kick",
          channelId: "200",
          channelName: "xqc",
          channelDisplayName: "xQc",
          title: "Live now",
          createdAt: 1_000,
        });
      });

      await waitFor(() => expect(activeRouter.state.location.pathname).toBe("/stream/kick/xqc"));
      expect(view.queryByText("route content")).not.toBeInTheDocument();
      await act(async () => {
        finishLanguageActivation();
      });
      expect(await view.findByText("route content")).toBeInTheDocument();
      await act(async () => {
        openNotification?.({
          id: "twitch:300:2000",
          platform: "twitch",
          channelId: "300",
          channelName: "shroud",
          channelDisplayName: "shroud",
          title: "Live now",
          createdAt: 2_000,
        });
      });
      await waitFor(() =>
        expect(activeRouter.state.location.pathname).toBe("/stream/twitch/shroud")
      );
      if (renderer === "start") expect(router.state.location.pathname).toBe(inactiveLegacyPath);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/useRouter.*RouterProvider/i);
    } finally {
      view.unmount();
      warn.mockRestore();
    }
    expect(liveSubscriptions.size).toBe(0);
    expect(openSubscriptions.size).toBe(0);
  });
});
