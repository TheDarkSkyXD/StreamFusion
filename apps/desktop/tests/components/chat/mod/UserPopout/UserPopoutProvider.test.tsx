import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/mod/UserPopout/useUserProfile", () => ({
  useUserProfile: vi.fn(() => ({
    profile: {
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "",
      createdAt: "2020-01-01T00:00:00Z",
      followSince: null,
      subscription: null,
      isFounder: false,
      isVip: false,
      isMod: false,
    },
    loading: false,
    error: null,
  })),
}));
vi.mock("@/hooks/useModLog", () => ({
  useModLog: () => ({ entries: [], loading: false }),
}));

import {
  UserPopoutProvider,
  useOpenUserPopout,
} from "@/components/chat/mod/UserPopout/UserPopoutProvider";
import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";

const mockedUseUserProfile = vi.mocked(useUserProfile);

beforeEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: stub
  (globalThis as any).window.electronAPI = {
    openExternal: vi.fn(),
    auth: { getToken: vi.fn().mockResolvedValue(null) },
  };
});

function Opener({
  payload,
  label = "open",
}: {
  payload: Parameters<ReturnType<typeof useOpenUserPopout>>[0];
  label?: string;
}) {
  const open = useOpenUserPopout();
  return (
    <button type="button" onClick={() => open(payload)}>
      {label}
    </button>
  );
}

describe("UserPopoutProvider", () => {
  it("openUserPopout renders the popout for the requested user", () => {
    render(
      <UserPopoutProvider>
        <Opener
          payload={{
            userId: "u1",
            username: "alice",
            platform: "twitch",
            channelId: "c1",
            channelSlug: "streamer",
          }}
        />
      </UserPopoutProvider>,
    );
    expect(screen.queryByTestId("user-popout")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("calling openUserPopout again with a different user swaps the rendered content", () => {
    mockedUseUserProfile.mockImplementation((userId) => ({
      profile:
        userId === "u2"
          ? {
              userId: "u2",
              username: "bob",
              displayName: "Bob",
              avatarUrl: "",
              createdAt: "2021-01-01T00:00:00Z",
              followSince: null,
              subscription: null,
              isFounder: false,
              isVip: false,
              isMod: false,
            }
          : {
              userId: "u1",
              username: "alice",
              displayName: "Alice",
              avatarUrl: "",
              createdAt: "2020-01-01T00:00:00Z",
              followSince: null,
              subscription: null,
              isFounder: false,
              isVip: false,
              isMod: false,
            },
      loading: false,
      error: null,
    }));

    // Use a single trigger that switches its payload — Radix Dialog traps
    // focus while open, so two adjacent triggers aren't both reachable. The
    // assertion is that swapping which user is open re-renders the content.
    function Trigger() {
      const open = useOpenUserPopout();
      return (
        <div>
          <button
            type="button"
            data-testid="alice"
            onClick={() =>
              open({
                userId: "u1",
                username: "alice",
                platform: "twitch",
                channelId: "c1",
                channelSlug: "streamer",
              })
            }
          />
          <button
            type="button"
            data-testid="bob"
            onClick={() =>
              open({
                userId: "u2",
                username: "bob",
                platform: "twitch",
                channelId: "c1",
                channelSlug: "streamer",
              })
            }
          />
        </div>
      );
    }

    render(
      <UserPopoutProvider>
        <Trigger />
      </UserPopoutProvider>,
    );

    fireEvent.click(screen.getByTestId("alice"));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Trigger button stays in the DOM under the Dialog overlay even with
    // focus trapped — we click it by testId, not by accessible name.
    fireEvent.click(screen.getByTestId("bob"));
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("useOpenUserPopout outside a provider returns a callable no-op and console.debugs once", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    function Inner() {
      const open = useOpenUserPopout();
      return (
        <button
          type="button"
          onClick={() =>
            open({
              userId: "u1",
              username: "alice",
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
            })
          }
        >
          fire
        </button>
      );
    }
    render(<Inner />);
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    // Two calls but only one debug emission.
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
