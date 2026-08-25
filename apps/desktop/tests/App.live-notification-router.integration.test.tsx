import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveNotificationPayload } from "@/shared/auth-types";

vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/dev/DeveloperConsole", () => ({ DeveloperConsole: () => null }));
vi.mock("@/components/download-duplicate-confirmation-dialog", () => ({
  DownloadDuplicateConfirmationDialog: () => null,
}));
vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ToastRoot", () => ({ ToastRoot: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/use-app-shutdown", () => ({ useAppShutdown: () => undefined }));
vi.mock("@/pages", () => {
  const Page = () => <div>route content</div>;
  return {
    CategoriesPage: Page,
    CategoryDetailPage: Page,
    DownloadsPage: Page,
    FollowingPage: Page,
    HistoryPage: Page,
    HomePage: Page,
    ModChannelKickPage: Page,
    ModChannelTwitchPage: Page,
    ModPage: Page,
    MultiStreamPage: Page,
    SearchPage: Page,
    SettingsPage: Page,
    StreamPage: Page,
    VideoPage: Page,
  };
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
