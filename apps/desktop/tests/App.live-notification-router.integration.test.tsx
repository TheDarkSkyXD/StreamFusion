import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveNotificationPayload } from "@shared/auth-types";

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
vi.mock("@/features/shell/data/use-app-shutdown", () => ({ useAppShutdown: () => undefined }));
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
vi.mock("@/features/media-library", () => {
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
import { router } from "@/routes/router";

let openNotification: ((notification: LiveNotificationPayload) => void) | undefined;

beforeEach(() => {
  openNotification = undefined;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.electronAPI = {
    notifications: {
      onLiveNotification: vi.fn(() => vi.fn()),
      onOpenLiveNotification: vi.fn((callback: (notification: LiveNotificationPayload) => void) => {
        openNotification = callback;
        return vi.fn();
      }),
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  Reflect.deleteProperty(window, "electronAPI");
  window.location.hash = "#/";
  vi.restoreAllMocks();
});

// Guards: the app-level live-notification bridge owns a valid router and opens the requested Stream without an outside-provider warning.
describe("App live-notification routing", () => {
  it("opens a Stream when the main process reports a notification click", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = render(<App />);

    try {
      await waitFor(() => expect(openNotification).toBeTypeOf("function"));
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

      await waitFor(() => expect(router.state.location.pathname).toBe("/stream/kick/xqc"));
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/useRouter.*RouterProvider/i);
    } finally {
      view.unmount();
      warn.mockRestore();
    }
  });
});
