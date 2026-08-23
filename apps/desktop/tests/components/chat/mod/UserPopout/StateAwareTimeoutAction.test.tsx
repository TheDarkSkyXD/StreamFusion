import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI: DeepPartial<Window["electronAPI"]>;
};

vi.mock("@/components/chat/mod/mod-action-toast", () => ({
  showModActionSuccessToast: vi.fn(),
}));

import { showModActionSuccessToast } from "@/components/chat/mod/mod-action-toast";
import { StateAwareTimeoutAction } from "@/components/chat/mod/UserPopout/StateAwareTimeoutAction";

const twitchBinding = {
  platform: "twitch" as const,
  channelId: "100",
  channelSlug: "streamer",
  targetUserId: "300",
  targetUsername: "viewer",
  selectedMessageId: "message-4",
  action: "timeout" as const,
};

function availableSnapshot(platform: "twitch" | "kick") {
  return {
    state: "available" as const,
    snapshotId: `${platform}-snapshot`,
    verifiedAt: Date.now(),
    actorRole: "moderator" as const,
    policy:
      platform === "twitch"
        ? {
            durationUnit: "seconds" as const,
            minDuration: 1,
            maxDuration: 1_209_600,
            supportsReason: true,
            maxReasonLength: 500,
          }
        : {
            durationUnit: "minutes" as const,
            minDuration: 1,
            maxDuration: 10_080,
            supportsReason: true,
            maxReasonLength: 100,
          },
  };
}

describe("StateAwareTimeoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only appears after a positive snapshot and preserves failure input for Retry", async () => {
    const createTimeoutSnapshot = vi.fn().mockResolvedValue(availableSnapshot("twitch"));
    const submitTimeout = vi
      .fn()
      .mockResolvedValueOnce({
        state: "failure",
        attemptId: "attempt-1",
        code: "forbidden",
        message: "Twitch rejected this timeout. Check your moderation access and try again.",
      })
      .mockResolvedValueOnce({ state: "success", attemptId: "attempt-2" });
    (window as TestWindow).electronAPI = {
      moderation: { createTimeoutSnapshot, submitTimeout },
    };
    const onSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer"
        onPendingChange={() => {}}
        onSuccess={onSuccess}
      />
    );
    expect(screen.queryByRole("button", { name: "Timeout user" })).toBeNull();
    const trigger = await screen.findByRole("button", { name: "Timeout user" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Repeated spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));

    expect(
      await screen.findByText(
        "Twitch rejected this timeout. Check your moderation access and try again."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(90);
    expect(screen.getByLabelText("Reason (optional)")).toHaveValue("Repeated spam");
    fireEvent.click(screen.getByRole("button", { name: "Retry timeout" }));

    await waitFor(() => expect(submitTimeout).toHaveBeenCalledTimes(2));
    expect(submitTimeout).toHaveBeenLastCalledWith({
      snapshotId: "twitch-snapshot",
      duration: 90,
      reason: "Repeated spam",
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(showModActionSuccessToast).toHaveBeenCalledWith("Timed out Viewer");
  });

  it("locks the parent only during submission and allows close while success refreshes", async () => {
    let finish!: (value: { state: "success"; attemptId: string }) => void;
    let finishTargetRefresh!: (value: ReturnType<typeof availableSnapshot>) => void;
    let finishHistoryRefresh!: () => void;
    const submitTimeout = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const createTimeoutSnapshot = vi
      .fn()
      .mockResolvedValueOnce(availableSnapshot("kick"))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishTargetRefresh = resolve;
        })
      );
    (window as TestWindow).electronAPI = {
      moderation: {
        createTimeoutSnapshot,
        submitTimeout,
      },
    };
    const pendingChanges: boolean[] = [];
    const onSuccess = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHistoryRefresh = resolve;
        })
    );
    const binding = { ...twitchBinding, platform: "kick" as const };

    render(
      <StateAwareTimeoutAction
        binding={binding}
        displayName="Viewer"
        onPendingChange={(pending) => pendingChanges.push(pending)}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Timeout user" }));
    expect(screen.queryByRole("button", { name: "10s" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));
    expect(pendingChanges.at(-1)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Timing out");

    act(() => finish({ state: "success", attemptId: "attempt-1" }));
    await waitFor(() => expect(pendingChanges.at(-1)).toBe(false));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");

    await act(async () => {
      finishHistoryRefresh();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing moderation history");

    await act(async () => {
      finishTargetRefresh(availableSnapshot("kick"));
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("history refreshed");
  });

  it("reports a post-timeout history refresh failure without offering to repeat the timeout", async () => {
    const createTimeoutSnapshot = vi.fn().mockResolvedValue(availableSnapshot("twitch"));
    const submitTimeout = vi.fn().mockResolvedValue({
      state: "success" as const,
      attemptId: "attempt-1",
    });
    (window as TestWindow).electronAPI = {
      moderation: { createTimeoutSnapshot, submitTimeout },
    };
    const onSuccess = vi
      .fn()
      .mockRejectedValueOnce(new Error("history unavailable"))
      .mockResolvedValue(undefined);

    render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer"
        onPendingChange={() => {}}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Timeout user" }));
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));

    expect(
      await screen.findByText(
        "Timeout applied, but moderation history could not be refreshed. Try refreshing again."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry timeout" })).toBeNull();
    expect(submitTimeout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("history refreshed"));
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(submitTimeout).toHaveBeenCalledTimes(1);
  });

  it("hides and omits a reason when the platform policy does not support one", async () => {
    const snapshot = {
      ...availableSnapshot("kick"),
      policy: {
        ...availableSnapshot("kick").policy,
        supportsReason: false,
        maxReasonLength: 0,
      },
    };
    const submitTimeout = vi.fn().mockResolvedValue({
      state: "success" as const,
      attemptId: "attempt-1",
    });
    (window as TestWindow).electronAPI = {
      moderation: {
        createTimeoutSnapshot: vi.fn().mockResolvedValue(snapshot),
        submitTimeout,
      },
    };

    render(
      <StateAwareTimeoutAction
        binding={{ ...twitchBinding, platform: "kick" }}
        displayName="Viewer"
        onPendingChange={() => {}}
        onSuccess={() => {}}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Timeout user" }));

    expect(screen.queryByLabelText("Reason (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));
    await waitFor(() => expect(submitTimeout).toHaveBeenCalledTimes(1));
    expect(submitTimeout).toHaveBeenCalledWith({
      snapshotId: "kick-snapshot",
      duration: 10,
    });
  });

  it("resets duration and reason when the confirmation is closed and reopened", async () => {
    (window as TestWindow).electronAPI = {
      moderation: {
        createTimeoutSnapshot: vi.fn().mockResolvedValue(availableSnapshot("twitch")),
        submitTimeout: vi.fn(),
      },
    };

    render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer"
        onPendingChange={() => {}}
        onSuccess={() => {}}
      />
    );

    const trigger = await screen.findByRole("button", { name: "Timeout user" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Repeated spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(trigger);

    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "10m" })).toHaveAttribute("data-selected", "true");
    expect(screen.getByLabelText("Reason (optional)")).toHaveValue("");
  });

  it("ignores a timeout result that resolves after the selected target changes", async () => {
    let finishSubmit!: (value: { state: "success"; attemptId: string }) => void;
    const submitTimeout = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSubmit = resolve;
        })
    );
    const createTimeoutSnapshot = vi.fn(async (request: { targetUserId: string }) =>
      availableSnapshot(request.targetUserId === "300" ? "twitch" : "kick")
    );
    (window as TestWindow).electronAPI = {
      moderation: { createTimeoutSnapshot, submitTimeout },
    };
    const onSuccess = vi.fn();
    const view = render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer A"
        onPendingChange={() => {}}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Timeout user" }));
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));

    view.rerender(
      <StateAwareTimeoutAction
        binding={{ ...twitchBinding, targetUserId: "301", targetUsername: "viewer-b" }}
        displayName="Viewer B"
        onPendingChange={() => {}}
        onSuccess={onSuccess}
      />
    );
    await act(async () => {
      finishSubmit({ state: "success", attemptId: "attempt-a" });
      await Promise.resolve();
    });

    expect(showModActionSuccessToast).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("ignores a late snapshot response from the previously selected target", async () => {
    let finishTargetA!: (value: ReturnType<typeof availableSnapshot>) => void;
    let finishTargetB!: (value: ReturnType<typeof availableSnapshot>) => void;
    const createTimeoutSnapshot = vi.fn((request: { targetUserId: string }) => {
      return new Promise<ReturnType<typeof availableSnapshot>>((resolve) => {
        if (request.targetUserId === "300") finishTargetA = resolve;
        else finishTargetB = resolve;
      });
    });
    const submitTimeout = vi.fn().mockResolvedValue({
      state: "failure",
      attemptId: "attempt-b",
      code: "network",
      message: "No",
    });
    (window as TestWindow).electronAPI = {
      moderation: { createTimeoutSnapshot, submitTimeout },
    };
    const view = render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer A"
        onPendingChange={() => {}}
        onSuccess={() => {}}
      />
    );

    view.rerender(
      <StateAwareTimeoutAction
        binding={{ ...twitchBinding, targetUserId: "301", targetUsername: "viewer-b" }}
        displayName="Viewer B"
        onPendingChange={() => {}}
        onSuccess={() => {}}
      />
    );
    await act(async () => {
      finishTargetB({ ...availableSnapshot("twitch"), snapshotId: "snapshot-b" });
      await Promise.resolve();
    });
    const trigger = await screen.findByRole("button", { name: "Timeout user" });
    await act(async () => {
      finishTargetA({ ...availableSnapshot("twitch"), snapshotId: "snapshot-a" });
      await Promise.resolve();
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Time out" }));

    await waitFor(() =>
      expect(submitTimeout).toHaveBeenCalledWith({
        snapshotId: "snapshot-b",
        duration: 600,
      })
    );
  });

  it("fails closed and never renders Timeout for unverifiable target state", async () => {
    (window as TestWindow).electronAPI = {
      moderation: {
        createTimeoutSnapshot: vi
          .fn()
          .mockResolvedValue({ state: "unavailable", reason: "unverifiable" }),
        submitTimeout: vi.fn(),
      },
    };
    render(
      <StateAwareTimeoutAction
        binding={twitchBinding}
        displayName="Viewer"
        onPendingChange={() => {}}
        onSuccess={() => {}}
      />
    );
    expect(await screen.findByRole("button", { name: "Refresh moderation actions" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Timeout user" })).toBeNull();
  });
});
