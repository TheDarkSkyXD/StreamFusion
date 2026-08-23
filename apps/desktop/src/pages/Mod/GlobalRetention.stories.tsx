import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";
import type { ElectronAPI } from "@/preload";

import { GlobalRetention } from "./GlobalRetention";

type RetentionState = "unset" | "thirty-days" | "forever" | "save-failure";

const storybookElectronApi = window.electronAPI;

function createRetentionBridge(state: RetentionState): ElectronAPI["retention"] {
  return {
    get: async () => {
      if (state === "thirty-days") return 30;
      if (state === "forever") return null;
      return undefined;
    },
    set: async () => {
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

function GlobalRetentionStoryCanvas({ state }: { state: RetentionState }) {
  return (
    <RetentionBridgeProvider state={state}>
      <div className="min-h-[320px] min-w-[620px] bg-[var(--color-background)] p-6">
        <GlobalRetention />
      </div>
      <ToastRoot />
    </RetentionBridgeProvider>
  );
}

const meta = {
  title: "Pages/Moderation/GlobalRetention",
  component: GlobalRetention,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Global mod-log retention with a local Electron fixture. Each story restores the bridge after unmount, so no retention IPC runs outside Storybook.",
      },
    },
  },
} satisfies Meta<typeof GlobalRetention>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unset: Story = {
  render: () => <GlobalRetentionStoryCanvas state="unset" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("spinbutton", { name: "Retention days for Global (default)" })
    ).toHaveValue(null);
  },
};

export const ThirtyDayDefault: Story = {
  render: () => <GlobalRetentionStoryCanvas state="thirty-days" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("spinbutton", {
        name: "Retention days for Global (default)",
      })
    ).toHaveValue(30);
  },
};

export const ForeverDefault: Story = {
  render: () => <GlobalRetentionStoryCanvas state="forever" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("checkbox", { name: "Forever toggle for Global (default)" })
    ).toBeChecked();
  },
};

export const InvalidSave: Story = {
  render: () => <GlobalRetentionStoryCanvas state="unset" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText("Days must be a positive integer (or enable Forever)")
    ).toBeInTheDocument();
  },
};

export const SaveFailure: Story = {
  render: () => <GlobalRetentionStoryCanvas state="save-failure" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("spinbutton", {
      name: "Retention days for Global (default)",
    });
    await userEvent.type(input, "45");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText("Save failed: The retention service is unavailable in this fixture.")
    ).toBeInTheDocument();
  },
};
