import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import { fn, userEvent, waitFor, within } from "storybook/test";

import type { TimeoutSnapshotResult, TimeoutSubmitResult } from "@/shared/timeout-moderation-types";

import { StateAwareTimeoutAction } from "./StateAwareTimeoutAction";

interface ModerationScenario {
  snapshot: () => Promise<TimeoutSnapshotResult>;
  submit: () => Promise<TimeoutSubmitResult>;
}

const availableSnapshot = {
  state: "available",
  snapshotId: "storybook-timeout-snapshot",
  verifiedAt: 1_725_321_600_000,
  actorRole: "moderator",
  policy: {
    durationUnit: "seconds",
    minDuration: 1,
    maxDuration: 1_209_600,
    supportsReason: true,
    maxReasonLength: 500,
  },
} satisfies TimeoutSnapshotResult;

const availableScenario: ModerationScenario = {
  snapshot: async () => availableSnapshot,
  submit: async () => ({ state: "success", attemptId: "storybook-timeout-success" }),
};

const checkingScenario: ModerationScenario = {
  snapshot: () => new Promise<TimeoutSnapshotResult>(() => undefined),
  submit: availableScenario.submit,
};

const permissionUnavailableScenario: ModerationScenario = {
  snapshot: async () => ({ state: "unavailable", reason: "unauthorized" }),
  submit: availableScenario.submit,
};

const retryableVerificationScenario: ModerationScenario = {
  snapshot: async () => ({ state: "unavailable", reason: "unverifiable" }),
  submit: availableScenario.submit,
};

const submissionFailureScenario: ModerationScenario = {
  snapshot: availableScenario.snapshot,
  submit: async () => ({
    state: "failure",
    attemptId: "storybook-timeout-failure",
    code: "forbidden",
    message: "Kick rejected this timeout. Check your moderation access and try again.",
  }),
};

function ModerationFixture({
  scenario,
  children,
}: {
  scenario: ModerationScenario;
  children: React.ReactNode;
}) {
  useLayoutEffect(() => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const previousBridge = window.electronAPI;
    const storyApi = new Proxy(previousBridge, {
      get(target, property, receiver) {
        if (property === "moderation") {
          return {
            createTimeoutSnapshot: scenario.snapshot,
            submitTimeout: scenario.submit,
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: storyApi,
    });

    return () => {
      if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
      else Reflect.deleteProperty(window, "electronAPI");
    };
  }, [scenario]);

  return <>{children}</>;
}

const withModerationScenario: Decorator = (Story, context) => {
  const scenario = (context.parameters.moderationScenario ??
    availableScenario) as ModerationScenario;

  return (
    <ModerationFixture scenario={scenario}>
      <div className="min-h-48 w-[440px] rounded-lg bg-[#0f0f12] p-5 text-white">
        <Story />
      </div>
    </ModerationFixture>
  );
};

const meta = {
  title: "Components/Chat/Moderation/User Popout/State-Aware Timeout Action",
  component: StateAwareTimeoutAction,
  decorators: [withModerationScenario],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A deterministic moderation bridge fixture drives the verified-action states. No story invokes live Electron IPC.",
      },
    },
  },
  args: {
    binding: {
      action: "timeout",
      platform: "kick",
      channelId: "storybook-channel",
      channelSlug: "pixelnomad",
      targetUserId: "user-mira",
      targetUsername: "miramakes",
      selectedMessageId: "message-mira-latest",
    },
    displayName: "MiraMakes",
    onPendingChange: fn(),
    onSuccess: fn(),
  },
} satisfies Meta<typeof StateAwareTimeoutAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToConfirm: Story = {};

export const VerificationInProgress: Story = {
  args: { presentation: "dialog", open: true, onOpenChange: fn() },
  parameters: { moderationScenario: checkingScenario },
};

export const PermissionUnavailable: Story = {
  args: { presentation: "dialog", open: true, onOpenChange: fn() },
  parameters: { moderationScenario: permissionUnavailableScenario },
};

export const RetryableVerificationFailure: Story = {
  parameters: { moderationScenario: retryableVerificationScenario },
};

export const SubmissionFailure: Story = {
  args: { presentation: "dialog", open: true, onOpenChange: fn() },
  parameters: { moderationScenario: submissionFailureScenario },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await waitFor(() => dialog.getByRole("button", { name: "Time out" }));
    await userEvent.click(dialog.getByRole("button", { name: "Time out" }));
    await waitFor(() => dialog.getByRole("alert"));
  },
};

export const SuccessfulAction: Story = {
  args: { presentation: "dialog", open: true, onOpenChange: fn() },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await waitFor(() => dialog.getByRole("button", { name: "Time out" }));
    await userEvent.click(dialog.getByRole("button", { name: "Time out" }));
    await waitFor(() => dialog.getByText("Timeout applied and history refreshed."));
  },
};
