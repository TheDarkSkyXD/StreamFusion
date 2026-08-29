import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/features/shell/components/ToastRoot";
import type { ElectronAPI } from "@backend/preload";

import { RetentionCard } from "./RetentionCard";

type RetentionState = "unset" | "thirty-days" | "forever" | "saving" | "save-failure";

const STORY_SCOPE = "channel:story-twitch-channel" as const;
const STORY_TITLE = "NovaArcade";
const storybookElectronApi = window.electronAPI;

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function createRetentionBridge(state: RetentionState): ElectronAPI["retention"] {
  return {
    get: async () => {
      if (state === "thirty-days") return 30;
      if (state === "forever") return null;
      return undefined;
    },
    set: async () => {
      if (state === "saving") return neverResolves();
      if (state === "save-failure") {
        throw new Error("The retention service is unavailable in this fixture.");
      }
    },
  };
}

function RetentionBridgeProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: RetentionState;
}) {
  useLayoutEffect(() => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
    Object.defineProperty(electronApi, "retention", {
      configurable: true,
      value: createRetentionBridge(state),
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: electronApi,
    });

    return () => {
      if (previousDescriptor) {
        Object.defineProperty(window, "electronAPI", previousDescriptor);
      } else {
        Reflect.deleteProperty(window, "electronAPI");
      }
    };
  }, [state]);

  useEffect(
    () => () => {
      toast.dismiss();
    },
    []
  );

  return children;
}

function RetentionCardStoryCanvas({ state }: { state: RetentionState }) {
  return (
    <RetentionBridgeProvider state={state}>
      <div className="min-h-[240px] min-w-[620px] bg-[var(--color-background)] p-6">
        <RetentionCard scope={STORY_SCOPE} title={STORY_TITLE} />
      </div>
      <ToastRoot />
    </RetentionBridgeProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/RetentionCard",
  component: RetentionCard,
  args: {
    scope: STORY_SCOPE,
    title: STORY_TITLE,
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Per-channel retention settings with a restored local Electron bridge fixture. These stories exercise no live IPC and no platform API.",
      },
    },
  },
} satisfies Meta<typeof RetentionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <RetentionCardStoryCanvas state="unset" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("spinbutton", { name: `Retention days for ${STORY_TITLE}` })
    ).toHaveValue(null);
  },
};

export const ThirtyDays: Story = {
  render: () => <RetentionCardStoryCanvas state="thirty-days" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("spinbutton", {
        name: `Retention days for ${STORY_TITLE}`,
      })
    ).toHaveValue(30);
  },
};

export const Forever: Story = {
  render: () => <RetentionCardStoryCanvas state="forever" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("checkbox", {
        name: `Forever toggle for ${STORY_TITLE}`,
      })
    ).toBeChecked();
  },
};

export const Saving: Story = {
  render: () => <RetentionCardStoryCanvas state="saving" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("spinbutton", {
      name: `Retention days for ${STORY_TITLE}`,
    });
    await userEvent.type(input, "45");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(canvas.getByRole("button", { name: "Saving…" })).toBeDisabled();
  },
};

export const InvalidSave: Story = {
  render: () => <RetentionCardStoryCanvas state="unset" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText("Days must be a positive integer (or enable Forever)")
    ).toBeInTheDocument();
  },
};

export const SaveFailure: Story = {
  render: () => <RetentionCardStoryCanvas state="save-failure" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("spinbutton", {
      name: `Retention days for ${STORY_TITLE}`,
    });
    await userEvent.type(input, "45");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText("Save failed: The retention service is unavailable in this fixture.")
    ).toBeInTheDocument();
  },
};
