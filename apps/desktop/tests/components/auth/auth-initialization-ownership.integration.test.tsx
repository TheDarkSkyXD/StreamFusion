import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import type { AuthStatus } from "@/shared/ipc-channels";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { installElectronAPIMock, renderWithProviders } from "../../test-utils";

vi.mock("@/components/TopNavBar", () => ({
  TopNavBar: () => <div>top navigation</div>,
}));
vi.mock("@/components/layout/NetworkStatusBanner", () => ({
  NetworkStatusBanner: () => null,
}));
vi.mock("@/components/layout/SidebarFollows", () => ({
  SidebarFollows: () => <div>followed channels</div>,
}));
vi.mock("@/components/layout/TitleBar", () => ({
  TitleBar: () => <div>title bar</div>,
}));
vi.mock("@/components/player/persistent-player-shell", () => ({
  PersistentPlayerShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/recording/recording-completion-notice", () => ({
  RecordingOutcomeBridge: () => null,
}));
vi.mock("@/hooks/use-stream-recording-state", () => ({
  StreamRecordingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({
    isOnline: true,
    isChecking: false,
    retryInSeconds: null,
  }),
}));

const initialAuthState = useAuthStore.getState();
const initialFollowState = useFollowStore.getState();

afterEach(() => {
  useAuthStore.setState(initialAuthState, true);
  useFollowStore.setState(initialFollowState, true);
});

// Guards: the composed StrictMode app shell starts one underlying auth initialization while startup IPC is unresolved.
describe("auth initialization ownership", () => {
  it("starts authentication exactly once while the routed app shell mounts", async () => {
    const api = installElectronAPIMock();
    let resolveStatus!: (status: AuthStatus) => void;
    const getStatus = vi.fn(
      () =>
        new Promise<AuthStatus>((resolve) => {
          resolveStatus = resolve;
        })
    );
    const onKickSessionExpired = vi.fn();
    const onFollowsSynced = vi.fn();
    const onTwitchAuthLost = vi.fn();
    api.auth.getStatus = getStatus;
    api.auth.onKickSessionExpired = onKickSessionExpired;
    api.auth.onFollowsSynced = onFollowsSynced;
    api.auth.onTwitchAuthLost = onTwitchAuthLost;
    api.follows.getAll = vi.fn(async () => []);
    api.preferences.get = vi.fn(async () => DEFAULT_USER_PREFERENCES);
    useAuthStore.setState({ ...initialAuthState, initialized: false }, true);
    useFollowStore.setState({ hydrate: vi.fn() });

    const rootRoute = createRootRoute({
      component: () => (
        <AuthProvider>
          <AppLayout>
            <div>home page</div>
          </AppLayout>
        </AuthProvider>
      ),
    });
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createRouter({ routeTree: rootRoute, history });

    await act(async () => {
      await router.load();
    });
    const view = renderWithProviders(<RouterProvider router={router} />, {
      reactStrictMode: true,
    });
    await act(async () => {
      await Promise.resolve();
    });

    try {
      expect(getStatus).toHaveBeenCalledTimes(1);
      resolveStatus({
        twitch: { connected: false, user: null, hasToken: false, isExpired: false },
        kick: { connected: false, user: null, hasToken: false, isExpired: false },
        isGuest: true,
      });
      await waitFor(() => {
        expect(onKickSessionExpired).toHaveBeenCalledTimes(1);
        expect(onFollowsSynced).toHaveBeenCalledTimes(1);
        expect(onTwitchAuthLost).toHaveBeenCalledTimes(1);
      });
    } finally {
      view.unmount();
      history.destroy();
    }
  });
});
