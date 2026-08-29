import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatQuickSettingsPopover } from "@/features/chat/components/chat/ChatQuickSettingsPopover";
import { useChatDisplay } from "@/features/settings/components/settings/ChatSettingsSection";
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { installElectronAPIMock } from "../../test-utils";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

interface PendingPreferenceWrite {
  reject: () => void;
  resolve: () => void;
  updates: Partial<UserPreferences>;
}

const pendingPreferenceWrites: PendingPreferenceWrite[] = [];
let persistedPreferences: UserPreferences;

function createPreferences(chatDisplay: Partial<ChatDisplayPreferences> = {}): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...chatDisplay },
  };
}

function installPendingPreferencePersistence(): void {
  const electronAPI = installElectronAPIMock();
  electronAPI.preferences.update = vi.fn(
    (updates: Partial<UserPreferences>): Promise<UserPreferences> =>
      new Promise((resolve, reject) => {
        pendingPreferenceWrites.push({
          reject: () => reject(new Error("storage unavailable")),
          resolve: () => {
            persistedPreferences = { ...persistedPreferences, ...updates };
            resolve(persistedPreferences);
          },
          updates,
        });
      })
  );
}

function SharedChatDisplayConsumer() {
  const chatDisplay = useAuthStore((state) => state.preferences?.chatDisplay);

  return (
    <output data-testid="shared-chat-display">
      {chatDisplay?.chatWidthPx}:{String(chatDisplay?.timestamps)}
    </output>
  );
}

function ChatDisplayLifecycleWriter({
  onSaved,
  onSettled,
}: {
  onSaved: () => void;
  onSettled: () => void;
}) {
  const { set } = useChatDisplay(onSaved);

  return (
    <>
      <button
        type="button"
        onClick={() => void set("chatWidthPx", 420).finally(onSettled)}
      >
        Set shared width
      </button>
      <button
        type="button"
        onClick={() => void set("timestamps", true).finally(onSettled)}
      >
        Set shared timestamps
      </button>
    </>
  );
}

function SharedHookChatDisplayConsumer() {
  const { cd } = useChatDisplay();

  return (
    <output data-testid="shared-hook-chat-display">
      {cd.chatWidthPx}:{String(cd.timestamps)}
    </output>
  );
}

// Guards: rapid changes to different Chat Appearance controls remain visible and persist together when saves are delayed.
// Guards: an appearance edit made before preference hydration merges with stored choices instead of replacing them with defaults.
// Guards: every hydrated Chat Appearance edit reaches shared consumers synchronously, and an older save cannot roll back a newer field.
// Guards: stalled preference hydration settles without losing shared optimistic intent or permanently blocking later saves.
// Guards: a failed preference save retains unacknowledged intent for the next successful serialized edit.
// Guards: a stale pre-hydration save cannot acknowledge a newer same-field edit that must survive failure and refresh for retry.
describe("ChatQuickSettingsPopover preference persistence", () => {
  beforeEach(() => {
    pendingPreferenceWrites.length = 0;
    persistedPreferences = createPreferences();
    installPendingPreferencePersistence();
    useAuthStore.setState({
      initialized: true,
      kickUser: null,
      preferences: persistedPreferences,
      twitchUser: null,
    });
  });

  it("keeps rapid width and timestamp changes after delayed saves resolve in order", async () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    fireEvent.click(screen.getByRole("radio", { name: "420px" }));
    fireEvent.click(screen.getByRole("switch", { name: "Timestamps" }));

    expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Timestamps" })).toBeChecked();

    await waitFor(() => expect(pendingPreferenceWrites).toHaveLength(1));
    await act(async () => {
      pendingPreferenceWrites[0]!.resolve();
    });
    await waitFor(() => expect(pendingPreferenceWrites).toHaveLength(2));
    await act(async () => {
      pendingPreferenceWrites[1]!.resolve();
    });

    expect(persistedPreferences.chatDisplay).toMatchObject({
      chatWidthPx: 420,
      timestamps: true,
    });
    await waitFor(() => {
      expect(useAuthStore.getState().preferences?.chatDisplay).toMatchObject({
        chatWidthPx: 420,
        timestamps: true,
      });
      expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "Timestamps" })).toBeChecked();
    });
  });

  it("publishes rapid edits to shared consumers before their serialized saves resolve", async () => {
    render(
      <>
        <ChatQuickSettingsPopover onClose={vi.fn()} />
        <SharedChatDisplayConsumer />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));

    fireEvent.click(screen.getByRole("radio", { name: "420px" }));
    const afterWidthEdit = screen.getByTestId("shared-chat-display").textContent;

    fireEvent.click(screen.getByRole("switch", { name: "Timestamps" }));
    const afterTimestampEdit = screen.getByTestId("shared-chat-display").textContent;
    const writesBeforeFirstResolved = pendingPreferenceWrites.length;

    await act(async () => {
      pendingPreferenceWrites[0]!.resolve();
    });
    await waitFor(() => expect(pendingPreferenceWrites).toHaveLength(2));
    const afterFirstWriteResolved = screen.getByTestId("shared-chat-display").textContent;

    await act(async () => {
      pendingPreferenceWrites[1]!.resolve();
    });

    expect({
      afterWidthEdit,
      afterTimestampEdit,
      writesBeforeFirstResolved,
      afterFirstWriteResolved,
    }).toEqual({
      afterWidthEdit: "420:false",
      afterTimestampEdit: "420:true",
      writesBeforeFirstResolved: 1,
      afterFirstWriteResolved: "420:true",
    });
  });

  it("merges an edit made before hydration with stored appearance choices", async () => {
    persistedPreferences = createPreferences({ hoverSmooth: false, quickEmotes: false });
    useAuthStore.setState({ initialized: false, preferences: null });

    render(<ChatQuickSettingsPopover onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    fireEvent.click(screen.getByRole("radio", { name: "420px" }));

    expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();

    await act(async () => {
      useAuthStore.setState({ initialized: true, preferences: persistedPreferences });
    });
    expect(pendingPreferenceWrites).toHaveLength(1);

    expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Hover smooth mode" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Quick Emotes" })).not.toBeChecked();

    await act(async () => {
      pendingPreferenceWrites[0]!.resolve();
    });

    expect(persistedPreferences.chatDisplay).toMatchObject({
      chatWidthPx: 420,
      hoverSmooth: false,
      quickEmotes: false,
    });
    expect(useAuthStore.getState().preferences?.chatDisplay).toMatchObject({
      chatWidthPx: 420,
      hoverSmooth: false,
      quickEmotes: false,
    });
    expect(screen.getByRole("radio", { name: "420px" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Hover smooth mode" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Quick Emotes" })).not.toBeChecked();
  });

  it("retains shared optimistic intent and frees later saves when hydration stalls", async () => {
    vi.useFakeTimers();
    const onSaved = vi.fn();
    const onSettled = vi.fn();
    persistedPreferences = createPreferences({ hoverSmooth: false, quickEmotes: false });
    useAuthStore.setState({ initialized: false, preferences: null });

    try {
      render(
        <>
          <ChatDisplayLifecycleWriter onSaved={onSaved} onSettled={onSettled} />
          <SharedHookChatDisplayConsumer />
        </>
      );

      fireEvent.click(screen.getByRole("button", { name: "Set shared width" }));
      const immediatelyVisible = screen.getByTestId("shared-hook-chat-display").textContent;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const visibleAfterDeadline = screen.getByTestId("shared-hook-chat-display").textContent;
      const settledAfterDeadline = onSettled.mock.calls.length;
      const savedAfterDeadline = onSaved.mock.calls.length;
      const writesAfterDeadline = pendingPreferenceWrites.length;

      await act(async () => {
        useAuthStore.setState({ initialized: true, preferences: persistedPreferences });
        await Promise.resolve();
      });
      const writesAfterHydration = pendingPreferenceWrites.length;

      fireEvent.click(screen.getByRole("button", { name: "Set shared timestamps" }));
      const visibleAfterLaterEdit = screen.getByTestId("shared-hook-chat-display").textContent;
      const nextWrite = pendingPreferenceWrites[0]?.updates.chatDisplay;

      for (let index = 0; index < pendingPreferenceWrites.length; index += 1) {
        await act(async () => {
          pendingPreferenceWrites[index]!.resolve();
          await Promise.resolve();
        });
      }

      expect({
        immediatelyVisible,
        visibleAfterDeadline,
        settledAfterDeadline,
        savedAfterDeadline,
        writesAfterDeadline,
        writesAfterHydration,
        visibleAfterLaterEdit,
        nextWrite: nextWrite && {
          chatWidthPx: nextWrite.chatWidthPx,
          timestamps: nextWrite.timestamps,
          hoverSmooth: nextWrite.hoverSmooth,
          quickEmotes: nextWrite.quickEmotes,
        },
        finalWriteCount: pendingPreferenceWrites.length,
        finalSettledCount: onSettled.mock.calls.length,
        finalSavedCount: onSaved.mock.calls.length,
      }).toEqual({
        immediatelyVisible: "420:false",
        visibleAfterDeadline: "420:false",
        settledAfterDeadline: 1,
        savedAfterDeadline: 0,
        writesAfterDeadline: 0,
        writesAfterHydration: 0,
        visibleAfterLaterEdit: "420:true",
        nextWrite: {
          chatWidthPx: 420,
          timestamps: true,
          hoverSmooth: false,
          quickEmotes: false,
        },
        finalWriteCount: 1,
        finalSettledCount: 2,
        finalSavedCount: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries retained optimistic intent with the next edit after persistence fails", async () => {
    const onSaved = vi.fn();
    const onSettled = vi.fn();
    persistedPreferences = createPreferences({ hoverSmooth: false, quickEmotes: false });
    useAuthStore.setState({ preferences: persistedPreferences });

    render(
      <>
        <ChatDisplayLifecycleWriter onSaved={onSaved} onSettled={onSettled} />
        <SharedChatDisplayConsumer />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Set shared width" }));
    const immediatelyVisible = screen.getByTestId("shared-chat-display").textContent;
    const attemptsBeforeFailure = pendingPreferenceWrites.length;

    await act(async () => {
      pendingPreferenceWrites[0]!.reject();
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    const visibleAfterFailure = screen.getByTestId("shared-chat-display").textContent;
    const savedAfterFailure = onSaved.mock.calls.length;

    await act(async () => {
      useAuthStore.setState({ preferences: persistedPreferences });
    });
    const visibleAfterAuthoritativeRefresh = screen.getByTestId("shared-chat-display").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Set shared timestamps" }));
    const visibleAfterRetryEdit = screen.getByTestId("shared-chat-display").textContent;
    const retryWrite = pendingPreferenceWrites[1]?.updates.chatDisplay;

    await act(async () => {
      pendingPreferenceWrites[1]!.resolve();
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(2));

    const finalPersisted = persistedPreferences.chatDisplay;
    const finalStored = useAuthStore.getState().preferences?.chatDisplay;
    await act(async () => {
      useAuthStore.setState({
        preferences: createPreferences({ hoverSmooth: false, quickEmotes: false }),
      });
    });
    const visibleAfterSuccessfulAcknowledgement = screen.getByTestId(
      "shared-chat-display"
    ).textContent;

    expect({
      immediatelyVisible,
      attemptsBeforeFailure,
      visibleAfterFailure,
      savedAfterFailure,
      visibleAfterAuthoritativeRefresh,
      visibleAfterRetryEdit,
      retryWrite: retryWrite && {
        chatWidthPx: retryWrite.chatWidthPx,
        timestamps: retryWrite.timestamps,
        hoverSmooth: retryWrite.hoverSmooth,
        quickEmotes: retryWrite.quickEmotes,
      },
      finalAttemptCount: pendingPreferenceWrites.length,
      finalSettledCount: onSettled.mock.calls.length,
      finalSavedCount: onSaved.mock.calls.length,
      finalPersisted: {
        chatWidthPx: finalPersisted.chatWidthPx,
        timestamps: finalPersisted.timestamps,
      },
      finalStored: finalStored && {
        chatWidthPx: finalStored.chatWidthPx,
        timestamps: finalStored.timestamps,
      },
      visibleAfterSuccessfulAcknowledgement,
    }).toEqual({
      immediatelyVisible: "420:false",
      attemptsBeforeFailure: 1,
      visibleAfterFailure: "420:false",
      savedAfterFailure: 0,
      visibleAfterAuthoritativeRefresh: "420:false",
      visibleAfterRetryEdit: "420:true",
      retryWrite: {
        chatWidthPx: 420,
        timestamps: true,
        hoverSmooth: false,
        quickEmotes: false,
      },
      finalAttemptCount: 2,
      finalSettledCount: 2,
      finalSavedCount: 1,
      finalPersisted: { chatWidthPx: 420, timestamps: true },
      finalStored: { chatWidthPx: 420, timestamps: true },
      visibleAfterSuccessfulAcknowledgement: "340:false",
    });
  });

  it("retains the newest pre-hydration width when its queued save fails", async () => {
    persistedPreferences = createPreferences({ hoverSmooth: false, quickEmotes: false });
    useAuthStore.setState({ initialized: false, preferences: null });

    render(
      <>
        <ChatQuickSettingsPopover onClose={vi.fn()} />
        <SharedHookChatDisplayConsumer />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: /chat appearance/i }));
    fireEvent.click(screen.getByRole("radio", { name: "420px" }));
    fireEvent.click(screen.getByRole("radio", { name: "280px" }));

    await act(async () => {
      useAuthStore.setState({ initialized: true, preferences: persistedPreferences });
    });
    expect(pendingPreferenceWrites).toHaveLength(1);
    const firstWidth = pendingPreferenceWrites[0]!.updates.chatDisplay?.chatWidthPx;

    await act(async () => {
      pendingPreferenceWrites[0]!.resolve();
    });
    await waitFor(() => expect(pendingPreferenceWrites).toHaveLength(2));
    const secondWidth = pendingPreferenceWrites[1]!.updates.chatDisplay?.chatWidthPx;

    await act(async () => {
      pendingPreferenceWrites[1]!.reject();
    });
    await act(async () => {
      useAuthStore.setState({ preferences: persistedPreferences });
    });
    const visibleAfterAuthoritativeRefresh = screen.getByTestId(
      "shared-hook-chat-display"
    ).textContent;

    fireEvent.click(screen.getByRole("switch", { name: "Timestamps" }));
    await waitFor(() => expect(pendingPreferenceWrites).toHaveLength(3));
    const retryWrite = pendingPreferenceWrites[2]!.updates.chatDisplay;

    await act(async () => {
      pendingPreferenceWrites[2]!.resolve();
    });
    await act(async () => {
      useAuthStore.setState({ preferences: createPreferences() });
    });

    expect({
      firstWidth,
      secondWidth,
      visibleAfterAuthoritativeRefresh,
      retryWrite: retryWrite && {
        chatWidthPx: retryWrite.chatWidthPx,
        timestamps: retryWrite.timestamps,
      },
      finalWriteCount: pendingPreferenceWrites.length,
      visibleAfterSuccessfulAcknowledgement: screen.getByTestId("shared-hook-chat-display")
        .textContent,
    }).toEqual({
      firstWidth: 420,
      secondWidth: 280,
      visibleAfterAuthoritativeRefresh: "280:false",
      retryWrite: { chatWidthPx: 280, timestamps: true },
      finalWriteCount: 3,
      visibleAfterSuccessfulAcknowledgement: "340:false",
    });
  });
});
